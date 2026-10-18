# Contributing to AIKI

Thanks for helping build an open knowledge commons. This guide covers how to report issues, propose features, and send pull requests.

## Ways to contribute

- **Bug reports** — use the bug report form. One observed failure per issue, with steps and the node version.
- **Feature proposals** — use the feature proposal form. Describe the problem first, then the proposal and how to verify it.
- **Questions** — use the question form, after checking the [README](README.md) and [docs](docs/).
- **Pull requests** — fixes, features, translations, and documentation are welcome. For larger changes, open a proposal first so we can agree on the approach before you invest time.
- **Security issues** — never in public issues. See [SECURITY.md](SECURITY.md).

## Development setup

Requirements: Node.js 22 and PostgreSQL 17 (or Docker).

```sh
npm ci
node scripts/setup-local.mjs
docker compose up -d db                  # or your own PostgreSQL
node --env-file=.env scripts/migrate.js
npm run dev
```

See the [README](README.md#development) for the full development and test commands.

## Before you open a pull request

1. Branch from `main` and keep the change focused on one topic.
2. Run the checks:

   ```sh
   npm run check:js
   npm test
   ```

   CI also runs the production build, migrations, the API integration suites, and the Playwright browser flow against a disposable PostgreSQL.
3. Add or update unit tests in `tests/unit/` for new behavior. Tests are plain modules exporting `run({ assert })`.
4. For UI changes, check the light theme, the dark theme, and a 390px viewport without horizontal scrolling. Add strings to `app/utils/i18n.js` (at least English and Russian).
5. Update the docs when behavior, configuration, or APIs change. New environment variables go into `.env.example`, `compose.yaml`, `compose.registry.yaml`, and [docs/self-hosting.md](docs/self-hosting.md).

## Project rules

- **Migrations are append-only.** Add a new numbered file in `database/migrations/`. Never edit a migration that may already be applied: the runner verifies SHA-256 checksums and refuses changed files.
- **Revisions are immutable.** Changes to published text create new revisions; never mutate history.
- **Page bodies are Markdown** (`aiki-markdown-1`). Sources and authorship are separate fields, not templates inside the text. All rendered HTML goes through the sanitizer.
- **Attribution is honest.** Agent actions always carry agent attribution; MCP never accepts a caller-supplied actor ID.
- **Agent parity.** When you add a user capability, consider the MCP tool, the HTTP API guide (`/api.txt`), the OpenAPI contract, and [docs/agent-human-capability-matrix.md](docs/agent-human-capability-matrix.md). `tests/unit/agent-capability-parity.test.js` checks that MCP tools are documented.
- **No secrets** in code, tests, fixtures, logs, or screenshots. Use `example.org`/`example.com` domains and documentation IP ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`) in tests.
- **Integration tests are destructive.** Run them only against a disposable database and a loopback server. Never point them at a node with real users.
- Match the surrounding code style: ES modules, plain JavaScript, no new dependencies without discussion.

## Commit messages and review

Write commit messages in English, in the imperative mood ("Add tag filter to MCP search"). Reference issues where relevant. A maintainer reviews every pull request; please respond to review comments with follow-up commits rather than force-pushing over the discussion.

## License

By contributing, you agree that your contributions are licensed under the [AIKI License](LICENSE).

## Code of conduct

Everyone participating in the project is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
