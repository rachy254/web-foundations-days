# TicketHub System Design

TicketHub lets customers discover events, choose seats, hold them briefly, and pay for tickets. The key design goal is that high demand must never cause the same seat to be sold twice.

## 1. Requirements

### Functional requirements
- Visitors can search and browse upcoming events, event details, and sale times.
- Visitors can view a seat map with section, row, seat number, price, and approximate availability.
- Authenticated buyers can hold one available seat temporarily and see when the hold expires.
- Buyers can pay for an unexpired hold and receive a ticket only after confirmed payment.
- Buyers can view only their own orders and tickets.
- Unpaid holds expire and return seats to inventory.
- Popular sales use a waiting room that reports queue status.

### Non-functional requirements
- **Correctness:** A seat has at most one active hold or paid order. Related seat and order changes commit atomically.
- **Fairness:** Publish a queue policy (FIFO by server-recorded entry time). Refreshing cannot improve a buyer's position; apply bot controls consistently.
- **Speed:** Keep event and seat-map pages responsive in normal traffic; during a sale, show queue progress instead of letting clients overwhelm inventory.
- **Availability:** Run stateless app instances redundantly across failure zones. If authoritative inventory writes are unavailable, fail closed and do not claim a seat.
- **Durability:** Persist confirmed orders and payment references; back up data and test recovery.
- **Security:** Authenticate buyer actions, authorize every order lookup, rate-limit abuse, and let a payment provider handle card data.

## 2. Traffic estimates

The facts specify daily totals and a 10-minute sale window, but not the detailed arrival curve or API calls per page. The figures below are average rates across those windows; the per-page and burst assumptions are stated explicitly.

| Scenario | Calculation | Estimated average |
| --- | --- | ---: |
| Normal page views | 50,000 visitors/day x 10 views | 500,000 views/day |
| Normal reads | 500,000 / 86,400 seconds; assume one main application read per page | 5.8 reads/second |
| Normal successful ticket writes | 5,000 / 86,400 seconds | 0.058 writes/second |
| Sale arrivals | 200,000 buyers / 600 seconds | 333 buyers/second |
| Sale reads | Assume one event read and one seat-map read per buyer: 2 x 200,000 / 600 | 667 reads/second |
| Sale hold attempts | Assume one hold attempt per buyer: 200,000 / 600 | 333 attempts/second |
| Sale seat capacity | 20,000 seats / 600 seconds | 33.3 successful sales/second if sales were even |
| Demand per seat | 200,000 buyers / 20,000 seats | 10 buyers per seat |

The sale's average read rate is about 115 times the normal read baseline; its hold-attempt rate is about 5,750 times the normal successful-write baseline. These are not like-for-like measures (attempted vs. successful writes), but they show why a sale needs a different traffic strategy. The brief gives no instantaneous peak, so use a clearly labeled **5x planning burst** for load tests: about 3,333 reads/second and 1,667 hold attempts/second. This is a design target, not a supplied fact. A waiting room and backpressure keep that burst from reaching the inventory database all at once.

## 3. API design

All endpoints use HTTPS. Buyer endpoints require authentication; the server gets `user_id` from the verified session/token, never from a client-supplied owner field. Seat availability is a snapshot, not a promise. `Idempotency-Key` values are scoped to the authenticated buyer and operation.

| Method and path | Purpose | Success |
| --- | --- | --- |
| `GET /api/v1/events?query={text}&cursor={cursor}` | Search and paginate upcoming events | `200 OK` |
| `GET /api/v1/events/{event_id}` | Read event details and sale times | `200 OK` |
| `GET /api/v1/events/{event_id}/seats` | Read seat labels, prices, and approximate availability | `200 OK` |
| `POST /api/v1/events/{event_id}/queue` | Join the event's durable waiting room | `202 Accepted` |
| `GET /api/v1/me/queue/{entry_id}` | Read queue position/admission status | `200 OK` |
| `POST /api/v1/events/{event_id}/holds` | Atomically hold one seat for the authenticated buyer | `201 Created` |
| `POST /api/v1/orders/{order_id}/payments` | Start or retry payment for an unexpired hold | `200 OK` or `202 Accepted` |
| `GET /api/v1/me/orders/{order_id}` | Read the buyer's order and payment status | `200 OK` |
| `GET /api/v1/me/tickets` | List the buyer's confirmed tickets | `200 OK` |

The examples use `Authorization: Bearer <access-token>`; the server validates it and derives the buyer identity from it.

Example hold request:

```http
POST /api/v1/events/evt_42/holds
Authorization: Bearer <access-token>
Idempotency-Key: 8b7b3f62-3c79-4e18-9e09-21fa940047d2
Content-Type: application/json

{"seat_id": "seat_301"}
```

