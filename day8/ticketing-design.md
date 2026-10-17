# TicketHub System Design

TicketHub sells tickets for concerts and other events. This design focuses on fair access during high-demand sales and on ensuring that a physical seat can be sold to only one buyer.

## 1. Requirements

### Functional requirements

- Visitors can browse and search upcoming events and view event details.
- Visitors can view a seat map and see which seats are available, temporarily held, or sold.
- Signed-in users can place a temporary hold on one or more available seats and receive a clear hold-expiration time.
- A user can pay for a valid hold and receive confirmed tickets only after payment succeeds.
- Users can view their orders and tickets, and can see whether an order is pending, paid, failed, or expired.
- The system expires unpaid holds and returns their seats to the available inventory.
- The system provides a fair, controlled waiting room for high-demand sales and gives clear outcomes when demand exceeds capacity.

### Non-functional requirements

- **Correctness:** A seat has at most one active hold/order and at most one paid order; inventory changes and order creation are atomic.
- **Fairness:** During a major sale, a waiting room limits the rate of entry and admits visitors according to a published policy, such as first-come-first-served by queue-entry time. Bot/rate protections should be consistent and transparent and must not let repeated refreshes jump the queue.
- **Speed:** Event pages and seat maps should load quickly under normal demand; during a sale, users receive queue position and progress updates rather than retrying uncontrolled requests.
- **Availability:** A failure of one app server or availability zone should not take the service offline; payment and inventory failures must fail safely rather than claim a seat was sold.
- **Durability:** Confirmed orders and payment references must survive process failures, with backups and tested recovery.
- **Security and privacy:** Authenticate buyers, authorize access to their own holds/orders, protect personal/payment data in transit and at rest, and use a payment provider so TicketHub does not store raw card details.
- **Abuse resistance and observability:** Rate-limit sensitive actions, detect suspicious automation, and monitor queue length, hold conflicts, payment failures, sale latency, and inventory consistency.

## 2. Estimates

The facts specify visitors, pages, and ticket sales, but not request shape, event distribution, page-view time distribution, or exact normal-sale duration. The following estimates make those assumptions explicit. Rates are averages over the stated period; actual short bursts can be higher.

### Normal day

- **Page views:** `50,000 visitors/day × 10 pages/visitor = 500,000 page views/day`.
- Assume one page view creates one principal application read: `500,000 ÷ 86,400 ≈ 5.8 read requests/second` on average.
- **Ticket sales:** `5,000 tickets/day`. If spread evenly across 24 hours: `5,000 ÷ 86,400 ≈ 0.058 sales/second`, or about 1 sale every 17 seconds on average.
- A page can trigger additional asset and API requests, so this page-view-based read estimate is a baseline rather than a full request count.

### Popular-concert sale

- **Attempt rate:** `200,000 people ÷ (10 × 60 seconds) ≈ 333 purchase attempts/second` on average during the first 10 minutes.
- **Seat capacity:** `20,000 seats ÷ 600 seconds ≈ 33 successful seat allocations/second` if sales are evenly distributed and all seats sell during that period.
- **Demand/supply ratio:** `200,000 ÷ 20,000 = 10 people per seat`; at most 10% of the attempted buyers can obtain a seat, even if every seat sells.
- For an illustrative API-load estimate, assume each buyer requests the event and seat map once and attempts one hold: approximately `3 × 200,000 ÷ 600 = 1,000 requests/second`, including about 333 hold attempts/second. Payment requests are bounded by successful holds, at most 33/second on average if all 20,000 seats sell evenly.
- The supplied data does not define the instantaneous burst shape. The platform should load-test above these averages and use a waiting room to smooth arrival spikes; retry traffic and bots must not be allowed to multiply database load unchecked.

The normal baseline is about 5.8 page reads/second and 0.058 ticket sales/second. The sale implies about 1,000 combined event/map/hold requests/second under the stated request assumption—roughly 170 times the normal page-read baseline—and about 333 hold attempts/second, while the inventory can satisfy no more than 33 sales/second averaged across the full window. That mismatch means the system must queue and reject/expire excess demand gracefully, not simply add database connections.

## 3. API design

All endpoints use HTTPS and authenticated identity for buyer actions. The client cannot choose another user's identity by submitting a `user_id`.

| Method and path | Purpose | Success response |
| --- | --- | --- |
| `GET /api/v1/events?query={text}&cursor={cursor}` | Browse upcoming events with pagination. | `200 OK`, events and next cursor |
| `GET /api/v1/events/{event_id}` | View event details, venue, date, and sale information. | `200 OK`, event |
| `GET /api/v1/events/{event_id}/seats` | View seat labels, prices, and approximate availability. This is advisory; the database decides availability when a hold is requested. | `200 OK`, seat map |
| `POST /api/v1/events/{event_id}/holds` | Atomically hold one or more available seats for the authenticated buyer for a short period (for example, five minutes). Requires an `Idempotency-Key`. | `201 Created`, hold ID and expiry |
| `POST /api/v1/orders/{order_id}/payment` | Pay for an unexpired hold using a payment-provider token; the operation is idempotent. | `200 OK` or `202 Accepted`, payment/order state |
| `GET /api/v1/me/orders?cursor={cursor}` | List the authenticated buyer's orders and issued tickets. | `200 OK`, orders and next cursor |
| `GET /api/v1/me/orders/{order_id}` | View a buyer's order, payment state, and ticket details. | `200 OK`, order |

