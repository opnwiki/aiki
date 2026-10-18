# Ordering an AI article from search

A reader who does not find a page can order one directly from the search results. This document describes the intake, eligibility checks, and data that the order flow stores.

## 1. Flow and intent

1. A user searches for a topic. A single "Order article" button is shown under the results for the whole search query.
2. The user creates an order. The server determines the client IP through the configured trusted proxy setup; a client-supplied `X-Forwarded-For` or an IP sent by the browser is never trusted.
3. The server calls `https://statica.me/user/<IP>?full`. A free order is allowed only when `response.security.is_clean === true` literally, and only if this IP has not already used its free attempt in the current UTC calendar day.
4. The API atomically records the attempt and stores a durable job with status `queued`. The polling API returns the same job.
5. A separate executor picks up queued jobs and runs the configured writing workflow (see [task-system.md](task-system.md)).

A search query about an object or concept should lead to an article; a question, a request for opinions, or an open prompt should lead to a discussion. The order stores the query and locale.

## 2. Statica and free eligibility

- The only decision source is the Statica endpoint with the `?full` suffix; the `security.is_clean` field must be a boolean.
- `true` can grant a free order; `false` or a malformed response denies it. A Statica failure, timeout, redirect, non-2xx status, invalid JSON, missing or non-boolean nested field, unknown IP, or wrong proxy context all fail closed.
- The response is limited in time (5 seconds) and size (256 KiB); redirects are not followed.
- An idempotent resubmission with the same search query, locale, and request token returns the existing task, does not write again, and does not consume a new daily quota.
- The daily quota is checked transactionally under a per-IP advisory lock; the day boundary is UTC, one accepted clean request per IP per day. Any Statica assessment of a valid API request, including one rejected for `is_clean` or the daily quota, may be recorded as a permanent attempt.

## 3. Data and storage

To make abuse harder, the order flow keeps users and linked accounts, IPs, and Statica objects without automatic deletion. Migration `011_search_article_orders.sql` separates:

- `article_order_assessments`: nullable account ID, the raw `client_ip` as `inet`, the full JSONB Statica response, the check result, query/locale, the outcome (accepted/rejected), the time, and the idempotency key hash;
- `article_order_submissions`: the durable queue state and the capability token hash, without copying the sensitive response again.

The attempts table is immutable: UPDATE and DELETE are blocked by a database trigger, and there is no automatic cleanup or retention job for these records. IPs, Statica bodies, tokens, and assessment requests are never written to logs, client responses, or public directories; the status API returns only a minimal set of fields for the capability token. The IP is used for anti-abuse and the daily quota, not as proof of identity.

**Operator note:** IPs and full Statica profiles are sensitive data and form a long-term observation history. Before running this flow in production, publish an appropriate privacy notice and legal basis, restrict access to the table and backups, define operator access rights, and check the privacy and data-retention laws that apply to your node. The "keep indefinitely" product behavior does not override mandatory legal requirements, error correction, or proper data protection.

## 4. Job API

- `POST /api/article-orders` accepts only the query and locale; the idempotency token is a separate `Idempotency-Key` header.
- A successful check creates a `queued` submission; the UI shows its ID. The access token is returned only to the creator and kept in session storage; the database stores only its hash.
- `GET /api/article-orders/{id}` requires the Bearer capability token. Status, error, and result path never reveal the client IP or the Statica payload.
- Orders are never marked complete and progress is never simulated without a real executor result.

## 5. Executor requirements

The executor is a separate durable consumer: idempotent, limited in resources and outbound access, with retry, reconciliation, and timeouts, and a safe internal way to publish. Agent and API credentials are kept only in the server secret store.