Example successful response:

```http
HTTP/1.1 201 Created
Location: /api/v1/me/orders/ord_9001
Content-Type: application/json

{
  "order_id": "ord_9001",
  "seat_id": "seat_301",
  "status": "HELD",
  "expires_at": "2026-10-17T12:20:00Z"
}
```

Example graceful conflict when another buyer won the race:

```http
HTTP/1.1 409 Conflict
Content-Type: application/json

{"error": {"code": "SEAT_UNAVAILABLE", "message": "That seat is no longer available. Please choose another seat."}}
```

Example payment request and pending response:

```http
POST /api/v1/orders/ord_9001/payments
Authorization: Bearer <access-token>
Idempotency-Key: 3f4b6956-0667-4f48-8a3f-dace229ac303
Content-Type: application/json

{"payment_method_token": "provider-token"}
```

```http
HTTP/1.1 202 Accepted
Content-Type: application/json

{"order_id": "ord_9001", "status": "PAYMENT_PENDING"}
```

Return `400 Bad Request` for malformed input, `401 Unauthorized` for missing/invalid authentication, `404 Not Found` for a missing resource or an order not owned by the caller, `409 Conflict` for an unavailable seat or expired hold, `429 Too Many Requests` for rate limiting, and `503 Service Unavailable` if authoritative inventory is unavailable. A declined payment is reported as a payment outcome; it does not mark the order paid, and a still-valid hold remains available for retry. A payment timeout returns `202 Accepted` while the provider result is reconciled; it must not be treated as a decline or success.

## 4. Data model

The relational schema uses PostgreSQL types and syntax. An order is for one seat, so a multi-seat purchase creates one order per seat. Historical orders remain for audit and customer history.

Relationships: **users 1-to-many orders and queue entries; events 1-to-many seats and queue entries; seats 1-to-many historical orders; each order belongs to exactly one user and one seat; orders 1-to-many payment attempts.** `seats.current_order_id` identifies that seat's current hold or sale; it is null when available.

```sql
CREATE TABLE users (
    user_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email VARCHAR(254) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE events (
    event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    venue VARCHAR(200) NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    sale_starts_at TIMESTAMPTZ NOT NULL,
    CHECK (sale_starts_at <= starts_at)
);

CREATE TABLE seats (
    seat_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(event_id),
    section VARCHAR(80) NOT NULL,
    row_label VARCHAR(20) NOT NULL,
    seat_number VARCHAR(20) NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    status VARCHAR(12) NOT NULL DEFAULT 'AVAILABLE'
        CHECK (status IN ('AVAILABLE', 'HELD', 'SOLD')),
    hold_expires_at TIMESTAMPTZ,
    current_order_id BIGINT UNIQUE,
    UNIQUE (event_id, section, row_label, seat_number),
    CHECK (
        (status = 'AVAILABLE' AND current_order_id IS NULL AND hold_expires_at IS NULL)
        OR (status = 'HELD' AND hold_expires_at IS NOT NULL)
        OR (status = 'SOLD' AND hold_expires_at IS NULL)
    )
);

CREATE TABLE orders (
    order_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(user_id),
    seat_id BIGINT NOT NULL REFERENCES seats(seat_id),
    status VARCHAR(20) NOT NULL
        CHECK (status IN ('HELD', 'PAYMENT_PENDING', 'PAID', 'EXPIRED', 'CANCELLED')),
    idempotency_key VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    hold_expires_at TIMESTAMPTZ NOT NULL,
    UNIQUE (user_id, idempotency_key),
    UNIQUE (order_id, seat_id)
);

CREATE TABLE payment_attempts (
    payment_attempt_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(order_id),
    idempotency_key VARCHAR(100) NOT NULL,
    provider_reference VARCHAR(200) UNIQUE,
    status VARCHAR(12) NOT NULL
        CHECK (status IN ('PENDING', 'APPROVED', 'DECLINED', 'VOIDED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (order_id, idempotency_key)
);

CREATE TABLE sale_queue_entries (
    queue_entry_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(event_id),
    user_id BIGINT NOT NULL REFERENCES users(user_id),
    entered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(12) NOT NULL DEFAULT 'WAITING'
        CHECK (status IN ('WAITING', 'ADMITTED', 'EXPIRED', 'CANCELLED')),
    admitted_at TIMESTAMPTZ,
    UNIQUE (event_id, user_id),
    CHECK (
        (status = 'ADMITTED' AND admitted_at IS NOT NULL)
        OR (status <> 'ADMITTED' AND admitted_at IS NULL)
    )
);

ALTER TABLE seats
    ADD CONSTRAINT fk_seat_current_order
    FOREIGN KEY (current_order_id, seat_id) REFERENCES orders(order_id, seat_id);

CREATE UNIQUE INDEX uq_orders_active_seat
    ON orders (seat_id)
    WHERE status IN ('HELD', 'PAYMENT_PENDING', 'PAID');
CREATE INDEX idx_events_sale_starts_at ON events (sale_starts_at);
CREATE INDEX idx_orders_user_created ON orders (user_id, created_at DESC);
CREATE INDEX idx_payment_attempts_order ON payment_attempts (order_id, created_at DESC);
CREATE INDEX idx_sale_queue_fifo
    ON sale_queue_entries (event_id, entered_at, queue_entry_id)
    WHERE status = 'WAITING';
```