An unavailable seat or expired hold returns `409 Conflict`; invalid input returns `400 Bad Request`; unauthenticated requests return `401 Unauthorized`; and a missing or inaccessible event/order returns `404 Not Found` without exposing another buyer's data. Payment-provider failures leave the order unpaid and the seat held only until the original expiry.

## 4. Data model

The core entities are `users`, `events`, `seats`, and `orders`. Each event has many seats; each user can have many orders; each order belongs to one user and one event and reserves one seat. The order is the durable purchase/hold record, while the seat row is the authoritative inventory state.

```sql
CREATE TABLE users (
    user_id BIGINT PRIMARY KEY,
    email VARCHAR(254) NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL
);

CREATE TABLE events (
    event_id BIGINT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    venue VARCHAR(200) NOT NULL,
    starts_at TIMESTAMP NOT NULL,
    sale_starts_at TIMESTAMP NOT NULL
);

CREATE TABLE seats (
    seat_id BIGINT PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(event_id),
    section VARCHAR(80) NOT NULL,
    row_label VARCHAR(20) NOT NULL,
    seat_number VARCHAR(20) NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    status VARCHAR(12) NOT NULL CHECK (status IN ('AVAILABLE', 'HELD', 'SOLD')),
    hold_expires_at TIMESTAMP,
    UNIQUE (event_id, section, row_label, seat_number)
);

CREATE TABLE orders (
    order_id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(user_id),
    event_id BIGINT NOT NULL REFERENCES events(event_id),
    seat_id BIGINT NOT NULL REFERENCES seats(seat_id),
    status VARCHAR(12) NOT NULL CHECK (status IN ('HELD', 'PAID', 'EXPIRED', 'CANCELLED')),
    idempotency_key VARCHAR(100) NOT NULL,
    payment_reference VARCHAR(200),
    created_at TIMESTAMP NOT NULL,
    hold_expires_at TIMESTAMP NOT NULL,
    UNIQUE (user_id, idempotency_key)
);

-- At most one current hold or paid order may claim a seat.
CREATE UNIQUE INDEX uq_orders_active_seat
    ON orders (seat_id)
    WHERE status IN ('HELD', 'PAID');

CREATE INDEX idx_events_sale_starts_at ON events (sale_starts_at);
CREATE INDEX idx_orders_user_created ON orders (user_id, created_at DESC);
```

### Preventing two people from buying the same seat

The seat map is only a snapshot: two buyers may both see a seat as available, so availability must be decided by an atomic write against the primary database, never by a cache check. In one short transaction, the server attempts `UPDATE seats SET status = 'HELD', hold_expires_at = :expiry WHERE seat_id = :seat_id AND event_id = :event_id AND status = 'AVAILABLE'`; it checks that exactly one row changed, then inserts the `HELD` order and commits. The conditional update makes concurrent attempts serialize at the inventory row: only one can change `AVAILABLE` to `HELD`; every losing request gets zero updated rows and returns `409 Conflict`. The unique active-seat index is a second database-enforced guard against two live holds/paid orders for the same seat.

Payment is requested only for the buyer's unexpired hold. After the payment provider confirms success, a transaction changes the order from `HELD` to `PAID` and the seat from `HELD` to `SOLD`, conditional on the hold still being valid; an idempotency key and unique provider reference prevent retries/callbacks from creating duplicate charges or orders. An expiry worker conditionally expires an unpaid order and releases its seat only if that seat is still held by that order, so it cannot release a seat that has since been sold or re-held. Seat/order updates must occur on the primary and commit together; caches are invalidated after commit.

## 5. Architecture

```text
                       ┌─────────────────────────┐
                       │ Buyers (web / mobile)   │
                       └───────┬─────────┬───────┘
                               │         │ browse/static and seat map
                       API calls         ▼
                               │    ┌───────────────┐
                               │    │ CDN           │
                               │    └──────┬────────┘
                               ▼           │ cache miss
                     ┌──────────────────┐  │
                     │ WAF / rate limit│  │
                     └────────┬─────────┘  │
                              ▼            │
                     ┌──────────────────┐  │
                     │ Virtual waiting  │◄─┘
                     │ room / fair queue│
                     └────────┬─────────┘
                              ▼
                     ┌──────────────────┐
                     │ Redundant load   │
                     │ balancers        │
                     └──────┬─────┬─────┘
                            │     │
                     ┌──────▼┐   ┌▼───────┐
                     │ App A │   │ App B  │  ... horizontally scaled
                     └──┬─┬──┘   └──┬─┬───┘
                        │ │         │ │
              ┌─────────┘ └────┐ ┌──┘ └─────────┐
              ▼                ▼ ▼              ▼
       ┌──────────────┐  ┌─────────────┐  ┌──────────────┐
       │ Shared cache │  │ Primary DB  │  │ Payment      │
       │ (advisory)   │  │ seats/orders│  │ provider     │
       └──────────────┘  └──────┬──────┘  └──────────────┘
                                │ replication
                                ▼
                         ┌─────────────┐
                         │ Read replica│
                         └─────────────┘

      app servers ───► durable queue ───► workers
                       (expiry, tickets, notifications)
```

