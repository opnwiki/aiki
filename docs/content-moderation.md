# Page moderation

## Policy: AI-first review

AIKI's canonical policy is that a neural model handles moderation and acceptance of changes. This covers page edits, replies, and content-task solutions. By default the model reviews a solution and then either accepts it and applies the new revision, or rejects it with a reason and an audit record.

A human can turn AI moderation off for the node or for an individual item. Only in that mode is the human review flow enabled. Until this transition is complete in code, the existing community/manual and human-review APIs are a compatibility layer and should not be read as the final product policy.

Independent providers and models are chosen for content filling and for moderation. The settings live in a single **AI settings** block in the admin page; one provider's secrets are never sent to another.

The filling provider has two model roles: the **agent model** for writing articles, research, and task execution, and the **fast model** for page type detection, short overviews, and direct answers to questions. If no fast model is set, those requests use the agent model.

There are three modes. The first is the default. The second is set by an administrator in the admin page for the whole node. The third is enabled by the node administrator and is labelled "not recommended".

Assigning moderators, an access matrix for the node and branches, and a convenient edit-comparison screen with a single confirm button are the next layer. For now the existing roles are used: node owner, administrator, and moderator, and for a branch, leader and moderator if such a record already exists in `branch_roles`. There is no dedicated screen for assigning these roles yet.

## 1. Community

A new page is published without a queue. A page from the form or from MCP still starts as accessible by link: the author opens it to everyone. An order with publication consent and an accepted task still become public unless the node is switched to manual review.

Community edits and confirmations sit on top of the page. A proposal does not change the text until a node moderator accepts it. A proposal has a score: up votes and down votes. A high score raises the edit in the list. A low negative score does not hide or delete the edit.

The page author can mark "agree" or "disagree". The mark does not withdraw the edit. A proposal cannot be deleted: there is no such action, and a moderator's rejection keeps the record with status `rejected`.

## 2. Model review

This is a node-wide setting. An owner or administrator sets it in the admin page: the OpenRouter or OpenAI provider, the model name, and the key. The key is stored in the node database and is never returned by the API again. A custom model address is accepted only as public `https`. The loopback address `127.0.0.1` is allowed for testing on the same machine. Private networks and redirects are not used.

While review is enabled, it checks all articles and materials. It runs on update, republication, and text changes. Reading a page does not call the model.

In page management, an owner or administrator can turn the switch off for an individual page. A page with the switch off is not checked on update, republication, or change.

The model answers with JSON `{"ok":true}` or `{"ok":false,"reason":"..."}`. If the answer is fine, the page stays as it was. If not, the page is switched to "accessible by link" or "author only" — the administrator chooses which in the node settings. A network error or an unparseable answer does not hide the page: the check is marked `failed`. A later clean answer does not automatically return the page to public access. Access can still be changed manually.

Tests never make a paid call. The pipeline calls an OpenAI-compatible `POST /chat/completions`, and the local check substitutes its own address.

## 3. Manual review

Not recommended. The node administrator enables this mode in the settings. A new page gets status `pending`: it is not in the list or search, and by link it can be opened by the author, node moderators, and the moderator or leader of its branch. For everyone else the address responds as a missing page.

Approval makes the page public. Rejection leaves it visible only to the author. Authors cannot approve their own pages. A note of 8–2000 characters is written to the audit log.

This is close to the pre-moderation of a traditional wiki and conflicts with AIKI's usual path, where a page goes live immediately and the community edits on top. That is why the interface labels this mode "not recommended".

Full node and branch access — who assigns a moderator, what their limits are, how this works across several branches — is designed and built separately. For now the decision is made by the node owner, administrator, or moderator, or by the leader or moderator of the branch the page belongs to.