The schema has six tables: users, events, seats, orders, payment_attempts, and sale_queue_entries. The queue table makes the FIFO design durable across page refreshes and gives the queue endpoints a persistent entry ID. The partial FIFO index supports retrieving the next waiting buyer in entry-time order. The circular seat/order reference is intentional: `current_order_id` is added as a composite foreign key after `orders` exists. `UNIQUE (order_id, seat_id)` lets the database verify that a seat points to an order for that same seat. In one hold transaction, conditionally update the seat to `HELD` with an expiry, insert its matching order, set `current_order_id`, and commit; intermediate states are not visible outside the transaction. The active-order partial unique index prevents multiple active orders for a seat. The seat-location unique key prevents duplicate seat definitions. Store money as integer cents to avoid floating-point rounding.

## 5. Preventing double booking

The seat map and cache can be stale. Only the primary database can confirm a hold. The app begins a transaction and runs:

```sql
UPDATE seats
SET status = 'HELD',
    hold_expires_at = :expiry
WHERE seat_id = :seat_id
  AND event_id = :event_id
  AND status = 'AVAILABLE'
  AND current_order_id IS NULL;
```

If zero rows change, another request already claimed the seat (or the seat/event is invalid); roll back and return `409 Conflict`. If exactly one row changes, insert the `HELD` order with the same expiry, set `seats.current_order_id` to its ID, and commit all three changes together. The row lock and conditional update serialize competing requests: only one can change `AVAILABLE` to `HELD`. The unique constraints are a database-enforced backstop, not a replacement for the transaction.

For payment, store a `PENDING` payment-attempt row with its idempotency key before calling the provider outside the inventory transaction. Network retries reuse that key; a deliberate retry after a confirmed decline gets a new key and a new attempt row. The expiry worker locks the specific order and seat in a short transaction. It expires only that order when it is still `HELD`, its hold has elapsed, and the seat's `current_order_id` still equals that order ID; it then clears the seat's current order and expiry and marks the seat `AVAILABLE`. This identity check prevents an old/delayed expiry job from releasing a later buyer's hold. `PAYMENT_PENDING` remains reserved while a provider timeout is reconciled. A confirmed payment changes the attempt to `APPROVED`, the order to `PAID`, and the seat to `SOLD` together, only if the order still owns that seat. If a provider reports success too late to complete the valid hold, void/refund it; never take a seat from a newer buyer.

## 6. Architecture and scaling

```text
Buyers (web/mobile)
        |
        v
 DNS / traffic routing
        |
        v
 CDN (static assets, cacheable public event reads)
        |
        v
 WAF + rate limiter
        |
        v
 Durable waiting room (fair, controlled admission)
        |
        v
 Redundant load balancers
        |
        +--------------------+
        |                    |
        v                    v
 Stateless app A        Stateless app B ... (multiple zones)
        |                    |
        +---------+----------+---------> Payment provider
                  |
          +-------+--------+
          |                |
          v                v
   Shared cache       Primary database
   (advisory reads)   (authoritative inventory)
                          |
                    Read replica
                    (eligible reads)

 App transaction + outbox --> Durable job queue --> Redundant workers
                                                   (expire holds, issue
                                                    tickets, notify buyers)
```

### Why each component exists
- **DNS/traffic routing:** directs customers to a healthy service entry point and supports failover.
- **CDN:** offloads static assets and cacheable public event data, reducing origin latency and read load.
- **WAF/rate limiter:** blocks common abuse and limits automated request floods before they reach the app.
- **Waiting room:** admits users at a rate the inventory path can handle and preserves the published queue order during the sale.
- **Redundant load balancers and stateless app servers:** spread admitted traffic across healthy instances/zones; app instances can scale horizontally without holding seat state locally.
- **Shared cache:** serves fast event and approximate seat-map reads; it never authorizes holds or purchases.
- **Primary database:** serializes inventory claims and atomically stores seat/order state. Writes and hold decisions always go here.
- **Read replica:** reduces primary load for suitable catalogue/history reads; replica lag means it must not make hold or payment decisions.
- **Payment provider:** processes payment details and supplies an idempotent payment reference; TicketHub does not store raw card numbers.
- **Transactional outbox, durable queue, and workers:** reliably deliver expiry, ticket-issuance, and notification jobs after commit; idempotent workers can retry without duplicating effects.

