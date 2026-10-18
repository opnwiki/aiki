# Admin traffic analytics

The `/admin` page includes a private traffic report for node owners and administrators.

- `GET /api/admin/analytics` is protected by `requireNodeAdmin` and is never cached publicly.
- The report aggregates unique visitors, page views, countries, human devices and browsers, named bots, recent visits, and the most-viewed published materials.
- The analytics table keeps the trusted client IP for up to 30 days. A per-IP HMAC digest is used for unique-visitor counts.
- Raw `User-Agent` values are not stored. The server stores only the recognized visitor kind, client/bot label, device, operating system, and browser family.
- Country codes are read only from `CF-IPCountry`, `X-Country-Code`, or `X-Geo-Country` when the application receives the request from its loopback reverse proxy.
- The public footer shows only the green status dot, the count, and the server-version tooltip; detailed traffic data is not public.