### Component responsibilities

- **Buyer clients:** Let users browse, join the waiting room, select seats, and complete checkout without being trusted to enforce inventory rules.
- **CDN:** Serves cached static assets and suitable read-only event/seat-map content close to buyers, lowering origin traffic and page latency.
- **WAF and rate limiter:** Filters common abusive traffic and caps per-account/IP/API rates before requests can overwhelm application or inventory services.
- **Virtual waiting room:** Smooths the sale's arrival burst and admits people under a published FIFO or lottery policy at the rate the inventory/checkout system can sustain.
- **Redundant load balancers:** Distribute admitted requests across healthy app instances and route around an unhealthy balancer or zone.
- **App servers:** Authenticate buyers, coordinate holds/orders/payments, validate requests, and scale horizontally; they contain no authoritative seat state in process memory.
- **Shared cache:** Speeds event reads and approximate seat-map displays; it is explicitly advisory and never grants or sells a seat.
- **Primary database:** Serializes authoritative seat changes and commits seat/order state atomically with constraints that prevent double-booking.
- **Read replica:** Serves event/catalogue and other suitable read traffic to reduce primary load; hold and payment decisions always go to the primary.
- **Payment provider:** Processes sensitive payment details and reports payment outcomes without TicketHub storing raw card data.
- **Durable queue:** Buffers post-purchase ticket issuance, hold-expiration, and notification work so spikes do not block checkout and jobs survive worker restarts.
- **Workers:** Process queued jobs idempotently, issue tickets after confirmed payment, notify buyers, and expire holds safely.

### How the design survives the big sale

Before the sale, CDN-cacheable event assets and seat-map snapshots are warmed, and the waiting room is opened at the announced time. It assigns a durable queue-entry timestamp/token, rate-limits entry, and rejects abusive refresh patterns, preventing 200,000 clients from hitting inventory at once. Multiple stateless app servers serve admitted users across failure zones; cached reads keep non-transactional event traffic away from the primary. The database receives bounded hold attempts and uses conditional row updates and constraints to arbitrate contested seats; it remains the single source of truth. Payment calls use idempotency keys and do not hold database locks while waiting on the external provider. Durable workers handle expirations, ticket delivery, and notifications asynchronously. Autoscaling, connection pools, backpressure, circuit breakers, health checks, monitoring, and tested database failover protect the service when one component slows or fails.

### Double-booking protection summary

An availability response is not a reservation. Only a successful conditional `AVAILABLE` → `HELD` update inside a primary-database transaction can create a hold; exactly one competing transaction can update the same seat row. A unique active-order constraint independently rejects a second active order, and payment transitions that same order/seat pair to `PAID`/`SOLD` atomically. Conflicts return `409`, and failed/expired holds are released only by conditional updates. This preserves correctness even if the CDN, cache, or client shows stale availability.

## 6. Trade-offs

- **Fair waiting room vs. instant access:** Queueing is fairer and protects the inventory database from a thundering herd, but users wait and queue tokens add operational complexity. Publish the admission policy, make queue position observable, and prevent refreshes from resetting or bypassing a place.
- **Temporary seat holds vs. maximum utilization:** Holds give buyers time to pay and avoid charging for a seat they did not secure, but abandoned holds temporarily hide inventory. Use a short, clear expiry, idempotent payment, and a reliable expiry worker that conditionally returns unpaid seats.
- **Strongly consistent primary writes vs. write availability/latency:** Serializing seat claims on one authoritative primary prevents double-sales, but can become a hot spot and may reduce write availability during failover. Partition/route inventory by event, keep transactions short, apply backpressure, and fail closed (do not sell) if authoritative inventory cannot be reached.
- **Cached seat maps vs. freshness:** Caching improves speed for many browsers, but a displayed seat may already be held or sold. Mark availability as indicative, refresh it regularly, and always revalidate atomically during hold creation.
- **Automatic sale completion vs. payment uncertainty:** Calling a payment provider adds external latency and uncertain outcomes, but charging only after a hold avoids overselling. Use provider idempotency, a hold expiry buffer, asynchronous reconciliation, and explicit pending states rather than assuming a timeout means payment failed.

## Availability and single points of failure

Run load balancers, app servers, cache nodes, queue brokers, and workers redundantly across failure zones; use health checks and automatic replacement/failover, and maintain database backups plus a tested primary-promotion and restore procedure. Replicas and backups reduce recovery risk but do not make the primary write path magically multi-writer: if authoritative inventory is unavailable, temporarily stop new holds rather than risk selling a seat twice. Payment and queue consumers must be idempotent so retries during recovery do not duplicate charges or tickets.
