# SnapShare Scaling Plan

## Assumptions and traffic estimates

- SnapShare has **10 million registered users**.
- **10%** of registered users are active each day: `10,000,000 × 0.10 = 1,000,000 daily active users (DAU)`.
- Each daily active user uploads one photo and views 50 feed pages per day.
- A photo is 2 MB and its generated thumbnail is 50 KB. For storage estimates, use decimal units (1 MB = 1,000 KB and 1 GB = 1,000 MB), retain all images for a year, and do not include database metadata, replicas, backups, or temporary upload copies.
- Divide daily totals by 86,400 seconds to estimate average per-second rates. For feed traffic, estimate peak as 5 times the average; this is a planning estimate, not a measured traffic curve.

### Request rates

- **Uploads:** `1,000,000 photos/day ÷ 86,400 seconds/day ≈ 11.6 uploads/second` on average.
- **Feed views:** `1,000,000 users × 50 feed pages/user/day = 50,000,000 feed views/day`.
- **Average feed views:** `50,000,000 ÷ 86,400 ≈ 579 feed views/second`.
- **Peak feed views:** `579 × 5 ≈ 2,895 feed views/second`.
- If uploads followed the same 5× peak factor, the estimated peak would be approximately `58 uploads/second`; upload peaks may not coincide with feed-view peaks.

### Annual photo storage

Each uploaded photo and its thumbnail require `2 MB + 0.05 MB = 2.05 MB`.

- Original photos: `1,000,000 × 2 MB × 365 = 730,000,000 MB = 730 TB/year`.
- Thumbnails: `1,000,000 × 0.05 MB × 365 = 18,250,000 MB = 18.25 TB/year`.
- **Total new image-file storage:** `748,250,000 MB = 748.25 TB/year`, or about **0.75 PB/year** in decimal units.

This is raw object storage growth before any replication, backups, multiple thumbnail sizes, or storage-system overhead. It assumes uploads occur every day at the stated DAU rate and that files are not deleted.

## Read/write profile and image storage

SnapShare is **read-heavy**: the stated workload produces 50 million feed views per day for 1 million photo uploads per day, or about 50 feed views per upload. The architecture should therefore cache popular feed data and serve image files through a CDN, while keeping database reads off the primary where possible.

Photo binaries should not be stored as database fields: at roughly 748 TB of new image files per year, doing so would inflate database storage and backups and make serving large files less efficient. Store the original photos and generated thumbnails in object storage, and keep their object keys, ownership, timestamps, and other searchable metadata in the database.

## Architecture

```text
                         ┌──────────────────────┐
                         │        Users         │
                         └───┬───────┬──────┬───┘
             feed/image GET  │       │      │ direct photo upload
                             ▼       │      │ (signed upload URL)
                       ┌──────────┐  │      └────────────────────────┐
                       │   CDN    │  │                               │
                       └────┬─────┘  │ API requests                  ▼
                            │        ▼                       ┌─────────────────┐
                            │  ┌───────────────┐              │ Object storage │
                            │  │ Load balancer │              │ originals and  │
                            │  └───────┬───────┘              │ thumbnails     │
                            │          ▼                      └───▲─────────┬───┘
                            │  ┌───────────────┐                  │         │
                            │  │ App servers   │                  │         │ image
                            │  └──┬────┬────┬──┘                  │         │ origin
                            │     │    │    └────────────►┌────────┴────┐   │
                            │     │    │ enqueue job      │ Thumbnail  │   │
                            │  ┌──▼──┐ ┌▼────────────┐    │ worker     │   │
                            │  │Cache│ │ Primary DB  │    └─────▲──────┘   │
                            │  └─────┘ └──────┬─────┘          │          │
                            │                 │ replication    │          │
                            │          ┌──────▼──────┐    ┌────┴─────┐    │
                            │          │ Read replica│    │  Queue   │    │
                            │          └─────────────┘    └──────────┘    │
                            └─────────────────────────────────────────────┘
```

### Component responsibilities

- **CDN:** Caches and delivers photos and thumbnails near users, reducing origin bandwidth and image-load latency.
- **Load balancer:** Distributes API traffic across healthy app servers and prevents any one server from becoming the bottleneck.
- **App servers:** Authenticate users, handle feed and upload APIs, coordinate metadata operations, and enqueue thumbnail work.
- **Cache:** Holds frequently requested feed results and other hot data so the app can respond without querying the database each time.
- **Primary database:** Stores authoritative user, follow, photo-metadata, and feed-related records and accepts writes.
- **Read replica:** Serves eligible read queries from a replicated copy to reduce read load on the primary database.
- **Object storage:** Stores the large original photo and thumbnail files durably without placing their bytes in database rows.
- **Queue:** Buffers thumbnail jobs so uploads can complete without waiting for image processing and so jobs can be retried.
- **Thumbnail worker:** Reads queued jobs, creates resized image variants, saves them to object storage, and updates their metadata.

## Photo upload flow

1. The user requests an upload through the app; the app server authenticates the user and creates a pending photo-metadata record.
2. The app returns an upload destination for the original image in object storage, and the client uploads the photo there (a direct upload avoids routing the large file through the app server).
3. After the object is stored, the app records or finalizes its object key and queues a thumbnail-generation job with the photo ID and object key.
4. The app confirms the upload without waiting for thumbnail creation, so image processing does not hold up the user-facing request.
5. A thumbnail worker takes the job, reads the original from object storage, creates the thumbnail, and writes the thumbnail object back to storage.
6. The worker updates the photo metadata to mark the thumbnail as ready; the CDN can then cache and deliver the original and thumbnail when requested.

## Trade-offs

- **Direct-to-object-storage uploads vs. proxying uploads through app servers:** Direct uploads reduce app-server bandwidth and make large uploads easier to scale, but require a secure upload-destination flow and handling of incomplete uploads.
- **Asynchronous thumbnails vs. synchronous processing:** A queue makes upload responses faster and absorbs traffic spikes, but a thumbnail may not be available immediately and the system needs retries and a way to surface processing failures.
- **Aggressive caching/CDN vs. freshest feed data:** Caching reduces database load and latency, but feed changes and privacy changes may take time to appear unless cache invalidation or short expirations are used.
- **Read replica vs. primary-only reads:** A replica increases read capacity, but replication lag can briefly make recently written metadata unavailable to reads routed to the replica.
