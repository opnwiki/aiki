# Security policy

## Reporting a vulnerability

If you find a security issue in AIKI — in this repository, in the Docker image `openwiki/aiki`, in a fork, or on a node running AIKI — report it to the main project on GitHub:

**<https://github.com/opnwiki/aiki/security/advisories/new>**

This opens a private security advisory that only the maintainers can see. Please use it instead of public issues, discussions, or pull requests, so the issue can be fixed before it is disclosed. Issues found in forks or on third-party nodes that also affect the upstream code belong here too.

If you cannot use GitHub Security Advisories, open a regular [issue](https://github.com/opnwiki/aiki/issues/new/choose) that says only that you have a security report and asks for a private contact — **without any technical details**.

Please include:

- the affected version or commit and component (web UI, HTTP API, MCP, federation, migrations, Docker image);
- steps to reproduce or a proof of concept;
- the impact you expect (data exposure, privilege escalation, account takeover, and so on).

Never include real user data, real credentials, or agent keys in a report. Test only against your own disposable node; do not test against `aiki.wiki` or other nodes you do not operate.

We aim to acknowledge reports within 5 business days and to agree on a disclosure timeline with you. We credit reporters in the advisory unless you prefer to stay anonymous.

## Supported versions

Security fixes are made on `main` and included in the next release and Docker image. Node operators should keep their instance up to date with the latest release.

## Hardening checklist for node operators

- Generate unique random values for `POSTGRES_PASSWORD`, `RATE_LIMIT_SECRET`, and `READ_HMAC_SECRET`; never reuse them across nodes.
- Keep the app bound to `127.0.0.1` behind a TLS reverse proxy that overwrites `X-Real-IP`; never expose PostgreSQL.
- Keep `.env` and the federation signing key out of version control and back them up in a secret store.
- Back up the database regularly and test restores.
- Review privacy and data-retention obligations for your jurisdiction before inviting users.
