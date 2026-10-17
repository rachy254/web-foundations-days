# TicketHub System Design

TicketHub is an online service for browsing events, selecting seats, and buying tickets. This design prioritizes correct inventory and fair access when demand is much higher than the number of seats.

## 1. Requirements

### Functional requirements

- Visitors can browse and search upcoming events and view event details.
- Visitors can view a seat map with each seat's section, row, number, price, and approximate availability.
- Signed-in users can place a temporary hold on one available seat and receive its expiry time.
- A user can pay for a held seat and receive a confirmed ticket only after payment succeeds.
- A user can view their own orders and tickets.
- The system expires unpaid holds and returns their seats to available inventory.
- During a high-demand sale, the system can place users in a waiting room and report their queue status.

### Non-functional requirements

- **Correctness:** A seat can have no more than one active hold or paid order. Seat and order state changes must commit atomically.
- **Fairness:** A published waiting-room policy, such as FIFO by queue-entry time, controls admission. Refreshing must not move a user forward, and bot protections must be applied consistently.
- **Speed:** Event and seat-map pages should respond quickly during normal use. During a sale, users should see queue progress rather than repeatedly retrying overloaded services.
- **Availability:** App servers and other stateless services run redundantly across failure zones. If authoritative inventory is unavailable, the service fails closed and does not claim a seat.
- **Durability:** Confirmed orders and payment references are retained, backed up, and recoverable.
- **Security:** Buyers authenticate before holding or purchasing seats; they can only view their own orders. Payment details are handled by a payment provider, not stored as raw card data by TicketHub.
- **Abuse resistance and operability:** Rate limits, monitoring, alerts, and audit records help detect automation and diagnose queue, payment, and inventory problems.

## 2. Traffic estimates

The supplied facts do not state how requests are distributed over time, how many API calls each page makes, or how quickly the normal-day tickets sell. These estimates therefore state their assumptions. Rates are averages over the specified time window, not instantaneous maxima.

### Normal day

- **Read requests:** `50,000 visitors/day x 10 page views/visitor = 500,000 page views/day`. The 50,000 visitors are 2.5% of the 2 million registered users. Assume one principal application read per page view: `500,000 / 86,400 seconds = 5.79`, or about **5.8 reads/second on average**.
- **Ticket/order writes:** `5,000 tickets/day / 86,400 seconds = 0.0579`, or about **0.058 successful ticket/order writes per second on average** (about one every 17 seconds).
- These are baseline application estimates. A page can cause additional API and asset requests, and sales are not necessarily evenly distributed through the day.

### Popular concert sale

The prompt says 200,000 people try to buy 20,000 seats within the first 10 minutes. To estimate request rates, assume each person makes one event-detail read, one seat-map read, and one hold attempt during that window.

- **People arriving:** `200,000 / 600 seconds = 333.3 people/second` on average.
- The 200,000 interested buyers are 10% of the 2 million registered users.
- **Reads:** `2 reads/person x 200,000 / 600 = 666.7 reads/second` on average.
- **Hold writes:** `1 hold attempt/person x 200,000 / 600 = 333.3 hold attempts/second` on average. These are attempted inventory writes, not successful sales.
- **Maximum successful allocations:** `20,000 seats / 600 seconds = 33.3 seats/second` averaged across the window if every seat sells evenly. The actual rate can differ, but no more than 20,000 people can obtain these seats.
- **Demand vs. capacity:** `200,000 / 20,000 = 10 people per seat`; at most 10% of those attempting can obtain one of the seats.

The prompt gives no instantaneous arrival curve, so the actual peak cannot be calculated from the facts alone. As a capacity-planning assumption, provision and load-test for a **5x burst over the 10-minute average**: about **3,333 reads/second** and **1,667 hold attempts/second**. This is a headroom target, not a supplied fact or a prediction. A waiting room admits buyers at a controlled rate so that this burst does not reach the inventory database all at once.

The normal read baseline is about 5.8/second, compared with an estimated sale average of about 667/second (about 115x higher), and the assumed burst target of about 3,333/second (about 575x higher). Normal successful order writes average about 0.058/second; sale hold attempts average about 333/second (about 5,750x higher), with a 5x planning target of about 1,667 attempts/second. Queueing, backpressure, and database-side concurrency control are essential.

## 3. API design

All endpoints use HTTPS. Buyer actions require authentication. The server derives the buyer identity from the authenticated session or token; clients cannot choose another user's ID.

| Method and path | Description | Success |
| --- | --- | --- |
| `GET /api/v1/events?query={text}&cursor={cursor}` | Browse/search upcoming events with pagination. | `200 OK` |
| `GET /api/v1/events/{event_id}` | Get event details and sale times. | `200 OK` |
| `GET /api/v1/events/{event_id}/seats` | Get seat labels, prices, and approximate availability; this is a snapshot, not a reservation. | `200 OK` |
| `POST /api/v1/events/{event_id}/holds` | Atomically hold one seat for the authenticated buyer for a short time; requires an `Idempotency-Key`. | `201 Created` |
| `POST /api/v1/orders/{order_id}/payment` | Pay for the seat in an unexpired hold using a payment-provider token; requires an idempotency key. | `200 OK` or `202 Accepted` |
| `GET /api/v1/me/tickets` | List tickets belonging to the authenticated buyer. | `200 OK` |
| `GET /api/v1/me/orders/{order_id}` | Get the authenticated buyer's order and payment status. | `200 OK` |