For the sale, warm cacheable event data, load-test to the stated burst target, and admit queued buyers gradually. The cache/CDN handle suitable reads, app servers scale out, and the waiting room protects the primary from uncontrolled writes. Seat claims still serialize at the primary; if it is unhealthy, pause holds rather than use a stale replica. Replication and backups help recovery, but failover must be tested before a real sale. Monitor queue depth, latency, database saturation, hold conflicts, payment reconciliation, and worker lag; use backpressure and a clear degraded-mode message when a dependency is unhealthy.

### Main request flow
1. A visitor reads the event and approximate seat map from CDN/cache/app; stale availability is allowed and disclosed.
2. During a sale, a durable queue token controls admission. The app authenticates the buyer and checks sale eligibility.
3. For a hold, the app performs the conditional seat update, order insert, and `current_order_id` update in one primary transaction. Success returns `201`; a losing buyer gets a useful `409` and can choose another seat.
4. For payment, the app checks ownership and expiry, saves an idempotent payment attempt, calls the provider outside the inventory transaction, and atomically records the confirmed outcome. Uncertain provider outcomes remain pending and are reconciled.
5. After commit, the outbox/queue triggers ticket delivery and notifications. Expiry jobs release only the exact hold they were created for.

### Live demo
Open [demo.html](./demo.html) in a browser. The demo lets a presenter browse sample events, join and advance a FIFO waiting room, switch between two buyers, hold and pay for a seat, view tickets, trigger expiry, and simulate approved, declined, and timed-out payment outcomes. For the main conflict case, have Buyer A join and admit them from the queue, then hold a seat. Have Buyer B join and admit them next, then try to hold that same seat; the demo shows a friendly conflict and leaves Buyer A's hold intact. This is an in-browser simulation using sample data, not a deployed backend or real payment service; it demonstrates user flows and errors, while the database transaction above describes production correctness.

### Presentation run-through
1. Introduce the constraints: 200,000 sale visitors, 20,000 seats, and about 10 buyers competing per seat.
2. In the demo, let Buyer A join the queue, admit them, and hold a seat. Switch to Buyer B, join and admit them next, then attempt the same seat. Point out the graceful conflict and explain why the losing request does not change inventory.
3. Show payment decline (no ticket), then approval (ticket appears). Demonstrate one hold expiry returning a seat to availability. If time allows, show payment timeout remaining pending until reconciliation.
4. Close with the production guarantee: primary-database conditional update and unique constraint inside transactions; the browser demo demonstrates the flow, not database-level concurrency.

Likely questions:
- **What if two people click at once?** The primary conditionally changes only an available seat. One transaction wins; the other updates zero rows and gets `409 Conflict`.
- **Why not trust the seat map?** It can be stale due to caching or another buyer's action; it is only a snapshot.
- **What if payment times out?** Keep the seat reserved in `PAYMENT_PENDING`, reuse the same provider idempotency key, and reconcile before releasing it.
- **Why queue buyers?** It controls the admitted rate and gives a consistent published order instead of overwhelming the primary.

## 7. Trade-offs

- **Waiting room vs. immediate access:** A queue delays users and adds a service to operate, but smooths extreme bursts and supports fair admission. For a scarce, popular sale, predictable access is preferable to letting clients race the database.
- **Strong inventory consistency vs. write availability:** Sending every hold to one authoritative primary can become a hot spot and may reduce write availability during failover. It prevents overselling; short transactions, controlled admission, and fail-closed behavior are safer than accepting uncertain claims.
- **Cached seat maps vs. freshness:** Caching improves page speed and reduces database reads, but availability can be stale. Label it approximate and confirm every hold on the primary.
- **Temporary holds vs. inventory utilization:** Holds give buyers time to pay but temporarily hide seats if abandoned. Short expiry times reclaim them; payment timeouts must remain reserved until reconciliation, temporarily lowering utilization to avoid double selling.

## 8. Presentation close

â€œThe seat map is only a snapshot; the primary database is the authority. A conditional update inside a transaction lets only one request claim an available seat. The winner receives a hold; the other buyer gets a clear conflict and can choose another seat. A waiting room protects that database during the sale, and idempotency plus reconciliation protect payment retries.â€
