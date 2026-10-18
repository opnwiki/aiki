## What changes

Briefly: which pages, APIs, MCP tools, or documents this touches.

## Why

The problem this solves. Link the issue if there is one (`Closes #…`).

## How it was checked

- [ ] `npm run check:js` and `npm test` pass
- [ ] For UI changes: light theme, dark theme, 390px width, no horizontal scroll (screenshots welcome)
- [ ] Database writes only on a disposable database, removed afterwards
- [ ] No test accounts or orders were created on public nodes such as `aiki.wiki`

Describe what you ran and what you deliberately did not run.

## Boundaries

- [ ] A migration, if any, is a new numbered file; no applied SQL was edited.
- [ ] The diff contains no `.env`, keys, cookies, or passwords.
- [ ] Page bodies stay Markdown; sources and authorship are not moved into in-text templates.
- [ ] Docs are updated if behavior or configuration changed.