Example hold request:

```http
POST /api/v1/events/evt_42/holds
Authorization: Bearer <access-token>
Idempotency-Key: 8b7b3f62-3c79-4e18-9e09-21fa940047d2
Content-Type: application/json

{"seat_id": "seat_301"}
```

Example successful hold response:

```json
{
  "order_id": "ord_9001",
  "seat_id": "seat_301",
  "status": "HELD",
  "expires_at": "2026-10-17T12:20:00Z"
}
```

An unavailable seat, or an expired hold submitted for payment, returns `409 Conflict`. Invalid input returns `400 Bad Request`; missing authentication returns `401 Unauthorized`; a missing event/order or an order not visible to this buyer returns `404 Not Found`. Payment-provider failure leaves the order unpaid; the hold remains subject to its stated expiry.

## 4. Data model

The relational model below uses PostgreSQL syntax. One `orders` row represents one seat purchase; a buyer purchasing multiple seats has one order per seat. This makes the seat-to-order uniqueness rule explicit and keeps the hold API, schema, and transaction consistent.

- **users:** One row per registered buyer. A user can have many orders (one-to-many).
- **events:** One row per concert or event. An event has many seats (one-to-many).
- **seats:** One row per sellable seat at an event, including its current inventory state.
- **orders:** A hold or purchase attempt for one seat by one user. A user can have many orders, and a seat can have historical orders over time. A partial unique index permits at most one active order for a seat.

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
    sale_starts_at TIMESTAMPTZ NOT NULL
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
    UNIQUE (event_id, section, row_label, seat_number)
);

CREATE TABLE orders (
    order_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(user_id),
    seat_id BIGINT NOT NULL REFERENCES seats(seat_id),
    status VARCHAR(20) NOT NULL
        CHECK (status IN ('HELD', 'PAYMENT_PENDING', 'PAID', 'EXPIRED', 'CANCELLED')),
    idempotency_key VARCHAR(100) NOT NULL,
    payment_reference VARCHAR(200) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    hold_expires_at TIMESTAMPTZ NOT NULL,
    UNIQUE (user_id, idempotency_key)
);

ALTER TABLE seats
    ADD COLUMN current_order_id BIGINT UNIQUE REFERENCES orders(order_id);

CREATE UNIQUE INDEX uq_orders_active_seat
    ON orders (seat_id)
    WHERE status IN ('HELD', 'PAYMENT_PENDING', 'PAID');

CREATE INDEX idx_events_sale_starts_at ON events (sale_starts_at);
CREATE INDEX idx_orders_user_created ON orders (user_id, created_at DESC);
```

The active-seat index enforces the invariant in the database, including when two application servers race. The `events.sale_starts_at` index helps find events by sale time; the `orders(user_id, created_at)` index helps retrieve a buyer's recent orders.

### Preventing two people from buying the same seat

The seat map is only a snapshot: two buyers can both see a seat as available. The primary database is the authority, not the cache or the client. To place a hold, the application begins a short transaction and runs:

```sql
UPDATE seats
SET status = 'HELD',
    hold_expires_at = :expiry
WHERE seat_id = :seat_id
  AND event_id = :event_id
  AND status = 'AVAILABLE';
```

The application checks the affected-row count. If it is not exactly one, it rolls back and returns `409 Conflict`. If exactly one row changed, it inserts the `HELD` order with the same expiry, sets `seats.current_order_id` to that order, and commits all changes in the same transaction. The row lock and conditional update allow only one competing transaction to change that seat from `AVAILABLE`; the partial unique index is a second guard against multiple active orders.

For payment, the server verifies the buyer owns the unexpired hold, then calls the payment provider outside the database transaction using an idempotency key. On confirmed success, a new short transaction changes the order to `PAID` and the seat to `SOLD` conditionally, then commits both. A declined attempt returns the order to `HELD` while the hold is still valid, allowing a retry; once expired, it cannot be paid. A retry uses the same idempotency key and provider reference. If confirmation arrives after the hold expired and the seat was released, the order must not take the seat back; the payment must be voided or refunded and reconciled. The expiry worker checks `seats.current_order_id` before expiring the order and releasing the seat, so a delayed job cannot release a newer buyer's hold. Caches are invalidated after committed inventory changes.

## 5. Architecture

```text
 Buyers (web / mobile)
          |
          v
     DNS service
          |
          v
 CDN / static content
          |
          v
 WAF + rate limiter
          |
          v
 Durable virtual waiting room
          |
          v
 Redundant load balancers
          |
          +-----------------------+
          |                       |
          v                       v
     App server A             App server B ... (stateless, multi-zone)
       |       \                 /       |
       |        +-------+-------+        |
       v                v                v
 Shared cache     Primary database    Payment provider
 (advisory)      (events, seats, orders)
                          |
                    replication
                          v
                    Read replica

 App servers / database outbox
          |
          v
   Durable job queue
          |
          v
 Redundant workers (expire holds, issue tickets, notify buyers)
