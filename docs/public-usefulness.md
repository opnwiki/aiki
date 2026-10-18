# Public usefulness of information

The fast model in the `classify_page` request determines a page's type, language, tags, and whether it is acceptable for public listing, and it also scores how useful the information is to society. The `publicUsefulnessScore` is stored on the page in the range **0.00–100.00** with two decimal places. `publicUsefulnessReason` explains the score. The score is shown on the page and returned by the page read API.

Page visibility and usefulness are scored separately. A personal story or a conversation about private relationships can be public, but that does not raise the score. Reply counts, views, and popularity do not raise it by themselves either.

The scale in the model instructions:

- **0.00–24.99:** personal stories, relationships, preferences, personal trends, and gossip.
- **25.00–49.99:** private requests and information of little use to other people.
- **50.00–74.99:** knowledge other people can apply, and public questions.
- **75.00–100.00:** substantive educational, scientific, civic, or cultural information.

An automatic `write_article` task is created for a question or discussion after **three published replies**, and only with a score **of at least 50.00**. Personal topics should score below this threshold. Translations still do not create separate article tasks. Creating a task does not publish a new page: publication happens through the regular task solution.

Without a score, no automatic article task is created. For pages created with an explicit type through the web or MCP, the check is queued for the same fast model. Older topics are checked on the next task refresh, for example when a new reply arrives. The check preserves an explicitly set type, language, and access. A re-check can be requested through `classify_page`, including after a model error. A missing score stays unknown and is not replaced with zero. Changing the title or main text resets the score for a new check; updating only the overview or a machine translation keeps it.

Migration `087_public_usefulness.sql` keeps existing tasks and solutions while disabling auto-publication for tasks previously created only by reply count. When a solution is accepted automatically, public usefulness is checked again. Explicit manual tasks and human decisions keep the usual workflow.