```

### Component responsibilities

- **Buyer clients:** Provide event browsing and checkout screens but are not trusted to decide seat availability.
- **DNS:** Directs clients to the service's public entry point and supports traffic routing during failover.
- **CDN:** Delivers static assets and suitable cacheable event content close to users, reducing latency and origin load.
- **WAF and rate limiter:** Rejects common abusive traffic and limits request rates before they overload application and inventory services.
- **Virtual waiting room:** Admits buyers at a controlled rate under the published sale policy, smoothing the arrival burst.
- **Redundant load balancers:** Distribute admitted requests across healthy app servers and route around an unhealthy instance or zone.
- **App servers:** Authenticate users, validate requests, and coordinate database and payment operations without keeping authoritative inventory in local memory.
- **Shared cache:** Speeds up event and approximate seat-map reads; it never grants a hold or confirms a sale.
- **Primary database:** Serializes seat claims and atomically commits authoritative seat and order state with uniqueness constraints.
- **Read replica:** Serves suitable catalogue and order-history reads to reduce primary read load; inventory writes and hold decisions always use the primary.
- **Payment provider:** Processes card/payment details and reports outcomes without TicketHub storing raw card numbers.
- **Durable job queue:** Buffers work such as ticket issuance, hold expiration, and notifications so it can be retried after worker failures.
- **Workers:** Process queued jobs idempotently so retries do not issue duplicate tickets or release a seat that is already sold.

### GET /events flow

1. The client resolves TicketHub through DNS and requests `GET /api/v1/events`.
2. The CDN serves a valid cached public response when available; otherwise the request passes through the WAF/rate limiter and redundant load balancer to a healthy app server.
3. The app validates query and pagination parameters, then reads event data from the shared cache or database. A read replica can serve catalogue reads where the freshness policy allows.
4. The app returns a paginated `200 OK` response. Cache headers and pagination limit response size and repeat work.

### POST /holds and payment flow

1. During a sale, the buyer receives a durable waiting-room token; the room admits buyers at a controlled rate and the load balancer routes admitted requests to a healthy app server.
2. The buyer submits `POST /api/v1/events/{event_id}/holds` with one `seat_id` and an idempotency key.
3. The app verifies authentication and sale eligibility, then starts a short primary-database transaction. A conditional update claims only a currently available seat; the app inserts the matching order and records its ID on the seat in the same transaction. A conflict returns `409`; success returns `201` with the expiry.
4. The buyer submits payment for that order. The app checks ownership and expiry, calls the payment provider with an idempotency key without holding database locks, and processes the result.
5. On confirmed success, the app atomically marks the order paid and seat sold on the primary. It records follow-up work in a durable queue/outbox; workers issue the ticket and notify the buyer.
6. If payment is declined, the buyer can retry while the hold remains valid. If the hold expires, an expiry worker releases the seat only when its `current_order_id` still identifies that order; late payment success is voided/refunded and reconciled rather than reclaiming a seat.

### Handling the popular sale and avoiding single points of failure

Before a sale, warm cacheable event content and seat-map snapshots, open the waiting room, and load-test the assumed burst target. The room limits admitted traffic; the CDN and cache absorb suitable reads; stateless app servers scale horizontally across zones; and the primary sees only controlled hold attempts. The database uses short transactions to serialize contested seat claims, while payment calls and ticket notifications do not hold inventory locks.

Run load balancers, app servers, cache nodes, queue brokers, and workers redundantly across failure zones with health checks and automatic replacement. Use database backups, replication, and a tested primary-promotion and restore procedure. A read replica is not a substitute for the primary inventory write path: if the primary cannot safely accept holds, pause new seat claims rather than risk double-selling. Monitor queue depth, request latency, hold conflicts, payment outcomes, worker lag, and database health, and apply backpressure when a downstream service is unhealthy.

## 6. Trade-offs

- **Waiting room vs. immediate access:** A queue smooths load and supports a published fair policy, but users wait and the queue service adds operational complexity. Durable queue tokens, visible progress, and protection against refresh-based queue jumping improve the experience.
- **Temporary holds vs. inventory utilization:** Holds give a buyer time to pay and avoid selling one seat twice, but abandoned holds temporarily hide inventory. Keep holds short and explicit, and use a reliable conditional expiry worker.
- **Strongly consistent inventory vs. write availability:** A primary database and serialized seat claims preserve correctness, but can be a hot spot and may reduce write availability during failover. Partition work by event where practical, keep transactions short, backpressure requests, and fail closed if authoritative writes are unavailable.
- **Cached seat maps vs. fresh availability:** Caching improves page speed but can show stale seats. Label seat availability as approximate and recheck it atomically when creating a hold.
- **Synchronous payment vs. uncertain outcomes:** External payment adds latency and timeouts can leave an uncertain result. Idempotency, explicit pending states, provider reconciliation, and late-success refunds prevent duplicate charges or invalid seat claims.
