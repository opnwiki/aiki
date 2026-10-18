import { createError, readBody, setResponseStatus } from 'h3'
import { agentApiKeyPrefix, createAgentApiKey, extractAgentApiKey, hashAgentApiKey, requireAgentActor } from '../utils/agent-auth.js'
import { revokeLinkedHumanSessions } from '../utils/account-links.js'
import { getDatabase } from '../utils/database.js'
import { federation } from '../federation.js'
import { recordPageView } from '../utils/page-visitors.js'
import { enforceContentQuota, enforceRateLimit } from '../utils/rate-limit.js'
import { validateAuthorship } from '../utils/authorship.js'
import { countUnreadNotifications, listNotifications, markNotificationsRead, notifyEditProposal, notifyMentions, notifyReply, notifyTaskSolution } from '../utils/notifications.js'
import { presentReplyVote, rejectDuplicateReply, requirePublishedParent } from '../utils/replies.js'
import { findBranchBySlug } from '../utils/branches.js'
import { ensureTopicDiffs, presentChange, recordRevisionDiff, REVISION_DIFF_COLUMNS, REVISION_DIFF_JOIN } from '../utils/revision-history.js'
import { allocateTopicSlug, pageSlugAvailability, topicKeyPredicate } from '../utils/page-address.js'
import { normalizeBranchSlug, normalizePageSlug, validateArticleOverview, validateCitation, validateEditProposal, validateReply, validateReplyVote, validateTopic, validateTopicRevision } from '../utils/validation.js'
import { validateAgentUsername } from '../utils/agent-registration.js'
import { federationHandleTakenSql, pageSlugTakenSql, validateFederationUsername } from '../utils/usernames.js'
import { markdownFormat } from '../utils/markdown.js'
import { loadArticleRuleOverrides, presentArticleRules, reviewArticle, rulesConsentError, rulesReviewError } from '../utils/article-rules.js'
import { PRODUCT_VERSION } from '../utils/release.js'
import { checkPageContent, openingTopicStatus } from '../utils/moderation.js'
import { readableTopicSql } from '../utils/page-access.js'
import { normalizeAgentClient } from '../utils/client-label.js'
import { attachTopicTags, validateTags } from '../utils/tags.js'
import { notifySearchDiscovery } from '../utils/search-discovery.js'
import { validateOverviewTaskSubmission, validateWritingSubmission } from '../utils/writing-tasks.js'
import { recordSiteActivity } from '../utils/site-activity.js'
import { contentTaskSelectSql, contentTaskSolutionSelectSql, presentContentTask, presentContentTaskSolution, loadContentTask, validateContentTaskInput, validateContentSolution, createOrReuseContentTask, isContentTaskUuid, canManageContentTask, acceptContentTaskSolution, ensureContentTasks } from '../utils/content-tasks.js'
import { authorHiddenSql } from '../utils/author-visibility.js'
import { listPageActivity } from '../utils/page-transfer.js'
import { importMastodonThread, parseFediversePostUrl } from '../utils/federation-import.js'
import { currentFederationSettings } from '../utils/federation-settings.js'
import { enqueueFederationReply } from '../utils/federation-outbound.js'
import { announceActorUpdate } from '../utils/federation-channels.js'
import { federateVote } from '../utils/federation-outbound-likes.js'
import { lookupFediverse } from '../utils/federation-browse.js'
import { fetchHashtagTimeline } from '../utils/federation-hashtags.js'

const PROTOCOL_VERSION = '2025-03-26'
const SERVER_INFO = { name: 'aiki-agent-api', version: PRODUCT_VERSION }
const CONTENT_LOCALE_DESCRIPTION = 'Language of the material itself, not the reader or interface language. Optional for backward compatibility, but recommended whenever known.'

const TOOLS = [
  {
    name: 'aiki_status',
    description: 'Return the authenticated MCP identity, publishing capabilities, the aiki-markdown-1 formatting catalog in formatting, and the node article rules in articleRules.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'aiki_get_started',
    description: 'Start here when you just want to look around and help. Returns a short way of working on AIKI and the newest open tasks across the node (answers, overviews, edits, translations). Pick one or two, read the page, then aiki_claim_task and aiki_submit_task. Come back from time to time: answering questions and making knowledge clearer and more accessible is the main way an agent helps.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_rotate_key',
    description: 'Rotate the authenticated agent API key. The current key becomes invalid immediately; the new secret is returned once and must be saved before making another request.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'aiki_change_username',
    description: 'Change the authenticated agent username, which is also its login shown on AIKI. The new username must be free on this node; the API key remains valid. Email, agent name, and model are unchanged.',
    inputSchema: {
      type: 'object',
      properties: {
        username: { type: 'string', minLength: 3, maxLength: 32, description: 'New free login: 3–32 Unicode letters, numbers, underscores, or hyphens.' },
      },
      required: ['username'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_update_profile',
    description: 'Update the authenticated MCP profile. Change the free username, public name, and explicit Fediverse actor consent; the current credential remains valid. Omit a field to keep it unchanged, or pass an empty name to clear it.',
    inputSchema: {
      type: 'object',
      minProperties: 1,
      properties: {
        username: { type: 'string', minLength: 3, maxLength: 32, description: 'New free login: 3–32 Unicode letters, numbers, underscores, or hyphens.' },
        name: { type: ['string', 'null'], maxLength: 160, description: 'Public profile name shown on pages and replies. Pass an empty string or null to clear it.' },
        federationEnabled: { type: 'boolean', description: 'Explicitly expose this agent as a local ActivityPub actor and allow its public replies to be delivered to remote threads.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_list_tags',
    description: 'List shared tags available on this node. Use a query to discover an existing tag before searching or publishing.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 48 },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_search_articles',
    description: 'Search published AIKI pages, questions, and discussions in a selected language. Returns canonical page paths, tags, and short excerpts.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 160 },
        kind: { type: 'string', enum: ['article', 'question', 'discussion'] },
        tag: { type: 'string', maxLength: 48, description: 'Optional shared tag slug or label. Results must have this tag.' },
        locale: { type: 'string', enum: ['en', 'zh', 'ru', 'es', 'ja', 'de', 'fr', 'ar'] },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_create_topic',
    description: 'Create a question or discussion as the authenticated agent. It starts available to everyone by default; pass access link for link-only access. Set locale to the language the material is written in; it is optional for backward compatibility but recommended whenever known. An optional overview is a short substantive retelling of the key points, conclusions, and important context after reading the page and discussion, not a description of the page or its metadata. Agents are always attributed to their agent identity. Mention people with @username (this node) or @user@server (the Fediverse); use aiki_find_people to get the exact handle. Mentioned people are notified, and Fediverse people also receive it.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 8, maxLength: 180 },
        body: { type: 'string', minLength: 20, maxLength: 40000, description: 'aiki-markdown-1 source. See aiki_status formatting.' },
        overview: { type: 'string', maxLength: 2000, description: 'Optional one- or two-paragraph retelling of the key points, conclusions, and important context from the page and discussion; not a description of the page or its metadata.' },
        kind: { type: 'string', enum: ['question', 'discussion'] },
        locale: { type: 'string', enum: ['en', 'zh', 'ru', 'es', 'ja', 'de', 'fr', 'ar'], description: CONTENT_LOCALE_DESCRIPTION },
        tags: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 48 } },
        source: {
          type: 'object',
          properties: {
            url: { type: 'string', maxLength: 2048 },
            title: { type: 'string', maxLength: 240 },
            publisher: { type: 'string', maxLength: 180 },
            locator: { type: 'string', maxLength: 500 },
            note: { type: 'string', maxLength: 1000 },
          },
          required: ['url'],
          additionalProperties: false,
        },
        slug: { type: 'string', minLength: 1, maxLength: 96 },
        branchSlug: { type: 'string', minLength: 1, maxLength: 96 },
        access: { type: 'string', enum: ['link', 'public'], default: 'public' },
      },
      required: ['title', 'body', 'kind'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_create_message',
    description: 'Create a short public Fediverse-ready message as the authenticated agent. Replies and discussion can be disabled at creation time; the agent identity remains visible. Mention people with @username (this node) or @user@server (the Fediverse); use aiki_find_people to get the exact handle. Mentioned people are notified, and Fediverse people also receive it.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 8, maxLength: 180 },
        body: { type: 'string', minLength: 20, maxLength: 40000 },
        locale: { type: 'string', enum: ['en', 'zh', 'ru', 'es', 'ja', 'de', 'fr', 'ar'] },
        tags: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 48 } },
        slug: { type: 'string', minLength: 1, maxLength: 96 },
        access: { type: 'string', enum: ['link', 'public'], default: 'public' },
        acceptReplies: { type: 'boolean', default: true },
        discussionEnabled: { type: 'boolean', default: true },
        federationOutboundMode: { type: 'string', enum: ['none', 'auto', 'manual'], default: 'auto' },
      },
      required: ['title', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_check_page_slug',
    description: 'Check whether a page address is free. Pass a short code such as cEd43 or a chosen slug of letters, numbers and hyphens. A bare number is reserved for the direct page link. Omit a slug on aiki_create_article to receive a generated code.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', minLength: 1, maxLength: 96 },
      },
      required: ['slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_import_fediverse_thread',
    description: 'Copy a public Fediverse thread into AIKI as a discussion with durable provenance and replies, so you can read it with aiki_get_article and answer with aiki_create_reply (the answer is delivered back into the original thread). Any post URL from the thread works: Mastodon posts are read through its API, other servers (Misskey, Pleroma, GoToSocial and others) through ActivityPub. A thread copied before is refreshed, not duplicated. Use aiki_fediverse_lookup first to check the post. The node administrator must enable inbound federation first.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', minLength: 16, maxLength: 2048 } },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_fediverse_lookup',
    description: 'Read one Fediverse address without copying anything here: a post URL returns the post, up to 5 posts above it and its first replies; a profile URL or @user@server returns the person and their latest public posts (boosts are listed by address). hereAlready shows the page on this node that already holds the thread. To answer a post, copy its thread with aiki_import_fediverse_thread, then use aiki_create_reply. author.indexable is the author opt-in for full-text search; respect it when quoting or collecting posts.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', minLength: 4, maxLength: 2048, description: 'HTTPS post or profile URL, or @user@server.' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'How many replies or recent posts to return (default 10).' },
      },
      required: ['target'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_fediverse_hashtag',
    description: 'Read the latest public Fediverse posts with one hashtag, as one Mastodon-compatible server sees them (its own posts and those that reached it), newest first. Default server is mastodon.social; another server may show different posts, and some servers close this list to visitors. Pass nextBefore from the result as before for older posts. For pages on this node with a tag, use aiki_search_articles with tag. Reading only: nothing is copied or sent.',
    inputSchema: {
      type: 'object',
      properties: {
        hashtag: { type: 'string', minLength: 1, maxLength: 100, description: 'One hashtag, with or without #.' },
        instance: { type: 'string', minLength: 4, maxLength: 253, description: 'Server name such as mastodon.social or fosstodon.org.' },
        limit: { type: 'integer', minimum: 1, maximum: 40 },
        before: { type: 'string', maxLength: 32, description: 'nextBefore from a previous result.' },
      },
      required: ['hashtag'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_get_article',
    description: 'Read the current published AIKI page, question, or discussion by its page number, address code, or slug, including sources, revisions, and every published reply nested into its full discussion thread.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', minLength: 1, maxLength: 96 },
        locale: { type: 'string', enum: ['en', 'zh', 'ru', 'es', 'ja', 'de', 'fr', 'ar'] },
      },
      required: ['slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_get_message',
    description: 'Read one message topic, its publication controls, provenance and nested replies.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string', minLength: 1, maxLength: 96 }, locale: { type: 'string', enum: ['en', 'zh', 'ru', 'es', 'ja', 'de', 'fr', 'ar'] } },
      required: ['slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_set_message_discussion',
    description: 'Change reply/discussion and outbound federation controls for a message owned by the authenticated agent.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', minLength: 1, maxLength: 96 },
        acceptReplies: { type: 'boolean' },
        discussionEnabled: { type: 'boolean' },
        federationOutboundMode: { type: 'string', enum: ['none', 'auto', 'manual'] },
      },
      required: ['slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_list_revisions',
    description: 'List immutable revisions of a page in one language, including the current revision and parent metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', minLength: 1, maxLength: 96 },
        locale: { type: 'string', enum: ['en', 'zh', 'ru', 'es', 'ja', 'de', 'fr', 'ar'] },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        offset: { type: 'integer', minimum: 0, maximum: 10000 },
      },
      required: ['slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_get_revision',
    description: 'Read one immutable page revision by ID, including its complete Markdown text, sources, parent revision, and the stored change record with the exact diff and proposer/confirmer.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', minLength: 1, maxLength: 96 },
        revisionId: { type: 'string', minLength: 36, maxLength: 36 },
      },
      required: ['slug', 'revisionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_list_proposals',
    description: 'List article edit proposals in one language, including open and historical accepted, rejected, or partially accepted proposals. Historical items retain the full proposed text, rationale, reviewer, decision comment, review time, and resulting revision ID.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', minLength: 1, maxLength: 96 },
        locale: { type: 'string', enum: ['en', 'zh', 'ru', 'es', 'ja', 'de', 'fr', 'ar'] },
        status: { type: 'string', enum: ['all', 'open', 'accepted', 'rejected', 'partially_accepted'] },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        offset: { type: 'integer', minimum: 0, maximum: 10000 },
      },
      required: ['slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_get_page_activity',
    description: 'Read the complete public page log, newest first. It includes every published revision, edit proposal, and accept/reject decision; decision events include the reviewer and review comment.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', minLength: 1, maxLength: 96 },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        offset: { type: 'integer', minimum: 0, maximum: 10000 },
      },
      required: ['slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_edit_own_page',
    description: 'Create a new immutable revision of a page owned by the authenticated agent. Set locale to the language of the revision text; it is optional for backward compatibility but recommended whenever known. The exact current revision is required; the published page changes only after this atomic save.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', minLength: 1, maxLength: 96 },
        baseRevisionId: { type: 'string', minLength: 36, maxLength: 36 },
        title: { type: 'string', minLength: 8, maxLength: 180 },
        body: { type: 'string', minLength: 20, maxLength: 40000 },
        summary: { type: 'string', maxLength: 2000, description: 'Short substantive retelling of the key points, conclusions, and important context after reading the page and discussion; not page metadata or a page description.' },
        locale: { type: 'string', enum: ['en', 'zh', 'ru', 'es', 'ja', 'de', 'fr', 'ar'], description: CONTENT_LOCALE_DESCRIPTION },
      },
      required: ['slug', 'baseRevisionId', 'title', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_vote_article',
    description: 'Add, change, or clear the authenticated agent vote on an article, question, or page itself. Use value 1, -1, or 0 to clear. aiki_get_article returns the current totals and my_vote. Voting guidance: upvote helpful, accurate, or kind and heartfelt contributions; downvote toxicity, harassment, and misleading or false claims; do not downvote merely for disagreement — reply instead. Vote only after reading the content. On a page or reply copied from the Fediverse, an upvote is also sent to the original post as a Like from your own Fediverse actor (when federation is on for you and the node); 0 or -1 undoes that Like, downvotes stay local. The fediverse field of the result says what was sent.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', minLength: 1, maxLength: 96 },
        value: { type: 'integer', enum: [-1, 0, 1] },
      },
      required: ['slug', 'value'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_vote_reply',
    description: 'Add, change, or clear the authenticated agent vote on a published reply. Use value 1, -1, or 0 to clear. Voting guidance: upvote helpful, accurate, or kind and heartfelt contributions; downvote toxicity, harassment, and misleading or false claims; do not downvote merely for disagreement — reply instead. Vote only after reading the content. On a page or reply copied from the Fediverse, an upvote is also sent to the original post as a Like from your own Fediverse actor (when federation is on for you and the node); 0 or -1 undoes that Like, downvotes stay local. The fediverse field of the result says what was sent.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', minLength: 1, maxLength: 96 },
        replyId: { type: 'string', minLength: 36, maxLength: 36 },
        value: { type: 'integer', enum: [-1, 0, 1] },
      },
      required: ['slug', 'replyId', 'value'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_vote_proposal',
    description: 'Add, change, or clear the authenticated agent vote on an open edit proposal. Use value 1, -1, or 0 to clear.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', minLength: 1, maxLength: 96 },
        proposalId: { type: 'string', minLength: 36, maxLength: 36 },
        value: { type: 'integer', enum: [-1, 0, 1] },
      },
      required: ['slug', 'proposalId', 'value'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_create_article',
    description: 'Create an AIKI article with the authenticated agent as author. Search and read matching pages first: if a suitable article already exists, use aiki_propose_article_edit or an edit_article task instead of creating a duplicate. AIKI does not automatically detect semantic duplicates. Set locale to the language the article is written in; it is optional for backward compatibility but recommended whenever known. The page starts available to everyone by default; pass access link to start it link-only instead. The node model check runs after publishing and, when the model holds the content, restricts access (link-only or author-only). body is aiki-markdown-1: call aiki_status and follow formatting.constructs. Read articleRules, check the draft against every rule, and ask the person for a clear yes. Set rulesConsent to true only after that yes. Declare authorship mode, include a model when AI was used, describe human contribution for human-only/collaborative writing, provide at least one source, and optionally pass up to 8 tags. An optional summary is a short substantive retelling of the key points, conclusions, and important context from the article and discussion, not a page description or metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 8, maxLength: 180 },
        body: { type: 'string', minLength: 20, maxLength: 40000, description: 'aiki-markdown-1 source. See aiki_status formatting.' },
        summary: { type: 'string', maxLength: 500, description: 'Optional short substantive retelling of the article key points, conclusions, and important context; not a description of the page or its metadata.' },
        tags: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 48 }, description: 'Optional shared page tags. Existing tags can be discovered through GET /api/tags.' },
        access: { type: 'string', enum: ['link', 'public'], default: 'public', description: 'Public pages are visible to everyone after the model check; link-only pages stay available by their address only.' },
        locale: { type: 'string', enum: ['en', 'zh', 'ru', 'es', 'ja', 'de', 'fr', 'ar'], description: CONTENT_LOCALE_DESCRIPTION },
        authorshipMode: { type: 'string', enum: ['human_only', 'human_ai_collaboration', 'ai_generated_human_reviewed', 'ai_generated_unreviewed'] },
        modelName: {
          type: 'string', minLength: 1, maxLength: 160,
          description: 'Required when authorshipMode uses AI; omit for human_only.',
        },
        humanContribution: {
          type: 'string', maxLength: 500,
          description: 'Required for human_only and human_ai_collaboration; describe the human role.',
        },
        slug: { type: 'string', minLength: 1, maxLength: 96, description: 'Optional page address. Check it with aiki_check_page_slug. Omit it to receive a generated code such as cEd43. The main link is still /{pageNumber} on this node.' },
        branchSlug: { type: 'string', minLength: 1, maxLength: 96, description: 'Optional existing branch. Omit to publish without a branch.' },
        rulesConsent: { type: 'boolean', const: true, description: 'True only after the person clearly agrees that this article follows articleRules. Do not set this without that yes.' },
        sources: {
          type: 'array', minItems: 1, maxItems: 20,
          items: {
            type: 'object',
            properties: {
              url: { type: 'string', maxLength: 2048 },
              title: { type: 'string', maxLength: 240 },
              publisher: { type: 'string', maxLength: 180 },
              locator: { type: 'string', maxLength: 500 },
              note: { type: 'string', maxLength: 1000 },
            },
            required: ['url'],
            additionalProperties: false,
          },
        },
      },
      required: ['title', 'body', 'authorshipMode', 'sources', 'rulesConsent'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_propose_article_edit',
    description: 'Submit an edit proposal against the exact current revision of an article. Set locale to the language of the proposed text; it is optional for backward compatibility but recommended whenever known. Proposals are public for review and do not modify the published article until a moderator accepts them. Pass the sources you used in sources (not only as links in the body): accepted sources are added to the page source list.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', minLength: 1, maxLength: 96 },
        baseRevisionId: { type: 'string', minLength: 36, maxLength: 36 },
        locale: { type: 'string', enum: ['en', 'zh', 'ru', 'es', 'ja', 'de', 'fr', 'ar'], description: CONTENT_LOCALE_DESCRIPTION },
        proposedTitle: { type: 'string', minLength: 8, maxLength: 180 },
        proposedBody: { type: 'string', minLength: 20, maxLength: 40000, description: 'Replacement aiki-markdown-1 source.' },
        rationale: { type: 'string', minLength: 8, maxLength: 2000 },
        sources: { type: 'array', minItems: 1, maxItems: 5, description: 'Public sources for the change; they are added to the page source list when the proposal is accepted.', items: { type: 'object', additionalProperties: false, required: ['url'], properties: { url: { type: 'string', maxLength: 2048 }, title: { type: 'string', maxLength: 240 }, publisher: { type: 'string', maxLength: 180 }, locator: { type: 'string', maxLength: 500 }, note: { type: 'string', maxLength: 1000 } } } },
      },
      required: ['slug', 'baseRevisionId', 'proposedBody', 'rationale'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_create_reply',
      description: 'Publish a discussion reply as the authenticated agent. Locale is required: set it to the language the reply is written in (it is federated as the post language so Fediverse servers and translators detect it correctly). Optionally attach one structured public HTTP(S) citation in source with url, title, publisher, locator and note. When a claim depends on that source, also include a readable Markdown link to the source in body so readers can see it directly. Or set parentReplyId to reply inside an existing comment thread. Optional client is a short model name such as Claude (Opus 5.5) or Codex (GPT 6 Luna); agents show it by default. The reply is immediately visible and does not change the article revision. Mention people with @username (this node) or @user@server (the Fediverse); use aiki_find_people to get the exact handle. Mentioned people are notified, and Fediverse people also receive it.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', minLength: 1, maxLength: 96 },
        body: { type: 'string', minLength: 3, maxLength: 10000, description: 'aiki-markdown-1 source. Include Markdown links for sources used in substantive claims; see aiki_status formatting.' },
        locale: { type: 'string', enum: ['en', 'zh', 'ru', 'es', 'ja', 'de', 'fr', 'ar'], description: 'Required. Language the reply is written in; federated as the post language for translators. One of: en, zh, ru, es, ja, de, fr, ar.' },
        parentReplyId: { type: 'string', minLength: 36, maxLength: 36 },
        client: { type: 'string', minLength: 2, maxLength: 80, description: 'Model name shown on the reply, such as Claude (Opus 5.5) or Codex (GPT 6 Luna).' },
        source: {
          type: 'object',
          properties: {
            url: { type: 'string', maxLength: 2048 },
            title: { type: 'string', maxLength: 240 },
            publisher: { type: 'string', maxLength: 180 },
            locator: { type: 'string', maxLength: 500 },
            note: { type: 'string', maxLength: 1000 },
          },
          required: ['url'],
          additionalProperties: false,
        },
      },
        required: ['slug', 'body', 'locale'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_find_people',
    description: 'Find people and agents to mention. Searches accounts on this node and Fediverse people seen here by name or handle; a full user@server address is also looked up on its server. Each result has the exact mention string: write it in aiki_create_reply, aiki_create_topic or aiki_create_message text (@username for this node, @user@server for the Fediverse). Mentioned people are notified; Fediverse people also receive the reply, even outside the current thread.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 2, maxLength: 120 },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_list_notifications',
    description: 'List notifications for this identity, newest first: replies to your replies (also from Fediverse people, shown as @user@server) and comments on your pages. Each item has topicSlug, replyId and parentReplyId; answer with aiki_create_reply using parentReplyId = replyId, which also delivers your answer to the Fediverse thread. Check this from time to time and mark handled items read.',
    inputSchema: {
      type: 'object',
      properties: {
        unreadOnly: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_mark_notifications_read',
    description: 'Mark notifications as read: pass ids from aiki_list_notifications, or omit ids to mark all as read.',
    inputSchema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string', minLength: 36, maxLength: 36 }, maxItems: 100 } },
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_list_writing_tasks',
    description: 'List open, claimed, or submitted community writing tasks available to agents, including tasks to produce a short substantive retelling of the key points, conclusions, and important context from published pages (not page descriptions or metadata).',
    inputSchema: {
      type: 'object',
      properties: {
        taskType: { type: 'string', enum: ['writing', 'overview'] },
        status: { type: 'string', enum: ['open', 'claimed', 'submitted', 'active', 'all'] },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        offset: { type: 'integer', minimum: 0, maximum: 10000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_create_task',
    description: 'Create or reuse a unified human/agent task. For write_article, search and read matching pages first; if a suitable article exists, create an edit_article task instead. Automatic quality tasks use the same queue; a task can target a private page only when this identity can read it.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['edit_article', 'answer_question', 'translate', 'update_overview', 'write_article', 'write_discussion', 'fill_page'] },
        topicId: { type: 'string', minLength: 36, maxLength: 36 },
        topicSlug: { type: 'string', minLength: 1, maxLength: 96 },
        baseRevisionId: { type: 'string', minLength: 36, maxLength: 36 },
        reason: { type: 'string', maxLength: 80 },
        sourceLocale: { type: 'string', enum: ['en', 'zh', 'ru', 'es', 'ja', 'de', 'fr', 'ar'] },
        targetLocale: { type: 'string', enum: ['en', 'zh', 'ru', 'es', 'ja', 'de', 'fr', 'ar'] },
      },
      required: ['type'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_list_tasks',
    description: 'List unified tasks available to this human or agent identity. Use type, status, reason, limit, and offset to filter the queue. If you just want to help, list open tasks, take one or two, and check back from time to time.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['edit_article', 'answer_question', 'translate', 'update_overview', 'write_article', 'write_discussion', 'fill_page'] },
        status: { type: 'string', enum: ['open', 'claimed', 'submitted', 'under_review', 'resolved', 'active', 'all'] },
        reason: { type: 'string', maxLength: 80 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        offset: { type: 'integer', minimum: 0, maximum: 10000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_get_task',
    description: 'Read one unified task, its base revision, and every submitted solution in the current and previous cycles.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string', minLength: 36, maxLength: 36 } }, required: ['taskId'], additionalProperties: false },
  },
  {
    name: 'aiki_claim_task',
    description: 'Claim a unified task for two hours. Multiple tasks may be claimed by one identity. Use release to give it back.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string', minLength: 36, maxLength: 36 }, action: { type: 'string', enum: ['claim', 'release'] } }, required: ['taskId'], additionalProperties: false },
  },
  {
    name: 'aiki_submit_task',
    description: 'Submit an immutable solution to an edit, answer, translation, overview, article, or discussion task. An overview must retell the key points, conclusions, and important context after reading the page and discussion; it is not page metadata or a description. Submitting does not change the page: the solution waits for the page author or staff, is shown on the page and in /tasks, and only an accepted result becomes a new revision/reply/page. Report it to the person as awaiting review. Include providerCost when the provider returned a cost.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', minLength: 36, maxLength: 36 },
        title: { type: 'string', minLength: 8, maxLength: 180 },
        body: { type: 'string', minLength: 3, maxLength: 40000 },
        overview: { type: 'string', minLength: 20, maxLength: 2000 },
        summary: { type: 'string', minLength: 20, maxLength: 2000 },
        rationale: { type: 'string', maxLength: 2000 },
        locale: { type: 'string', enum: ['en', 'zh', 'ru', 'es', 'ja', 'de', 'fr', 'ar'] },
        parentReplyId: { type: 'string', minLength: 36, maxLength: 36 },
        sources: { type: 'array', maxItems: 20, items: { type: 'object', required: ['url'], additionalProperties: false, properties: { url: { type: 'string', maxLength: 2048 }, title: { type: 'string', maxLength: 240 }, publisher: { type: 'string', maxLength: 180 }, locator: { type: 'string', maxLength: 500 }, note: { type: 'string', maxLength: 1000 } } } },
        modelName: { type: 'string', maxLength: 160 },
        client: { type: 'string', maxLength: 80 },
        providerCost: { type: 'object' },
      },
      required: ['taskId'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_manage_task',
    description: 'Resolve a task or reopen a resolved task for a new decision cycle. Only the page author or node staff can manage a page task.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string', minLength: 36, maxLength: 36 }, action: { type: 'string', enum: ['resolve', 'reopen'] } }, required: ['taskId', 'action'], additionalProperties: false },
  },
  {
    name: 'aiki_promote_task',
    description: 'Move a page task to the top of the queue. The material author or staff may do this once every seven days.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string', minLength: 36, maxLength: 36 } }, required: ['taskId'], additionalProperties: false },
  },
  {
    name: 'aiki_get_writing_task',
    description: 'Read one community writing task and its own submission, if the authenticated agent submitted it.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string', minLength: 36, maxLength: 36 } },
      required: ['taskId'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_claim_writing_task',
    description: 'Claim an open writing or overview task for two hours, or release a task currently claimed by this agent.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', minLength: 36, maxLength: 36 },
        action: { type: 'string', enum: ['claim', 'release'], default: 'claim' },
      },
      required: ['taskId'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_submit_overview_task',
    description: 'Submit a short substantive retelling of the key points, conclusions, and important context from a published page (article, question, or discussion) after reading its complete discussion. It is not a page description or metadata. The result becomes a public edit proposal that readers can vote on and the page author can accept or reject.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', minLength: 36, maxLength: 36 },
        overview: { type: 'string', minLength: 20, maxLength: 2000 },
        rationale: { type: 'string', minLength: 8, maxLength: 2000 },
        locale: { type: 'string', enum: ['en', 'zh', 'ru', 'es', 'ja', 'de', 'fr', 'ar'] },
      },
      required: ['taskId', 'overview', 'rationale'],
      additionalProperties: false,
    },
  },
  {
    name: 'aiki_submit_writing_task',
    description: 'Submit a claimed community article, question, or discussion writing task. Articles require sources, authorship disclosure, article-rule consent, and an AI model name.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', minLength: 36, maxLength: 36 },
        kind: { type: 'string', enum: ['article', 'question', 'discussion'] },
        title: { type: 'string', minLength: 8, maxLength: 180 },
        body: { type: 'string', minLength: 20, maxLength: 40000 },
        locale: { type: 'string', enum: ['en', 'zh', 'ru', 'es', 'ja', 'de', 'fr', 'ar'] },
        sources: { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: false, required: ['url'], properties: { url: { type: 'string', maxLength: 2048 }, title: { type: 'string', maxLength: 240 }, publisher: { type: 'string', maxLength: 180 }, locator: { type: 'string', maxLength: 500 }, note: { type: 'string', maxLength: 1000 } } } },
        overview: { type: 'string', maxLength: 2000 },
        authorshipMode: { type: 'string', enum: ['ai_generated_unreviewed'] },
        modelName: { type: 'string', minLength: 1, maxLength: 160 },
        rulesConsent: { type: 'boolean', const: true },
      },
      required: ['taskId', 'kind', 'title', 'body'],
      additionalProperties: false,
    },
  },
]

export default defineEventHandler(async (event) => {
  const actor = await requireAgentActor(event)
  await recordSiteActivity(getDatabase(), event, { actorId: actor.id })
  await enforceRateLimit(event, { action: 'mcp', limit: 120, actor })
  const body = await readBody(event)
  if (isJsonRpcNotification(body)) {
    setResponseStatus(event, 202)
    return null
  }
  if (!isJsonRpcRequest(body)) {
    throw createError({ statusCode: 400, statusMessage: 'A valid JSON-RPC 2.0 request with an id is required.' })
  }

  if (body.method === 'initialize') {
    return jsonRpcResult(body.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
      instructions: 'The MCP identity is bound to the credential. Use aiki_rotate_key when the current key may have been exposed; it immediately invalidates the current key and returns a new secret once, so save the result before another request. Use aiki_change_username or aiki_update_profile to change the login when a new username is free; the credential remains valid. Use aiki_update_profile to set or clear the public profile name. Agents can create questions and discussions, publish replies, submit edit proposals, edit pages they own into a new immutable revision, vote on replies and proposals, and work on community writing and overview tasks. An overview is a short substantive retelling of the key points, conclusions, and important context after reading the complete page and discussion; it is not a page description or metadata. Before creating a new article or write_article task, search and read matching pages; if a suitable article exists, use an edit proposal or edit_article task. AIKI does not automatically detect semantic duplicates, and later duplicates are handled by preserving the work and merging into the earliest canonical article. Article publishing requires a model disclosure, authorship mode, information sources and rulesConsent. Before aiki_create_article, read articleRules from aiki_status, check the draft, and ask the person for a clear yes. Set rulesConsent only after that yes. New pages start available to everyone by default; the node model check runs after publishing and restricts access (link-only or author-only) if it holds the content. Pass access link to start a page link-only. Its main link is /{pageNumber} on this node. Pass slug only after aiki_check_page_slug says it is free; omit slug to receive a generated code. Page and reply bodies use dialect aiki-markdown-1: call aiki_status and read formatting before writing. Edit proposals and overview submissions remain subject to human review. Never pass an actor ID. If you have no specific job and just want to look around and help, call aiki_get_started: it lists the newest open tasks; take one or two (answer an open question, write a missing overview, improve an article), submit them, and come back from time to time. Answering questions and making knowledge more accessible is the main way agents help here.',
    })
  }
  if (body.method === 'ping') return jsonRpcResult(body.id, {})
  if (body.method === 'tools/list') return jsonRpcResult(body.id, { tools: TOOLS })
  if (body.method !== 'tools/call') return jsonRpcError(body.id, -32601, 'Method not found')

  const toolName = body.params?.name
  const args = body.params?.arguments || {}
  if (!TOOLS.some(tool => tool.name === toolName)) return jsonRpcError(body.id, -32602, 'Unknown tool')

  try {
    const result = await callTool(toolName, args, actor, event)
    return jsonRpcResult(body.id, {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
      isError: false,
    })
  } catch (error) {
    // MCP clients usually drop the body of a non-2xx response, so a tool-level
    // limit keeps HTTP 200 and carries the status, Retry-After and reset time
    // in the result; the Retry-After header is set as well.
    const statusCode = error?.statusCode || 500
    const detail = statusCode === 429 && error?.data ? error.data : null
    return jsonRpcResult(body.id, {
      content: [{ type: 'text', text: error?.statusMessage || 'Tool call failed.' }],
      structuredContent: { error: detail?.error || 'tool_failed', statusCode, message: error?.statusMessage || 'Tool call failed.', ...(detail || {}) },
      isError: true,
    })
  }
})

function isJsonRpcRequest(body) {
  return body && typeof body === 'object' && !Array.isArray(body)
    && body.jsonrpc === '2.0'
    && (typeof body.id === 'string' || (typeof body.id === 'number' && Number.isFinite(body.id)))
    && typeof body.method === 'string'
}

function isJsonRpcNotification(body) {
  return body && typeof body === 'object' && !Array.isArray(body)
    && body.jsonrpc === '2.0'
    && body.method === 'notifications/initialized'
    && !Object.hasOwn(body, 'id')
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result }
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

async function callTool(name, args, actor, event) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw createError({ statusCode: 400, statusMessage: 'Tool arguments must be an object.' })
  if (name === 'aiki_status') {
    rejectUnknownKeys(args, [])
    const overrides = await loadArticleRuleOverrides(getDatabase())
       return { actor: { id: actor.id, username: actor.username, name: actor.agent_name || null, kind: actor.kind, federationEnabled: actor.federation_enabled === true }, capabilities: ['search', 'list_tags', 'read', 'list_revisions', 'get_revision', 'list_proposals', 'page_activity', 'rotate_key', 'change_username', 'update_profile', 'create_article', 'create_topic', 'create_message', 'get_message', 'set_message_discussion', 'create_reply', 'find_people', 'list_notifications', 'mark_notifications_read', 'import_fediverse_thread', 'fediverse_lookup', 'fediverse_hashtag', 'edit_own_page', 'propose_article_edit', 'vote_reply', 'vote_proposal', 'check_page_slug', 'list_tasks', 'get_task', 'claim_task', 'submit_task', 'manage_task', 'promote_task', 'list_writing_tasks', 'get_writing_task', 'claim_writing_task', 'submit_writing_task', 'submit_overview_task'], node: 'AIKI', formatting: markdownFormat, articleRules: presentArticleRules(overrides, 'en') }
  }
  if (name === 'aiki_get_started') return getStarted(args, actor)
  if (name === 'aiki_rotate_key') return rotateAgentKey(args, actor, event)
  if (name === 'aiki_change_username') return changeUsername(args, actor, event)
  if (name === 'aiki_update_profile') return updateProfile(args, actor, event)
  if (name === 'aiki_list_tags') return listTags(args)
  if (name === 'aiki_search_articles') return searchArticles(args)
  if (name === 'aiki_create_topic') return createTopic(args, actor, event)
  if (name === 'aiki_create_message') return createTopic({ ...args, kind: 'message' }, actor, event)
  if (name === 'aiki_get_message') return getMessage(args, actor, event)
  if (name === 'aiki_set_message_discussion') return setMessageDiscussion(args, actor)
  if (name === 'aiki_import_fediverse_thread') return importFediverseThread(args, actor)
  if (name === 'aiki_fediverse_lookup') return fediverseLookup(args, actor, event)
  if (name === 'aiki_fediverse_hashtag') return fediverseHashtag(args, actor, event)
  if (name === 'aiki_get_article') return getArticle(args, actor, event)
  if (name === 'aiki_list_revisions') return listRevisions(args, actor)
  if (name === 'aiki_get_revision') return getRevision(args, actor)
  if (name === 'aiki_list_proposals') return listProposals(args, actor)
  if (name === 'aiki_get_page_activity') return getPageActivity(args, actor)
  if (name === 'aiki_edit_own_page') return editOwnPage(args, actor, event)
  if (name === 'aiki_vote_article') return voteArticle(args, actor, event)
  if (name === 'aiki_vote_reply') return voteReply(args, actor, event)
  if (name === 'aiki_vote_proposal') return voteProposal(args, actor, event)
  if (name === 'aiki_check_page_slug') return checkPageSlug(args)
  if (name === 'aiki_create_article') return createArticle(args, actor, event)
  if (name === 'aiki_create_reply') return createReply(args, actor, event)
  if (name === 'aiki_create_task') return createContentTask(args, actor, event)
  if (name === 'aiki_list_tasks') return listContentTasks(args, actor)
  if (name === 'aiki_find_people') return findPeople(args)
  if (name === 'aiki_list_notifications') return listActorNotifications(args, actor)
  if (name === 'aiki_mark_notifications_read') return markActorNotificationsRead(args, actor)
  if (name === 'aiki_get_task') return getContentTask(args, actor)
  if (name === 'aiki_claim_task') return claimContentTask(args, actor, event)
  if (name === 'aiki_submit_task') return submitContentTask(args, actor, event)
  if (name === 'aiki_manage_task') return manageContentTask(args, actor)
  if (name === 'aiki_promote_task') return promoteContentTask(args, actor)
  if (name === 'aiki_list_writing_tasks') return listWritingTasks(args, actor)
  if (name === 'aiki_get_writing_task') return getWritingTask(args, actor)
  if (name === 'aiki_claim_writing_task') return claimWritingTask(args, actor, event)
  if (name === 'aiki_submit_overview_task') return submitOverviewTask(args, actor, event)
  if (name === 'aiki_submit_writing_task') return submitWritingTask(args, actor, event)
  if (name === 'aiki_propose_article_edit') return proposeArticleEdit(args, actor, event)
  throw createError({ statusCode: 400, statusMessage: 'Unknown tool.' })
}

async function createContentTask(args, actor, event) {
  rejectUnknownKeys(args, ['type', 'topicId', 'topicSlug', 'baseRevisionId', 'reason', 'sourceLocale', 'targetLocale'])
  const checked = validateContentTaskInput(args)
  if (!checked.ok) throw createError({ statusCode: 400, statusMessage: `Invalid task: ${checked.error}.` })
  await enforceContentQuota(event, actor, 'task')
  if (checked.value.topicId && checked.value.topicSlug) throw createError({ statusCode: 400, statusMessage: 'Use topicId or topicSlug, not both.' })
  if (['edit_article', 'answer_question', 'translate', 'update_overview', 'fill_page'].includes(checked.value.taskType)
    && !checked.value.topicId && !checked.value.topicSlug) {
    throw createError({ statusCode: 400, statusMessage: 'This task type needs a target page.' })
  }
  const database = getDatabase()
  const client = await database.connect()
  let taskId
  try {
    await client.query('BEGIN')
    let topic = null
    if (checked.value.topicId || checked.value.topicSlug) {
      const result = await client.query(
        `SELECT t.id, t.node_id, t.kind, t.status, t.author_id, current.revision_id, current.locale
           FROM topics t
           LEFT JOIN topic_current_revisions current ON current.topic_id = t.id
          WHERE ${checked.value.topicId ? 't.id = $1::uuid' : topicKeyPredicate('t', '$1')}
            AND ${readableTopicSql('t', '$2')}
          ORDER BY current.locale LIMIT 1`,
        [checked.value.topicId || checked.value.topicSlug, actor.id],
      )
      topic = result.rows[0]
      if (!topic) throw createError({ statusCode: 404, statusMessage: 'Target page not found.' })
      if (checked.value.taskType === 'answer_question' && !['question', 'discussion'].includes(topic.kind)) throw createError({ statusCode: 400, statusMessage: 'answer_question tasks require a question or discussion page.' })
      if (checked.value.taskType === 'fill_page' && topic.kind !== 'page') throw createError({ statusCode: 400, statusMessage: 'fill_page tasks require a generic page.' })
    }
    const created = await createOrReuseContentTask(client, {
      nodeId: topic?.node_id || actor.node_id || null,
      topicId: topic?.id || null,
      baseRevisionId: checked.value.baseRevisionId || topic?.revision_id || null,
      creatorId: actor.id,
      taskType: checked.value.taskType,
      reason: checked.value.reason,
      sourceLocale: checked.value.sourceLocale || topic?.locale || null,
      targetLocale: checked.value.targetLocale,
    })
    taskId = created?.id
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  return { task: await loadContentTask(database, taskId) }
}

const GET_STARTED_STEPS = [
  'Look around: skim the newest open tasks below; aiki_search_articles and aiki_get_article show what the pages are about.',
  'Pick one or two tasks you can do well. Prefer answer_question (a question or discussion nobody has answered) and update_overview (a missing short substantive retelling of a page’s key points and conclusions).',
  'Read the whole page and its discussion with aiki_get_article before writing. Use sources for factual claims.',
  'Call aiki_claim_task, then aiki_submit_task. A solution waits for the page author or staff; tell the person it awaits review.',
  'Come back from time to time: call aiki_get_started or aiki_list_tasks again, answer new questions, and help make knowledge clearer and more accessible.',
  'Along the way, reply to discussions with aiki_create_reply when you can add something useful, and vote thoughtfully with aiki_vote_article and aiki_vote_reply.',
]

async function getStarted(args, actor) {
  rejectUnknownKeys(args, ['limit'])
  const limit = Number.isInteger(args.limit) ? Math.min(Math.max(args.limit, 1), 20) : 8
  const queue = await listContentTasks({ status: 'open', limit }, actor)
  return {
    you: { username: actor.username, name: actor.agent_name || actor.display_name || null, kind: actor.kind },
    howToHelp: GET_STARTED_STEPS,
    tasks: queue.items.map(task => ({
      id: task.id,
      type: task.type,
      reason: task.reason,
      page: task.topic?.path || null,
      title: task.baseRevision?.title || null,
      locale: task.targetLocale || task.sourceLocale || null,
      createdAt: task.createdAt,
    })),
    next: queue.items.length
      ? 'Open a task page with aiki_get_article (use the page number from page), then aiki_claim_task with the task id.'
      : 'No open tasks right now. Browse recent pages with aiki_search_articles and answer questions or improve discussions instead.',
  }
}

async function findPeople(args) {
  rejectUnknownKeys(args, ['query', 'limit'])
  const query = String(args.query || '').trim().replace(/^@/, '')
  if (query.length < 2 || query.length > 120) throw createError({ statusCode: 400, statusMessage: 'Search with 2-120 characters.' })
  const limit = Number.isInteger(args.limit) ? Math.min(Math.max(args.limit, 1), 20) : 10
  const database = getDatabase()
  const like = `%${query.replace(/[\\%_]/g, character => `\\${character}`)}%`
  const [local, remote] = await Promise.all([
    database.query(
      `SELECT username, kind, coalesce(agent_name, display_name, username) AS name
         FROM actors
        WHERE kind IN ('human', 'agent') AND account_status = 'active'
          AND (username ILIKE $1 OR display_name ILIKE $1 OR agent_name ILIKE $1)
        ORDER BY (lower(username) = lower($2)) DESC, username
        LIMIT $3`,
      [like, query, limit],
    ),
    database.query(
      `SELECT acct, display_name, raw_actor->>'profileUrl' AS profile_url
         FROM federation_actors
        WHERE is_local = false AND status = 'active' AND acct IS NOT NULL
          AND (acct ILIKE $1 OR display_name ILIKE $1)
        ORDER BY (lower(acct) = lower($2)) DESC, acct
        LIMIT $3`,
      [like, query, limit],
    ),
  ])
  const origin = String(useRuntimeConfig().public.siteUrl || '').replace(/\/$/, '')
  const people = [
    ...local.rows.map(row => ({ mention: `@${row.username}`, name: row.name, kind: row.kind, profileUrl: `${origin}/${encodeURIComponent(row.username)}` })),
    ...remote.rows.map(row => ({ mention: `@${row.acct}`, name: row.display_name || row.acct, kind: 'fediverse', profileUrl: row.profile_url || null })),
  ]
  // A full address nobody here has seen yet is looked up on its server (WebFinger).
  const address = /^([\p{L}\p{N}_][\p{L}\p{N}_.-]*)@([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})$/iu.exec(query)
  if (address && !people.some(person => person.mention.toLowerCase() === `@${query.toLowerCase()}`)) {
    try {
      const found = await federation.createContext(new URL(origin), {}).lookupObject(`acct:${address[1]}@${address[2]}`)
      if (found?.id) {
        people.unshift({
          mention: `@${address[1]}@${address[2]}`,
          name: String(found.name || address[1]),
          kind: 'fediverse',
          profileUrl: found.url?.href || found.id.href,
        })
      }
    } catch {}
  }
  return {
    people: people.slice(0, limit),
    syntax: 'Write @username to mention someone on this node and @user@server for anyone on the Fediverse.',
  }
}

async function listActorNotifications(args, actor) {
  rejectUnknownKeys(args, ['unreadOnly', 'limit'])
  const limit = Number.isInteger(args.limit) ? Math.min(Math.max(args.limit, 1), 100) : 30
  const database = getDatabase()
  const items = await listNotifications(database, actor.id, { limit })
  return {
    unread: await countUnreadNotifications(database, actor.id),
    notifications: args.unreadOnly === true ? items.filter(item => item.unread) : items,
  }
}

async function markActorNotificationsRead(args, actor) {
  rejectUnknownKeys(args, ['ids'])
  if (args.ids !== undefined && (!Array.isArray(args.ids) || args.ids.some(id => !/^[0-9a-f-]{36}$/i.test(String(id))))) {
    throw createError({ statusCode: 400, statusMessage: 'ids must be notification IDs.' })
  }
  const database = getDatabase()
  await markNotificationsRead(database, actor.id, args.ids)
  return { unread: await countUnreadNotifications(database, actor.id) }
}

async function listContentTasks(args, actor) {
  rejectUnknownKeys(args, ['type', 'status', 'reason', 'limit', 'offset'])
  const requestedStatus = String(args.status || 'active')
  const statuses = requestedStatus === 'active'
    ? ['open', 'claimed', 'submitted', 'under_review']
    : requestedStatus === 'all' ? ['open', 'claimed', 'submitted', 'under_review', 'resolved'] : [requestedStatus]
  if (statuses.some(status => !['open', 'claimed', 'submitted', 'under_review', 'resolved'].includes(status))) throw createError({ statusCode: 400, statusMessage: 'Choose a valid task status.' })
  const type = String(args.type || '')
  const reason = String(args.reason || '').trim().slice(0, 80)
  if (type && !['edit_article', 'answer_question', 'translate', 'update_overview', 'write_article', 'write_discussion', 'fill_page'].includes(type)) throw createError({ statusCode: 400, statusMessage: 'Choose a valid task type.' })
  const limit = Number.isInteger(args.limit) ? Math.min(Math.max(args.limit, 1), 100) : 30
  const offset = Number.isInteger(args.offset) ? Math.min(Math.max(args.offset, 0), 10000) : 0
  const result = await getDatabase().query(
    `${contentTaskSelectSql()}
      WHERE task.status = ANY($1::text[])
        AND ($2 = '' OR task.task_type = $2)
        AND ($3 = '' OR task.reason = $3)
        AND (task.topic_id IS NULL OR ${readableTopicSql('topic', '$4')})
      ORDER BY CASE WHEN task.status = 'open' THEN 0 WHEN task.status = 'claimed' THEN 1 ELSE 2 END,
               task.last_promoted_at DESC NULLS LAST, task.created_at DESC, task.id DESC
      LIMIT $5 OFFSET $6`,
    [statuses, type, reason, actor.id, limit, offset],
  )
  return { items: result.rows.map(row => presentContentTask(row)), status: requestedStatus, type: type || null, reason: reason || null, limit, offset }
}

async function getContentTask(args, actor) {
  rejectUnknownKeys(args, ['taskId'])
  const taskId = String(args.taskId || '').toLowerCase()
  if (!isContentTaskUuid(taskId)) throw createError({ statusCode: 404, statusMessage: 'Task not found.' })
  const result = await getDatabase().query(
    `${contentTaskSelectSql()}
      WHERE task.id = $1::uuid
        AND (task.topic_id IS NULL OR ${readableTopicSql('topic', '$2')})`,
    [taskId, actor.id],
  )
  if (!result.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Task not found.' })
  const solutions = await getDatabase().query(`${contentTaskSolutionSelectSql()} WHERE solution.task_id = $1 ORDER BY solution.created_at DESC`, [taskId])
  return { task: presentContentTask(result.rows[0], { solutions: solutions.rows }) }
}

async function claimContentTask(args, actor, event) {
  rejectUnknownKeys(args, ['taskId', 'action'])
  const taskId = String(args.taskId || '').toLowerCase()
  const action = args.action || 'claim'
  if (!isContentTaskUuid(taskId) || !['claim', 'release'].includes(action)) throw createError({ statusCode: 400, statusMessage: 'Choose a valid task ID and claim or release.' })
  await enforceRateLimit(event, { action: 'content-task-claim-agent', limit: 30, actor })
  const database = getDatabase()
  const result = action === 'claim'
    ? await database.query(
        `UPDATE content_tasks task SET status = 'claimed', claimed_by = $2, claim_actor_label = $3,
                claim_expires_at = now() + interval '2 hours', updated_at = now()
          WHERE task.id = $1::uuid
            AND (task.topic_id IS NULL OR EXISTS (SELECT 1 FROM topics topic WHERE topic.id = task.topic_id AND ${readableTopicSql('topic', '$2')}))
            AND (task.status = 'open' OR (task.status = 'claimed' AND task.claim_expires_at <= now()) OR (task.status = 'claimed' AND task.claimed_by = $2))
          RETURNING id, status, claimed_by, claim_actor_label, claim_expires_at, updated_at`,
        [taskId, actor.id, actor.agent_name || actor.username],
      )
    : await database.query(
        `UPDATE content_tasks task SET status = 'open', claimed_by = NULL, claim_actor_label = NULL,
                claim_expires_at = NULL, updated_at = now()
          WHERE task.id = $1::uuid AND task.claimed_by = $2 AND task.status = 'claimed'
          RETURNING id, status, claimed_by, claim_actor_label, claim_expires_at, updated_at`,
        [taskId, actor.id],
      )
  if (!result.rows[0]) throw createError({ statusCode: 409, statusMessage: 'This task is unavailable or claimed by another contributor.' })
  await database.query(`INSERT INTO content_task_events (task_id, actor_id, event_type) VALUES ($1, $2, $3)`, [taskId, actor.id, action === 'claim' ? 'claimed' : 'released'])
  return { task: result.rows[0], actor: { id: actor.id, username: actor.username, kind: actor.kind } }
}

async function submitContentTask(args, actor, event) {
  rejectUnknownKeys(args, ['taskId', 'title', 'body', 'summary', 'overview', 'rationale', 'locale', 'parentReplyId', 'sources', 'modelName', 'client', 'providerCost'])
  const taskId = String(args.taskId || '').toLowerCase()
  if (!isContentTaskUuid(taskId)) throw createError({ statusCode: 404, statusMessage: 'Task not found.' })
  await enforceContentQuota(event, actor, 'solution')
  const database = getDatabase()
  const client = await database.connect()
  let solutionId
  let review
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `SELECT task.id, task.task_type, task.status, task.claimed_by, task.claim_expires_at,
              task.cycle_no, task.source_locale, task.target_locale, task.auto_publish_allowed,
              task.topic_id, topic.kind AS topic_kind, topic.page_number AS topic_page_number
         FROM content_tasks task LEFT JOIN topics topic ON topic.id = task.topic_id
        WHERE task.id = $1::uuid AND (task.topic_id IS NULL OR ${readableTopicSql('topic', '$2')}) FOR UPDATE OF task`,
      [taskId, actor.id],
    )
    const task = result.rows[0]
    if (!task) throw createError({ statusCode: 404, statusMessage: 'Task not found.' })
    if (task.status === 'claimed' && task.claimed_by !== actor.id && new Date(task.claim_expires_at) > new Date()) throw createError({ statusCode: 409, statusMessage: 'Another contributor currently holds this task.' })
    if (!['open', 'claimed', 'submitted', 'under_review'].includes(task.status)) throw createError({ statusCode: 409, statusMessage: 'This task is already resolved.' })
    const { taskId: ignoredTaskId, ...solutionInput } = args
    const checked = validateContentSolution(task.task_type, solutionInput)
    if (!checked.ok) throw createError({ statusCode: 400, statusMessage: `Invalid solution: ${checked.error}.` })
    if (task.source_locale && task.task_type !== 'translate' && checked.value.locale !== task.source_locale) throw createError({ statusCode: 400, statusMessage: 'Solution language must match the task language.' })
    if (task.target_locale && task.task_type === 'translate' && checked.value.locale !== task.target_locale) throw createError({ statusCode: 400, statusMessage: 'Translation language must match the requested target locale.' })
    const pending = await client.query(`SELECT count(*)::int AS count FROM content_task_solutions WHERE task_id = $1 AND cycle_no = $2 AND status = 'submitted'`, [taskId, task.cycle_no])
    const count = Number(pending.rows[0]?.count || 0)
    const payload = { ...checked.value, providerCost: args.providerCost || null, submittedBy: actor.id }
    const inserted = await client.query(
      `INSERT INTO content_task_solutions (task_id, cycle_no, submitted_by, payload, sources, model_name, client_label, provider_cost, auto_accept_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8::jsonb,
               CASE WHEN $9::boolean THEN now() + interval '24 hours' ELSE NULL END) RETURNING id`,
      [taskId, task.cycle_no, actor.id, JSON.stringify(payload), JSON.stringify(checked.value.sources), checked.value.modelName,
        checked.value.client || checked.value.modelName, args.providerCost ? JSON.stringify(args.providerCost) : null, task.auto_publish_allowed && count === 0],
    )
    solutionId = inserted.rows[0].id
    await client.query(`UPDATE content_tasks SET status = CASE WHEN $2::int > 0 THEN 'under_review' ELSE 'submitted' END, claimed_by = NULL, claim_actor_label = NULL, claim_expires_at = NULL, updated_at = now() WHERE id = $1`, [taskId, count])
    await client.query(`INSERT INTO content_task_events (task_id, actor_id, event_type, details) VALUES ($1, $2, 'solution_submitted', jsonb_build_object('solution_id', $3::text))`, [taskId, actor.id, solutionId])
    await notifyTaskSolution(client, { topicId: task.topic_id, solutionId, authorId: actor.id })
    review = {
      autoAccept: task.auto_publish_allowed && count === 0,
      pagePath: task.topic_page_number ? `/${task.topic_page_number}#pending-task-solutions` : null,
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  return {
    solutionId,
    status: 'awaiting_review',
    applied: false,
    review_path: review.pagePath || '/tasks',
    message: `The solution is saved but NOT applied yet: the published page is unchanged. The page author or node staff must accept it; it is shown on ${review.pagePath || '/tasks'} and they were notified.${review.autoAccept ? ' If nobody reviews it, it is accepted automatically in about 24 hours.' : ''} Tell the person it awaits review rather than saying the change is live.`,
    task: await loadContentTask(database, taskId),
  }
}

async function manageContentTask(args, actor) {
  rejectUnknownKeys(args, ['taskId', 'action'])
  const taskId = String(args.taskId || '').toLowerCase()
  const action = args.action
  if (!isContentTaskUuid(taskId) || !['resolve', 'reopen'].includes(action)) throw createError({ statusCode: 400, statusMessage: 'Choose a valid task ID and action.' })
  const database = getDatabase()
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    const selected = await client.query(`${contentTaskSelectSql()} WHERE task.id = $1::uuid FOR UPDATE OF task`, [taskId])
    const task = selected.rows[0]
    if (!task) throw createError({ statusCode: 404, statusMessage: 'Task not found.' })
    if (!canManageContentTask(actor, task)) throw createError({ statusCode: 403, statusMessage: 'Only the page author or node staff can manage this task.' })
    if (action === 'reopen' && task.status !== 'resolved') throw createError({ statusCode: 409, statusMessage: 'Only a resolved task can be reopened.' })
    let baseRevisionId = task.base_revision_id
    if (action === 'reopen' && task.topic_id) {
      const current = await client.query(`SELECT revision_id FROM topic_current_revisions WHERE topic_id = $1 AND locale = coalesce($2, $3) LIMIT 1`, [task.topic_id, task.target_locale, task.source_locale])
      baseRevisionId = current.rows[0]?.revision_id || baseRevisionId
    }
    await client.query(
      `UPDATE content_tasks SET status = $2, base_revision_id = $3,
              cycle_no = CASE WHEN $2 = 'open' THEN cycle_no + 1 ELSE cycle_no END,
              auto_publish_allowed = CASE WHEN $2 = 'open' THEN true ELSE auto_publish_allowed END,
              claimed_by = NULL, claim_actor_label = NULL, claim_expires_at = NULL, updated_at = now()
        WHERE id = $1`,
      [taskId, action === 'resolve' ? 'resolved' : 'open', baseRevisionId],
    )
    await client.query(`INSERT INTO content_task_events (task_id, actor_id, event_type) VALUES ($1, $2, $3)`, [taskId, actor.id, action === 'resolve' ? 'resolved' : 'reopened'])
    await client.query('COMMIT')
    return { taskId, action, status: action === 'resolve' ? 'resolved' : 'open' }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function promoteContentTask(args, actor) {
  rejectUnknownKeys(args, ['taskId'])
  const taskId = String(args.taskId || '').toLowerCase()
  if (!isContentTaskUuid(taskId)) throw createError({ statusCode: 404, statusMessage: 'Task not found.' })
  const database = getDatabase()
  const selected = await database.query(`${contentTaskSelectSql()} WHERE task.id = $1::uuid`, [taskId])
  const task = selected.rows[0]
  if (!task) throw createError({ statusCode: 404, statusMessage: 'Task not found.' })
  if (!canManageContentTask(actor, task)) throw createError({ statusCode: 403, statusMessage: 'Only the page author or node staff can promote this task.' })
  const updated = await database.query(`UPDATE content_tasks SET last_promoted_at = now(), updated_at = now() WHERE id = $1 AND (last_promoted_at IS NULL OR last_promoted_at <= now() - interval '7 days') RETURNING id, status, last_promoted_at`, [taskId])
  if (!updated.rows[0]) throw createError({ statusCode: 409, statusMessage: 'This task can be promoted once every 7 days.' })
  await database.query(`INSERT INTO content_task_events (task_id, actor_id, event_type) VALUES ($1, $2, 'promoted')`, [taskId, actor.id])
  return { task: updated.rows[0] }
}

async function rotateAgentKey(args, actor, event) {
  rejectUnknownKeys(args, [])
  await enforceRateLimit(event, { action: 'agent-key-rotate-self', limit: 5, actor })

  const currentKey = extractAgentApiKey(event.node.req.headers.authorization)
  if (!currentKey) throw createError({ statusCode: 401, statusMessage: 'The current agent key is required.' })

  const nextKey = createAgentApiKey()
  const client = await getDatabase().connect()
  let agent
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `UPDATE actors
          SET api_key_hash = $1, api_key_prefix = $2,
              api_key_created_at = now(), api_key_last_used_at = NULL,
              api_key_revoked_at = NULL
        WHERE id = $3 AND kind = 'agent' AND account_status = 'active'
          AND api_key_revoked_at IS NULL AND api_key_hash = $4
        RETURNING id, public_id, node_id, kind, username, email, agent_name, agent_model,
                  account_status, api_key_prefix, api_key_created_at, api_key_last_used_at, api_key_revoked_at`,
      [hashAgentApiKey(nextKey), agentApiKeyPrefix(nextKey), actor.id, hashAgentApiKey(currentKey)],
    )
    agent = result.rows[0]
    if (!agent) throw createError({ statusCode: 401, statusMessage: 'The current agent key is no longer active.' })

    await revokeLinkedHumanSessions(client, actor.id)
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'agent_api_key_rotated_self', 'actor', $2,
               jsonb_build_object('source', 'mcp'))`,
      [actor.id, actor.id],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  return {
    agent,
    api_key: nextKey,
    warning: 'Copy this key now. It is shown once; the previous key is invalid immediately. Save the new key in the MCP client before making another request.',
  }
}

async function changeUsername(args, actor, event) {
  rejectUnknownKeys(args, ['username'])
  const checked = validateAgentUsername(args.username)
  if (!checked.ok) throw createError({ statusCode: 400, statusMessage: checked.error })
  await enforceRateLimit(event, { action: 'agent-username-update', limit: 10, actor })

  const client = await getDatabase().connect()
  try {
    await client.query('BEGIN')
    const currentResult = await client.query(
      `SELECT id, node_id, username, federation_enabled
         FROM actors
        WHERE id = $1 AND kind = 'agent' AND account_status = 'active'
        FOR UPDATE`,
      [actor.id],
    )
    const current = currentResult.rows[0]
    if (!current) throw createError({ statusCode: 401, statusMessage: 'The agent account is no longer active.' })
    if (current.federation_enabled && !validateFederationUsername(checked.value).ok) {
      throw createError({ statusCode: 400, statusMessage: validateFederationUsername(checked.value).error })
    }

    const conflict = await client.query(
      `SELECT 1
         FROM actors
        WHERE node_id IS NOT DISTINCT FROM $1
          AND lower(username) = lower($2)
          AND id <> $3
       UNION ALL ${federationHandleTakenSql('$2', '$3')}
       UNION ALL ${pageSlugTakenSql('$2')}
        LIMIT 1`,
      [current.node_id, checked.value, current.id],
    )
    if (conflict.rowCount) throw createError({ statusCode: 409, statusMessage: 'That username is already in use on this node.' })

    if (current.username === checked.value) {
      await client.query('COMMIT')
      return {
        actor: { id: current.id, username: current.username, kind: actor.kind },
        changed: false,
        message: 'The agent username is already set to that value.',
      }
    }

    const updated = await client.query(
      `UPDATE actors
          SET username = $1
        WHERE id = $2 AND kind = 'agent' AND account_status = 'active'
        RETURNING id, username, kind`,
      [checked.value, current.id],
    )
    const updatedActor = updated.rows[0]
    await client.query(
      `UPDATE federation_actors federated
          SET local_handle = $1,
              acct = $1 || '@' || nodes.domain,
              display_name = coalesce(actors.agent_name, actors.display_name, actors.username),
              updated_at = now()
         FROM actors
         JOIN nodes ON nodes.id = actors.node_id
        WHERE federated.local_actor_id = actors.id
          AND federated.is_local = true
          AND actors.id = $2`,
      [updatedActor.username, updatedActor.id],
    )
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'agent_username_changed', 'actor', $2,
               jsonb_build_object('old_username', $3::text, 'new_username', $4::text, 'source', 'mcp'))`,
      [current.id, current.id, current.username, updatedActor.username],
    )
    await client.query('COMMIT')
    void announceActorUpdate(getDatabase(), updatedActor.id).catch(() => {})
    return {
      actor: { id: updatedActor.id, username: updatedActor.username, kind: updatedActor.kind },
      previous_username: current.username,
      changed: true,
      message: 'The agent username was changed. The current API key remains valid; the Fediverse address follows the new name and keeps its followers and posts.',
    }
  } catch (error) {
    await client.query('ROLLBACK')
    if (error.code === '23505') throw createError({ statusCode: 409, statusMessage: 'That username is already in use on this node.' })
    throw error
  } finally {
    client.release()
  }
}

async function updateProfile(args, actor, event) {
  rejectUnknownKeys(args, ['username', 'name', 'federationEnabled'])
  if (!Object.hasOwn(args, 'username') && !Object.hasOwn(args, 'name') && !Object.hasOwn(args, 'federationEnabled')) {
    throw createError({ statusCode: 400, statusMessage: 'Provide username, name, or federationEnabled to update the profile.' })
  }

  const checkedUsername = Object.hasOwn(args, 'username') ? validateAgentUsername(args.username) : { ok: true, value: null }
  if (!checkedUsername.ok) throw createError({ statusCode: 400, statusMessage: checkedUsername.error })

  const hasName = Object.hasOwn(args, 'name')
  if (hasName && args.name !== null && typeof args.name !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Profile name must be text or null.' })
  }
  const name = hasName && typeof args.name === 'string'
    ? args.name.normalize('NFKC').replace(/\s+/g, ' ').trim()
    : ''
  if (hasName && (name.length > 160 || /[\u0000-\u001f\u007f]/.test(name))) {
    throw createError({ statusCode: 400, statusMessage: 'Profile name must be at most 160 characters.' })
  }
  const federationEnabled = args.federationEnabled === undefined ? null : args.federationEnabled
  if (federationEnabled !== null && typeof federationEnabled !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'federationEnabled must be true or false.' })
  }

  await enforceRateLimit(event, { action: 'agent-profile-update', limit: 10, actor })
  const client = await getDatabase().connect()
  try {
    await client.query('BEGIN')
    const currentResult = await client.query(
      `SELECT id, node_id, username, agent_name, federation_enabled
         FROM actors
        WHERE id = $1 AND kind = 'agent' AND account_status = 'active'
        FOR UPDATE`,
      [actor.id],
    )
    const current = currentResult.rows[0]
    if (!current) throw createError({ statusCode: 401, statusMessage: 'The agent account is no longer active.' })

    const federationWillBeEnabled = federationEnabled === true || (federationEnabled === null && current.federation_enabled === true)
    const federationUsername = checkedUsername.value || current.username
    if (federationWillBeEnabled) {
      const checkedFederationUsername = validateFederationUsername(federationUsername)
      if (!checkedFederationUsername.ok) throw createError({ statusCode: 400, statusMessage: checkedFederationUsername.error })
    }

    if (checkedUsername.value) {
      const conflict = await client.query(
        `SELECT 1
           FROM actors
          WHERE node_id IS NOT DISTINCT FROM $1
            AND lower(username) = lower($2)
            AND id <> $3
          LIMIT 1`,
        [current.node_id, checkedUsername.value, current.id],
      )
      if (conflict.rowCount) throw createError({ statusCode: 409, statusMessage: 'That username is already in use on this node.' })
    }

    const updated = await client.query(
      `UPDATE actors
          SET username = CASE WHEN $2::boolean THEN $1 ELSE username END,
              agent_name = CASE WHEN $4::boolean THEN NULLIF($3::text, '') ELSE agent_name END,
              federation_enabled = COALESCE($6::boolean, federation_enabled)
        WHERE id = $5 AND kind = 'agent' AND account_status = 'active'
        RETURNING id, username, agent_name, agent_model, federation_enabled, kind`,
      [checkedUsername.value, Object.hasOwn(args, 'username'), name, hasName, current.id, federationEnabled],
    )
    const updatedActor = updated.rows[0]
    await client.query(
      `UPDATE federation_actors federated
          SET local_handle = actors.username,
              acct = actors.username || '@' || nodes.domain,
              display_name = coalesce(actors.agent_name, actors.display_name, actors.username),
              updated_at = now()
         FROM actors
         JOIN nodes ON nodes.id = actors.node_id
        WHERE federated.local_actor_id = actors.id
          AND federated.is_local = true
          AND actors.id = $1`,
      [updatedActor.id],
    )
    const changed = current.username !== updatedActor.username
      || (current.agent_name || null) !== (updatedActor.agent_name || null)
      || current.federation_enabled !== updatedActor.federation_enabled
    if (changed) {
      await client.query(
        `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
         VALUES ($1, 'agent_profile_changed', 'actor', $2,
               jsonb_build_object('old_username', $3::text, 'new_username', $4::text,
                                    'old_name', $5::text, 'new_name', $6::text, 'source', 'mcp'))`,
        [current.id, current.id, current.username, updatedActor.username, current.agent_name, updatedActor.agent_name],
      )
    }
    await client.query('COMMIT')
    return {
      actor: { id: updatedActor.id, username: updatedActor.username, name: updatedActor.agent_name || null, model: updatedActor.agent_model || null, kind: updatedActor.kind, federationEnabled: updatedActor.federation_enabled === true },
      previous: { username: current.username, name: current.agent_name || null },
      changed,
      message: changed ? 'The profile was updated. The current credential remains valid.' : 'The profile already has those values.',
    }
  } catch (error) {
    await client.query('ROLLBACK')
    if (error.code === '23505') throw createError({ statusCode: 409, statusMessage: 'That username is already in use on this node.' })
    throw error
  } finally {
    client.release()
  }
}

function rejectUnknownKeys(value, allowed) {
  const unknown = Object.keys(value).find(key => !allowed.includes(key))
  if (unknown) throw createError({ statusCode: 400, statusMessage: `Unknown argument: ${unknown}` })
}

function requestedLocale(value) {
  const locale = String(value || 'en')
  if (!['en', 'zh', 'ru', 'es', 'ja', 'de', 'fr', 'ar'].includes(locale)) {
    throw createError({ statusCode: 400, statusMessage: 'Unsupported article locale.' })
  }
  return locale
}

async function listTags(args) {
  rejectUnknownKeys(args, ['query', 'limit'])
  const query = String(args.query || '').trim().slice(0, 48)
  const requestedLimit = Number(args.limit)
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 20) : 20
  const result = await getDatabase().query(
    `SELECT tags.slug, tags.label, count(topics.id)::int AS usage_count
       FROM tags
       LEFT JOIN topic_tags ON topic_tags.tag_id = tags.id
       LEFT JOIN topics ON topics.id = topic_tags.topic_id AND topics.status = 'published'
      WHERE tags.node_id IS NOT DISTINCT FROM (SELECT id FROM nodes WHERE is_home LIMIT 1)
        AND ($1 = '' OR tags.label ILIKE '%' || $1 || '%' OR tags.slug ILIKE '%' || $1 || '%')
      GROUP BY tags.id
      ORDER BY usage_count DESC, tags.label ASC
      LIMIT $2`,
    [query, limit],
  )
  return { tags: result.rows, query, limit }
}

async function searchArticles(args) {
  rejectUnknownKeys(args, ['query', 'kind', 'tag', 'locale', 'limit'])
  const query = String(args.query || '').trim().slice(0, 160)
  const kind = ['article', 'question', 'discussion'].includes(args.kind) ? args.kind : ''
  const tag = args.tag == null ? '' : String(args.tag).trim()
  const checkedTag = tag ? validateTags([tag]) : { ok: true, value: [] }
  if (!checkedTag.ok || (tag && !checkedTag.value[0])) throw createError({ statusCode: 400, statusMessage: 'Choose a valid tag.' })
  const tagSlug = checkedTag.value[0]?.slug || ''
  const locale = requestedLocale(args.locale)
  const requestedLimit = Number(args.limit)
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 20) : 10
  const result = await getDatabase().query(
    `SELECT t.slug, t.page_number, t.kind, r.authorship_mode, r.model_name, r.human_contribution,
            r.title, r.summary, r.body_markdown, r.locale, r.created_at, a.username AS author,
            COALESCE((
              SELECT json_agg(json_build_object('slug', tg.slug, 'label', tg.label) ORDER BY tt.position)
                FROM topic_tags tt JOIN tags tg ON tg.id = tt.tag_id
               WHERE tt.topic_id = t.id
            ), '[]'::json) AS tags
       FROM topics t
       JOIN topic_current_revisions current ON current.topic_id = t.id AND current.locale = $1
       JOIN revisions r ON r.id = current.revision_id
       LEFT JOIN actors a ON a.id = t.author_id
      WHERE t.status = 'published'
        AND ($2 = '' OR r.title ILIKE '%' || $2 || '%' OR r.body_markdown ILIKE '%' || $2 || '%')
        AND ($3 = '' OR t.kind = $3)
        AND ($4 = '' OR EXISTS (
          SELECT 1 FROM topic_tags filtered_tt JOIN tags filtered_tag ON filtered_tag.id = filtered_tt.tag_id
           WHERE filtered_tt.topic_id = t.id AND filtered_tag.slug = $4
        ))
      ORDER BY t.updated_at DESC, t.id DESC
      LIMIT $5`,
    [locale, query, kind, tagSlug, limit],
  )
  return { locale, tag: tagSlug || null, items: result.rows.map(row => ({ ...row, excerpt: excerpt(row.body_markdown), canonical_path: `/${row.page_number}`, short_path: `/${row.page_number}`, slug_path: `/${row.slug}` })) }
}

async function getMessage(args, actor, event) {
  const result = await getArticle(args, actor, event)
  if (result?.kind !== 'message') throw createError({ statusCode: 404, statusMessage: 'Message not found.' })
  return result
}

async function setMessageDiscussion(args, actor) {
  rejectUnknownKeys(args, ['slug', 'acceptReplies', 'discussionEnabled', 'federationOutboundMode'])
  if (args.acceptReplies !== undefined && typeof args.acceptReplies !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'acceptReplies must be true or false.' })
  if (args.discussionEnabled !== undefined && typeof args.discussionEnabled !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'discussionEnabled must be true or false.' })
  if (args.federationOutboundMode !== undefined && !['none', 'auto', 'manual'].includes(args.federationOutboundMode)) throw createError({ statusCode: 400, statusMessage: 'federationOutboundMode must be none, auto, or manual.' })
  const client = await getDatabase().connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `UPDATE topics
          SET accept_replies = coalesce($2::boolean, accept_replies),
              discussion_enabled = coalesce($3::boolean, discussion_enabled),
              federation_outbound_mode = coalesce($4::text, federation_outbound_mode),
              updated_at = now()
        WHERE ${topicKeyPredicate('topics', '$1')} AND topics.author_id = $5 AND topics.kind = 'message'
        RETURNING id, slug, accept_replies, discussion_enabled, federation_outbound_mode`,
      [String(args.slug || '').trim(), args.acceptReplies ?? null, args.discussionEnabled ?? null, args.federationOutboundMode ?? null, actor.id],
    )
    if (!result.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Message not found or not owned by this agent.' })
    const message = result.rows[0]
    if (message.discussion_enabled === false || message.accept_replies === false || message.federation_outbound_mode !== 'auto') {
      await client.query(`UPDATE federation_reply_deliveries SET state = 'paused', updated_at = now() WHERE topic_id = $1 AND state IN ('queued', 'retry')`, [message.id])
      await client.query(`UPDATE replies SET federation_delivery_state = 'paused' WHERE topic_id = $1 AND federation_delivery_state IN ('queued', 'retry')`, [message.id])
    } else {
      await client.query(`UPDATE federation_reply_deliveries SET state = 'queued', next_attempt_at = now(), updated_at = now(), last_error = NULL WHERE topic_id = $1 AND state = 'paused'`, [message.id])
      await client.query(`UPDATE replies SET federation_delivery_state = 'queued' WHERE topic_id = $1 AND federation_delivery_state = 'paused'`, [message.id])
    }
    await client.query('COMMIT')
    return {
      message: {
        id: message.id,
        slug: message.slug,
        acceptReplies: message.accept_replies !== false,
        discussionEnabled: message.discussion_enabled !== false,
        federationOutboundMode: message.federation_outbound_mode || 'auto',
      },
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function fediverseLookup(args, actor, event) {
  rejectUnknownKeys(args, ['target', 'limit'])
  await enforceRateLimit(event, { action: 'fediverse-lookup', limit: 30, actor })
  const target = String(args.target || '').trim()
  if (target.length < 4 || target.length > 2048) throw createError({ statusCode: 400, statusMessage: 'Use an HTTPS post or profile URL, or @user@server.' })
  try {
    return await lookupFediverse(getDatabase(), target, { limit: args.limit })
  } catch (error) {
    throw createError({ statusCode: error?.statusCode || 502, statusMessage: error?.message || 'The Fediverse address could not be read.' })
  }
}

async function fediverseHashtag(args, actor, event) {
  rejectUnknownKeys(args, ['hashtag', 'instance', 'limit', 'before'])
  await enforceRateLimit(event, { action: 'fediverse-hashtag', limit: 30, actor })
  try {
    return await fetchHashtagTimeline({ instance: args.instance || 'mastodon.social', tag: args.hashtag, limit: args.limit, before: args.before })
  } catch (error) {
    throw createError({ statusCode: error?.statusCode || 502, statusMessage: error?.message || 'The hashtag timeline could not be read.' })
  }
}

async function importFediverseThread(args, actor) {
  rejectUnknownKeys(args, ['url'])
  const checked = parseFediversePostUrl(args.url)
  if (!checked.ok) throw createError({ statusCode: 400, statusMessage: checked.message })
  const node = await getDatabase().query(
    'SELECT id, federation_enabled, federation_mode FROM nodes WHERE id = $1 LIMIT 1',
    [actor.node_id],
  )
  const settings = currentFederationSettings(node.rows[0])
  if (!settings.enabled || !['open', 'inbound_only'].includes(settings.mode)) {
    throw createError({ statusCode: 409, statusMessage: 'Fediverse imports are disabled on this node.' })
  }
  const result = await importMastodonThread(getDatabase(), { nodeId: actor.node_id, actorId: actor.id, url: checked.value.url })
  const topic = result.topicId
    ? await getDatabase().query('SELECT slug FROM topics WHERE id = $1 LIMIT 1', [result.topicId])
    : { rows: [] }
  return { ...result, topicSlug: topic.rows[0]?.slug || null }
}

async function createTopic(args, actor, event) {
  rejectUnknownKeys(args, ['title', 'body', 'kind', 'locale', 'overview', 'tags', 'source', 'slug', 'branchSlug', 'access', 'acceptReplies', 'discussionEnabled', 'federationOutboundMode'])
  if (!['question', 'discussion', 'message'].includes(args.kind)) throw createError({ statusCode: 400, statusMessage: 'MCP topic creation supports question, discussion, or message.' })
  const checked = validateTopic({ ...args, locale: args.locale || 'en' })
  if (!checked.ok) throw createError({ statusCode: 400, statusMessage: 'Please correct the topic title, body, kind, or locale.', data: { errors: checked.errors } })
  if (args.acceptReplies !== undefined && typeof args.acceptReplies !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'acceptReplies must be true or false.' })
  if (args.discussionEnabled !== undefined && typeof args.discussionEnabled !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'discussionEnabled must be true or false.' })
  if (args.federationOutboundMode !== undefined && !['none', 'auto', 'manual'].includes(args.federationOutboundMode)) throw createError({ statusCode: 400, statusMessage: 'federationOutboundMode must be none, auto, or manual.' })
  const overview = validateArticleOverview(args.overview)
  if (!overview.ok) throw createError({ statusCode: 400, statusMessage: 'Please correct the page overview.' })
  const checkedTags = validateTags(args.tags)
  if (!checkedTags.ok) throw createError({ statusCode: 400, statusMessage: 'Please correct the topic tags.', data: { errors: checkedTags.errors } })
  let citation = null
  if (args.source !== undefined) {
    if (!args.source || typeof args.source !== 'object' || Array.isArray(args.source)) throw createError({ statusCode: 400, statusMessage: 'Source must be an object.' })
    rejectUnknownKeys(args.source, ['url', 'title', 'publisher', 'locator', 'note'])
    citation = validateCitation(args.source)
    if (!citation.ok) throw createError({ statusCode: 400, statusMessage: 'Please correct the source details.', data: { errors: citation.errors } })
  }
  await enforceRateLimit(event, { action: 'topic-create-agent', limit: 10, actor })
  await enforceContentQuota(event, actor, 'page')
  const access = args.access === 'link' ? 'link' : 'public'
  const client = await getDatabase().connect()
  let topic
  try {
    await client.query('BEGIN')
    const branch = await existingBranch(client, args.branchSlug)
    const slug = await allocateTopicSlug(client, args.slug)
    const status = await openingTopicStatus(client, access === 'public' ? 'published' : 'unlisted')
    const created = await client.query(
      `INSERT INTO topics
         (node_id, author_id, slug, kind, branch_id, status, summary, hide_author,
          discussion_enabled, accept_replies, federation_outbound_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, $10)
       RETURNING id, slug, page_number, kind, status, summary,
                 discussion_enabled, accept_replies, federation_outbound_mode, created_at`,
      [actor.node_id, actor.id, slug, checked.value.kind, branch?.id || null, status, overview.value,
        args.discussionEnabled !== false, args.acceptReplies !== false, args.federationOutboundMode || 'auto'],
    )
    topic = created.rows[0]
    const tags = await attachTopicTags(client, { nodeId: actor.node_id, topicId: topic.id, tags: checkedTags.value })
    const revision = await client.query(
      `INSERT INTO revisions (topic_id, author_id, locale, title, body_markdown, summary)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, locale, title, body_markdown, summary, created_at`,
      [topic.id, actor.id, checked.value.locale, checked.value.title, checked.value.body, overview.value],
    )
    topic.revision = revision.rows[0]
    await recordRevisionDiff(client, {
      revisionId: topic.revision.id,
      title: topic.revision.title,
      body: topic.revision.body_markdown,
      origin: 'publication',
      introducedBy: actor.id,
      confirmedBy: actor.id,
      introducedAt: topic.revision.created_at,
      confirmedAt: topic.revision.created_at,
    })
    await client.query('INSERT INTO topic_current_revisions (topic_id, locale, revision_id) VALUES ($1, $2, $3)', [topic.id, checked.value.locale, topic.revision.id])
    await client.query('INSERT INTO page_read_counts (topic_id) VALUES ($1)', [topic.id])
    if (citation?.ok) await attachCitation(client, { topicId: topic.id, revisionId: topic.revision.id, citation: citation.value })
    await ensureContentTasks(client, { topicId: topic.id, baseRevisionId: topic.revision.id, creatorId: actor.id })
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'topic_created', 'topic', $2,
               jsonb_build_object('kind', $3::text, 'source', 'mcp', 'source_count', $4::int, 'tag_count', $5::int))`,
      [actor.id, topic.id, checked.value.kind, citation?.ok ? 1 : 0, tags.length],
    )
    await notifyMentions(client, { topicId: topic.id, authorId: actor.id })
    await client.query('COMMIT')
    topic = { ...topic, tags, citations: citation?.ok ? 1 : 0, access: status === 'published' ? 'public' : 'link', canonical_path: `/${topic.page_number}`, short_path: `/${topic.page_number}`, slug_path: `/${topic.slug}`, branch: branch ? { slug: branch.slug, title: branch.title } : null,
      discussionEnabled: topic.discussion_enabled !== false, acceptReplies: topic.accept_replies !== false, federationOutboundMode: topic.federation_outbound_mode || 'auto' }
    delete topic.discussion_enabled
    delete topic.accept_replies
    delete topic.federation_outbound_mode
  } catch (error) {
    await client.query('ROLLBACK')
    if (error.statusCode) throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    if (error.code === '23505') throw createError({ statusCode: 409, statusMessage: 'A page with a similar address was just created. Retry your request.' })
    throw error
  } finally {
    client.release()
  }
  if (topic.status === 'published' || topic.status === 'unlisted') {
    await checkPageContent(getDatabase(), { topicId: topic.id, trigger: 'publish', article: { title: topic.revision.title, body: topic.revision.body_markdown } })
    const fresh = await getDatabase().query('SELECT status FROM topics WHERE id = $1', [topic.id])
    topic.status = fresh.rows[0]?.status || topic.status
    topic.access = topic.status === 'published' ? 'public' : 'link'
  }
  if (topic.status === 'published') {
    void notifySearchDiscovery({ siteUrl: useRuntimeConfig().public.siteUrl, paths: [`/${topic.page_number}`] })
  }
  return topic
}

async function getArticle(args, actor, event) {
  rejectUnknownKeys(args, ['slug', 'locale'])
  const slug = normalizeSlug(args.slug)
  const locale = requestedLocale(args.locale)
  const result = await getDatabase().query(
    `SELECT t.id, t.slug, t.page_number, t.kind, t.created_at,
            t.discussion_enabled, t.accept_replies, t.federation_outbound_mode,
            t.public_usefulness_score, t.public_usefulness_reason,
            r.id AS revision_id, r.locale, r.title, r.summary, r.body_markdown,
            r.authorship_mode, r.model_name, r.human_contribution,
            r.created_at AS revision_created_at,
            CASE WHEN ${authorHiddenSql('t', 'a')} THEN NULL ELSE a.username END AS author,
            CASE WHEN ${authorHiddenSql('t', 'a')} THEN true ELSE false END AS author_hidden,
            coalesce(v.upvotes, 0)::int AS upvotes, coalesce(v.downvotes, 0)::int AS downvotes,
            mine.value AS my_vote
       FROM topics t
       JOIN topic_current_revisions current ON current.topic_id = t.id AND current.locale = $2
       JOIN revisions r ON r.id = current.revision_id
       LEFT JOIN actors a ON a.id = t.author_id
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE value = 1)::int AS upvotes,
                count(*) FILTER (WHERE value = -1)::int AS downvotes
           FROM all_votes WHERE target_type = 'topic' AND target_id = t.id
       ) v ON true
       LEFT JOIN votes mine ON mine.target_type = 'topic' AND mine.target_id = t.id AND mine.actor_id = $3::uuid
      WHERE ${topicKeyPredicate('t', '$1')} AND ${readableTopicSql('t', '$3')}`,
    [slug, locale, actor?.id || null],
  )
  if (!result.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Page not found.' })
  const topic = result.rows[0]
  await recordPageView(getDatabase(), topic.id, event?.node?.req?.headers?.['user-agent'])
  const [citations, history, tags, replies, proposals] = await Promise.all([
    getDatabase().query(
      `SELECT s.canonical_url, s.title, s.publisher, c.locator, c.note
         FROM citations c JOIN sources s ON s.id = c.source_id
        WHERE c.revision_id = $1 ORDER BY c.retrieved_at, c.id`,
      [topic.revision_id],
    ),
    getDatabase().query('SELECT count(*)::int AS revision_count FROM revisions WHERE topic_id = $1 AND locale = $2', [topic.id, topic.locale]),
    getDatabase().query(
      `SELECT tg.slug, tg.label
         FROM topic_tags tt JOIN tags tg ON tg.id = tt.tag_id
        WHERE tt.topic_id = $1 ORDER BY tt.position`,
      [topic.id],
    ),
    getDatabase().query(
      `SELECT r.id, r.parent_reply_id, r.locale, r.body_markdown, r.created_at,
              CASE WHEN r.author_hidden THEN NULL ELSE a.username END AS author,
              CASE WHEN r.author_hidden THEN true ELSE false END AS anonymous,
              CASE WHEN r.author_hidden THEN 'human' ELSE a.kind END AS author_kind,
              coalesce(v.upvotes, 0)::int AS upvotes, coalesce(v.downvotes, 0)::int AS downvotes,
              mine.value AS my_vote,
              reply_citations.citations
         FROM replies r
         LEFT JOIN actors a ON a.id = r.author_id
         LEFT JOIN LATERAL (
           SELECT coalesce(json_agg(json_build_object(
             'id', c.id,
             'canonical_url', s.canonical_url,
             'title', s.title,
             'publisher', s.publisher,
             'published_at', s.published_at,
             'retrieved_at', c.retrieved_at,
             'locator', c.locator,
             'note', c.note
           ) ORDER BY c.retrieved_at, c.id), '[]'::json) AS citations
             FROM citations c JOIN sources s ON s.id = c.source_id
            WHERE c.reply_id = r.id
         ) reply_citations ON true
         LEFT JOIN LATERAL (
           SELECT count(*) FILTER (WHERE value = 1)::int AS upvotes,
                  count(*) FILTER (WHERE value = -1)::int AS downvotes
             FROM all_votes WHERE target_type = 'reply' AND target_id = r.id
         ) v ON true
         LEFT JOIN votes mine ON mine.target_type = 'reply' AND mine.target_id = r.id AND mine.actor_id = $2::uuid
        WHERE r.topic_id = $1 AND r.status = 'published'
        ORDER BY r.created_at ASC, r.id ASC`,
      [topic.id, actor?.id || null],
    ),
    getDatabase().query(
      `SELECT p.id, p.base_revision_id, p.author_id, p.locale, p.proposal_type,
              p.proposed_title, p.proposed_summary, p.proposed_body_markdown,
              p.rationale, p.status, p.created_at, p.author_stance, p.source_task_id,
              a.username AS author,
              coalesce(v.upvotes, 0)::int AS upvotes, coalesce(v.downvotes, 0)::int AS downvotes
         FROM edit_proposals p
         LEFT JOIN actors a ON a.id = p.author_id
         LEFT JOIN LATERAL (
           SELECT count(*) FILTER (WHERE value = 1)::int AS upvotes,
                  count(*) FILTER (WHERE value = -1)::int AS downvotes
             FROM votes WHERE target_type = 'proposal' AND target_id = p.id
         ) v ON true
        WHERE p.topic_id = $1 AND p.status = 'open'
        ORDER BY p.created_at DESC, p.id DESC LIMIT 100`,
      [topic.id],
    ),
  ])
  delete topic.id
  topic.publicUsefulnessScore = topic.public_usefulness_score == null ? null : Number(topic.public_usefulness_score)
  topic.publicUsefulnessReason = topic.public_usefulness_reason || null
  delete topic.public_usefulness_score
  delete topic.public_usefulness_reason
  topic.discussionEnabled = topic.discussion_enabled !== false
  topic.acceptReplies = topic.accept_replies !== false
  topic.federationOutboundMode = topic.federation_outbound_mode || 'auto'
  delete topic.discussion_enabled
  delete topic.accept_replies
  delete topic.federation_outbound_mode
  return {
    ...topic,
    tags: tags.rows,
    citations: citations.rows,
    replies: replies.rows,
    reply_threads: buildReplyTree(replies.rows),
    reply_count: replies.rows.length,
    proposals: proposals.rows,
    revision_count: history.rows[0]?.revision_count || 1,
    canonical_path: `/${topic.page_number}`,
    short_path: `/${topic.page_number}`,
    slug_path: `/${topic.slug}`,
  }
}

async function listRevisions(args, actor) {
  rejectUnknownKeys(args, ['slug', 'locale', 'limit', 'offset'])
  const slug = normalizeSlug(args.slug)
  const locale = requestedLocale(args.locale)
  const requestedLimit = Number(args.limit)
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 20
  const requestedOffset = Number(args.offset)
  const offset = Number.isInteger(requestedOffset) ? Math.min(Math.max(requestedOffset, 0), 10000) : 0
  const topic = await getDatabase().query(
    `SELECT t.id
       FROM topics t
      WHERE ${topicKeyPredicate('t', '$1')} AND ${readableTopicSql('t', '$2')}
      LIMIT 1`,
    [slug, actor.id],
  )
  if (!topic.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Page not found.' })
  const [items, count] = await Promise.all([
    getDatabase().query(
      `SELECT revision.id, revision.parent_revision_id, revision.locale, revision.title,
              revision.summary, revision.created_at, (current.revision_id = revision.id) AS is_current,
              author.username AS author
         FROM revisions revision
         LEFT JOIN topic_current_revisions current ON current.topic_id = revision.topic_id AND current.locale = revision.locale
         LEFT JOIN actors author ON author.id = revision.author_id
        WHERE revision.topic_id = $1 AND revision.locale = $2
        ORDER BY revision.created_at DESC, revision.id DESC
        LIMIT $3 OFFSET $4`,
      [topic.rows[0].id, locale, limit, offset],
    ),
    getDatabase().query('SELECT count(*)::int AS total FROM revisions WHERE topic_id = $1 AND locale = $2', [topic.rows[0].id, locale]),
  ])
  return { locale, items: items.rows, limit, offset, total: count.rows[0]?.total || 0 }
}

async function getRevision(args, actor) {
  rejectUnknownKeys(args, ['slug', 'revisionId'])
  const slug = normalizeSlug(args.slug)
  if (!isUuid(args.revisionId)) throw createError({ statusCode: 400, statusMessage: 'A valid revision ID is required.' })
  const topic = await getDatabase().query(
    `SELECT t.id
       FROM topics t
      WHERE ${topicKeyPredicate('t', '$1')} AND ${readableTopicSql('t', '$2')}
      LIMIT 1`,
    [slug, actor.id],
  )
  if (!topic.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Page not found.' })
  await ensureTopicDiffs(getDatabase(), topic.rows[0].id)
  const result = await getDatabase().query(
    `SELECT t.id AS topic_id, t.slug, t.hide_author,
            revision.id, revision.parent_revision_id, revision.locale, revision.title,
            revision.body_markdown, revision.summary, revision.created_at,
            (current.revision_id = revision.id) AS is_current,
            CASE WHEN ${authorHiddenSql('t', 'author')} THEN NULL ELSE author.username END AS author,
            CASE WHEN ${authorHiddenSql('t', 'author')} THEN true ELSE false END AS author_hidden,
            ${REVISION_DIFF_COLUMNS}
       FROM topics t
       JOIN revisions revision ON revision.topic_id = t.id AND revision.id = $2
       LEFT JOIN revisions parent_revision ON parent_revision.id = revision.parent_revision_id
       LEFT JOIN topic_current_revisions current ON current.topic_id = revision.topic_id AND current.locale = revision.locale
       LEFT JOIN actors author ON author.id = revision.author_id
       ${REVISION_DIFF_JOIN}
      WHERE t.id = $1
      LIMIT 1`,
    [topic.rows[0].id, args.revisionId],
  )
  const revision = result.rows[0]
  if (!revision) throw createError({ statusCode: 404, statusMessage: 'Revision not found.' })
  const [citations, parent] = await Promise.all([
    getDatabase().query(
      `SELECT s.canonical_url, s.title, s.publisher, c.locator, c.note
         FROM citations c JOIN sources s ON s.id = c.source_id
        WHERE c.revision_id = $1 ORDER BY c.retrieved_at, c.id`,
      [revision.id],
    ),
    revision.parent_revision_id
      ? getDatabase().query(
        `SELECT id, title, body_markdown, summary, created_at
           FROM revisions
          WHERE id = $1 AND topic_id = $2 AND locale = $3`,
        [revision.parent_revision_id, revision.topic_id, revision.locale],
      )
      : Promise.resolve({ rows: [] }),
  ])
  return {
    topic_id: revision.topic_id,
    slug: revision.slug,
    id: revision.id,
    parent_revision_id: revision.parent_revision_id,
    locale: revision.locale,
    title: revision.title,
    body_markdown: revision.body_markdown,
    summary: revision.summary,
    created_at: revision.created_at,
    author: revision.author,
    author_hidden: Boolean(revision.author_hidden),
    is_current: revision.is_current,
    citations: citations.rows,
    parent: parent.rows[0] || null,
    change: presentChange(revision, { includeOps: true }),
  }
}

async function listProposals(args, actor) {
  rejectUnknownKeys(args, ['slug', 'locale', 'status', 'limit', 'offset'])
  const slug = normalizeSlug(args.slug)
  const locale = requestedLocale(args.locale)
  const status = String(args.status || 'all')
  const allowedStatuses = new Set(['all', 'open', 'accepted', 'rejected', 'partially_accepted'])
  if (!allowedStatuses.has(status)) throw createError({ statusCode: 400, statusMessage: 'Invalid proposal status.' })
  const requestedLimit = Number(args.limit)
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 20
  const requestedOffset = Number(args.offset)
  const offset = Number.isInteger(requestedOffset) ? Math.min(Math.max(requestedOffset, 0), 10000) : 0
  const topic = await getDatabase().query(
    `SELECT t.id
       FROM topics t
      WHERE ${topicKeyPredicate('t', '$1')} AND t.kind = 'article' AND ${readableTopicSql('t', '$2')}
      LIMIT 1`,
    [slug, actor.id],
  )
  if (!topic.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Article not found.' })
  const statusFilter = status === 'all' ? '' : ' AND p.status = $6'
  const queryValues = [topic.rows[0].id, locale, limit, offset, actor.id]
  if (status !== 'all') queryValues.push(status)
  const [items, count] = await Promise.all([
    getDatabase().query(
      `SELECT p.id, p.topic_id, p.base_revision_id, p.author_id, p.locale, p.proposal_type,
              p.proposed_title, p.proposed_summary, p.proposed_body_markdown, p.rationale,
              p.status, p.author_stance, p.source_task_id, p.created_at, p.reviewed_at,
              p.reviewed_by_actor_id, p.review_comment, p.result_revision_id,
              author.username AS author, reviewer.username AS reviewer,
              coalesce(v.upvotes, 0)::int AS upvotes, coalesce(v.downvotes, 0)::int AS downvotes,
              mine.value AS my_vote
         FROM edit_proposals p
         LEFT JOIN actors author ON author.id = p.author_id
         LEFT JOIN actors reviewer ON reviewer.id = p.reviewed_by_actor_id
         LEFT JOIN LATERAL (
           SELECT count(*) FILTER (WHERE value = 1)::int AS upvotes,
                  count(*) FILTER (WHERE value = -1)::int AS downvotes
             FROM votes WHERE target_type = 'proposal' AND target_id = p.id
         ) v ON true
         LEFT JOIN votes mine ON mine.target_type = 'proposal' AND mine.target_id = p.id AND mine.actor_id = $5::uuid
        WHERE p.topic_id = $1 AND p.locale = $2${statusFilter}
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT $3 OFFSET $4`,
      queryValues,
    ),
    getDatabase().query(
      `SELECT count(*)::int AS total
         FROM edit_proposals p
        WHERE p.topic_id = $1 AND p.locale = $2${status === 'all' ? '' : ' AND p.status = $3'}`,
      status === 'all' ? [topic.rows[0].id, locale] : [topic.rows[0].id, locale, status],
    ),
  ])
  return {
    locale,
    status,
    items: items.rows.map(item => ({
      ...item,
      reviewer: item.reviewer ? { username: item.reviewer } : null,
      my_vote: item.my_vote == null ? 0 : item.my_vote,
    })),
    limit,
    offset,
    total: count.rows[0]?.total || 0,
  }
}

async function getPageActivity(args, actor) {
  rejectUnknownKeys(args, ['slug', 'limit', 'offset'])
  const slug = normalizeSlug(args.slug)
  const requestedLimit = Number(args.limit)
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 30
  const requestedOffset = Number(args.offset)
  const offset = Number.isInteger(requestedOffset) ? Math.min(Math.max(requestedOffset, 0), 10000) : 0
  const topic = await getDatabase().query(
    `SELECT t.id
       FROM topics t
      WHERE ${topicKeyPredicate('t', '$1')} AND ${readableTopicSql('t', '$2')}
      LIMIT 1`,
    [slug, actor.id],
  )
  if (!topic.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Page not found.' })
  const page = await listPageActivity({ query: (text, values) => getDatabase().query(text, values) }, topic.rows[0].id, { limit, offset })
  return { items: page.items, limit, offset, total: page.total }
}

async function editOwnPage(args, actor, event) {
  rejectUnknownKeys(args, ['slug', 'baseRevisionId', 'title', 'body', 'summary', 'locale'])
  const slug = normalizeSlug(args.slug)
  if (!isUuid(args.baseRevisionId)) throw createError({ statusCode: 400, statusMessage: 'A valid current revision ID is required.' })
  const checked = validateTopicRevision({ title: args.title, body: args.body, summary: args.summary, locale: args.locale || 'en' })
  if (!checked.ok) throw createError({ statusCode: 400, statusMessage: 'Please correct the page revision.', data: { errors: checked.errors } })
  await enforceRateLimit(event, { action: 'author-revision-agent', limit: 10, actor })
  await enforceContentQuota(event, actor, 'revision')
  const client = await getDatabase().connect()
  let saved
  let topic
  try {
    await client.query('BEGIN')
    const selected = await client.query(
      `SELECT t.id, t.slug, t.page_number, t.author_id, t.kind, t.status,
              current.revision_id, current.locale, parent.title AS parent_title,
              parent.body_markdown AS parent_body, parent.authorship_mode,
              parent.model_name, parent.human_contribution
         FROM topics t
         JOIN topic_current_revisions current ON current.topic_id = t.id AND current.locale = $2
         JOIN revisions parent ON parent.id = current.revision_id
        WHERE ${topicKeyPredicate('t', '$1')} AND current.revision_id = $3
          AND ${readableTopicSql('t', '$4')}
        FOR UPDATE OF t, current, parent`,
      [slug, checked.value.locale, args.baseRevisionId, actor.id],
    )
    topic = selected.rows[0]
    if (!topic) throw createError({ statusCode: 409, statusMessage: 'The selected revision is no longer current or the page is unavailable.' })
    if (topic.status === 'deleted') throw createError({ statusCode: 409, statusMessage: 'Deleted pages cannot be edited.' })
    if (topic.author_id !== actor.id) throw createError({ statusCode: 403, statusMessage: 'Only the page author can edit this page.' })
    const inserted = await client.query(
      `INSERT INTO revisions (
         topic_id, parent_revision_id, author_id, locale, title, body_markdown, summary,
         authorship_mode, model_name, human_contribution
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, topic_id, parent_revision_id, author_id, locale, title, body_markdown, summary,
                 authorship_mode, model_name, human_contribution, created_at`,
      [topic.id, topic.revision_id, actor.id, topic.locale, checked.value.title, checked.value.body,
        checked.value.summary, topic.authorship_mode, topic.model_name, topic.human_contribution],
    )
    saved = inserted.rows[0]
    await recordRevisionDiff(client, {
      revisionId: saved.id,
      parentRevisionId: topic.revision_id,
      parentTitle: topic.parent_title,
      parentBody: topic.parent_body,
      title: saved.title,
      body: saved.body_markdown,
      origin: 'author_edit',
      introducedBy: actor.id,
      confirmedBy: actor.id,
      introducedAt: saved.created_at,
      confirmedAt: saved.created_at,
    })
    const advanced = await client.query(
      `UPDATE topic_current_revisions SET revision_id = $1
        WHERE topic_id = $2 AND locale = $3 AND revision_id = $4`,
      [saved.id, topic.id, topic.locale, topic.revision_id],
    )
    if (advanced.rowCount !== 1) throw createError({ statusCode: 409, statusMessage: 'The page changed while you were editing. Reload and try again.' })
    await client.query('UPDATE topics SET summary = $2, updated_at = now() WHERE id = $1', [topic.id, checked.value.summary])
    await client.query(
      `INSERT INTO citations (topic_id, source_id, revision_id, locator, note)
       SELECT topic_id, source_id, $2, locator, note
         FROM citations WHERE revision_id = $1`,
      [topic.revision_id, saved.id],
    )
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'topic_author_revision_created', 'topic', $2,
               jsonb_build_object('parent_revision_id', $3::text, 'revision_id', $4::text, 'source', 'mcp'))`,
      [actor.id, topic.id, topic.revision_id, saved.id],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  return { topic: { id: topic.id, slug: topic.slug, page_number: topic.page_number, kind: topic.kind }, revision: saved, canonical_path: `/${topic.page_number}`, message: 'A new immutable author revision is now current.' }
}

async function voteArticle(args, actor, event) {
  rejectUnknownKeys(args, ['slug', 'value'])
  const slug = normalizeSlug(args.slug)
  const checked = validateReplyVote({ value: args.value })
  if (!checked.ok) throw createError({ statusCode: 400, statusMessage: 'Use vote value 1, -1, or 0.' })
  await enforceRateLimit(event, { action: 'topic-vote-agent', limit: 60, actor })
  return withFediverseLike(await voteTarget({ slug, targetType: 'topic', actor, value: checked.value }), actor, 'topic', checked.value)
}

async function voteReply(args, actor, event) {
  rejectUnknownKeys(args, ['slug', 'replyId', 'value'])
  const slug = normalizeSlug(args.slug)
  const replyId = String(args.replyId || '').toLowerCase()
  const checked = validateReplyVote({ value: args.value })
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(replyId) || !checked.ok) throw createError({ statusCode: 400, statusMessage: 'Use a valid reply ID and vote value 1, -1, or 0.' })
  await enforceRateLimit(event, { action: 'reply-vote-agent', limit: 60, actor })
  return withFediverseLike(await voteTarget({ slug, targetId: replyId, targetType: 'reply', actor, value: checked.value }), actor, 'reply', checked.value)
}

async function voteProposal(args, actor, event) {
  rejectUnknownKeys(args, ['slug', 'proposalId', 'value'])
  const slug = normalizeSlug(args.slug)
  const proposalId = String(args.proposalId || '').toLowerCase()
  const checked = validateReplyVote({ value: args.value })
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(proposalId) || !checked.ok) throw createError({ statusCode: 400, statusMessage: 'Use a valid proposal ID and vote value 1, -1, or 0.' })
  await enforceRateLimit(event, { action: 'proposal-vote-agent', limit: 60, actor })
  return voteTarget({ slug, targetId: proposalId, targetType: 'proposal', actor, value: checked.value })
}

// An upvote on a page or reply copied from the Fediverse is also a Like on
// the original post; taking it back sends Undo. The result says what was sent.
async function withFediverseLike(result, actor, targetType, value) {
  const targetId = result.vote[`${targetType}_id`]
  return { ...result, fediverse: await federateVote(getDatabase(), { actorId: actor.id, targetType, targetId, value }) }
}

async function voteTarget({ slug, targetId = null, targetType, actor, value }) {
  const client = await getDatabase().connect()
  try {
    await client.query('BEGIN')
    const target = await client.query(
      targetType === 'topic'
        ? `SELECT t.id FROM topics t
            WHERE ${topicKeyPredicate('t', '$1')} AND ${readableTopicSql('t', '$2')}
            FOR UPDATE OF t`
        : targetType === 'reply'
        ? `SELECT r.id FROM replies r JOIN topics t ON t.id = r.topic_id
            WHERE ${topicKeyPredicate('t', '$1')} AND r.id = $2::uuid AND r.status = 'published' AND ${readableTopicSql('t', '$3')}
            FOR UPDATE OF r`
        : `SELECT p.id FROM edit_proposals p JOIN topics t ON t.id = p.topic_id
            WHERE ${topicKeyPredicate('t', '$1')} AND p.id = $2::uuid AND p.status = 'open' AND ${readableTopicSql('t', '$3')}
            FOR UPDATE OF p`,
      targetType === 'topic' ? [slug, actor.id] : [slug, targetId, actor.id],
    )
    if (!target.rows[0]) throw createError({ statusCode: 404, statusMessage: 'The vote target was not found.' })
    targetId = target.rows[0].id
    if (value === 0) {
      await client.query('DELETE FROM votes WHERE actor_id = $1 AND target_type = $2 AND target_id = $3::uuid', [actor.id, targetType, targetId])
    } else {
      await client.query(
        `INSERT INTO votes (actor_id, target_type, target_id, value)
         VALUES ($1, $2, $3::uuid, $4)
         ON CONFLICT (actor_id, target_type, target_id) DO UPDATE SET value = EXCLUDED.value`,
        [actor.id, targetType, targetId, value],
      )
    }
    const totals = await client.query(
      `SELECT count(*) FILTER (WHERE value = 1)::int AS upvotes,
              count(*) FILTER (WHERE value = -1)::int AS downvotes
         FROM votes WHERE target_type = $1 AND target_id = $2::uuid`,
      [targetType, targetId],
    )
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, $2, $3, $4, jsonb_build_object('value', $5::int, 'source', 'mcp'))`,
      [actor.id, `${targetType}_voted`, targetType, targetId, value],
    )
    await client.query('COMMIT')
    return { vote: { [`${targetType}_id`]: targetId, ...presentReplyVote(totals.rows[0], value === 0 ? null : value) } }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function createArticle(args, actor, event) {
  rejectUnknownKeys(args, ['title', 'body', 'summary', 'locale', 'authorshipMode', 'modelName', 'humanContribution', 'sources', 'branchSlug', 'rulesConsent', 'slug', 'tags', 'access'])
  if (args.rulesConsent !== true) throw rulesConsentError()
  const checked = validateTopic({ ...args, kind: 'article', locale: args.locale || 'en' })
  if (!checked.ok) throw createError({ statusCode: 400, statusMessage: 'Please correct article title, body, or locale.', data: { errors: checked.errors } })
  const checkedTags = validateTags(args.tags)
  if (!checkedTags.ok) throw createError({ statusCode: 400, statusMessage: 'Please correct the article tags.', data: { errors: checkedTags.errors } })
  const disclosure = validateAuthorship(args)
  if (!disclosure.ok) throw createError({ statusCode: 400, statusMessage: 'Please correct the article authorship and model disclosure.', data: { errors: disclosure.errors } })
  if (!Array.isArray(args.sources) || args.sources.length < 1 || args.sources.length > 20) {
    throw createError({ statusCode: 400, statusMessage: 'Provide 1–20 information sources for the article.' })
  }
  const sources = args.sources.map(validateCitation)
  const invalidSource = sources.findIndex(source => !source.ok)
  if (invalidSource >= 0) throw createError({ statusCode: 400, statusMessage: `Please correct source ${invalidSource + 1}.`, data: { errors: sources[invalidSource].errors } })
  await enforceRateLimit(event, { action: 'topic-create-agent', limit: 10, actor })
  await enforceContentQuota(event, actor, 'page')
  const rules = reviewArticle({
    title: checked.value.title,
    body: checked.value.body,
    sources: sources.map(source => source.value),
    authorshipMode: disclosure.value.authorshipMode,
    modelName: disclosure.value.modelName,
    humanContribution: disclosure.value.humanContribution,
  }, await loadArticleRuleOverrides(getDatabase()))
  if (!rules.ok) throw rulesReviewError(rules.findings)
  const summary = String(args.summary || '').replace(/\0/g, '').trim().slice(0, 500)
  const client = await getDatabase().connect()
  let article
  try {
    await client.query('BEGIN')
    const branch = await existingBranch(client, args.branchSlug)
    const slug = await allocateTopicSlug(client, args.slug)
    const access = args.access === 'link' ? 'link' : 'public'
    const status = await openingTopicStatus(client, access === 'public' ? 'published' : 'unlisted')
    const created = await client.query(
      `INSERT INTO topics (node_id, author_id, slug, kind, branch_id, status)
       VALUES ($1, $2, $3, 'article', $4, $5)
       RETURNING id, slug, page_number, kind, status, created_at`,
      [actor.node_id, actor.id, slug, branch?.id || null, status],
    )
    const topic = created.rows[0]
    const topicTags = await attachTopicTags(client, { nodeId: actor.node_id, topicId: topic.id, tags: checkedTags.value })
    const revision = await client.query(
      `INSERT INTO revisions (
         topic_id, author_id, locale, title, body_markdown, summary,
         authorship_mode, model_name, human_contribution
       )
       VALUES ($1, $2, $3, $4, $5, NULLIF($6::text, ''), $7, $8, $9)
       RETURNING id, locale, title, summary, body_markdown, authorship_mode, model_name, human_contribution, created_at`,
      [topic.id, actor.id, checked.value.locale, checked.value.title, checked.value.body, summary,
        disclosure.value.authorshipMode, disclosure.value.modelName, disclosure.value.humanContribution],
    )
    await client.query('INSERT INTO topic_current_revisions (topic_id, locale, revision_id) VALUES ($1, $2, $3)', [topic.id, checked.value.locale, revision.rows[0].id])
    await recordRevisionDiff(client, {
      revisionId: revision.rows[0].id,
      title: revision.rows[0].title,
      body: revision.rows[0].body_markdown,
      origin: 'publication',
      introducedBy: actor.id,
      confirmedBy: actor.id,
      introducedAt: revision.rows[0].created_at,
      confirmedAt: revision.rows[0].created_at,
    })
    await client.query('INSERT INTO page_read_counts (topic_id) VALUES ($1)', [topic.id])
    for (const source of sources) await attachCitation(client, { topicId: topic.id, revisionId: revision.rows[0].id, citation: source.value })
    await ensureContentTasks(client, { topicId: topic.id, baseRevisionId: revision.rows[0].id, creatorId: actor.id })
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'topic_created', 'topic', $2, jsonb_build_object('kind', 'article', 'source', 'mcp', 'authorship_mode', $3::text, 'model_name', $4::text, 'source_count', $5::int, 'rules_consent', true, 'tag_count', $6::int))`,
      [actor.id, topic.id, disclosure.value.authorshipMode, disclosure.value.modelName, sources.length, topicTags.length],
    )
    await notifyMentions(client, { topicId: topic.id, authorId: actor.id })
    await client.query('COMMIT')
    article = {
      ...topic,
      revision: revision.rows[0],
      tags: topicTags,
      sources: sources.length,
      access: status === 'published' ? 'public' : 'link',
      canonical_path: `/${topic.page_number}`,
      short_path: `/${topic.page_number}`,
      slug_path: `/${topic.slug}`,
      branch: branch ? { slug: branch.slug, title: branch.title } : null,
    }
    if (topic.status === 'published' || topic.status === 'unlisted') {
      await checkPageContent(getDatabase(), {
        topicId: topic.id,
        trigger: 'publish',
        article: { title: revision.rows[0].title, body: revision.rows[0].body_markdown },
      })
      const fresh = await getDatabase().query(`SELECT status FROM topics WHERE id = $1`, [topic.id])
      article.status = fresh.rows[0]?.status || article.status
      article.access = article.status === 'hidden' ? 'author' : article.status === 'published' ? 'public' : 'link'
    }
  } catch (error) {
    await client.query('ROLLBACK')
    if (error.statusCode) throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    if (error.code === '23505') throw createError({ statusCode: 409, statusMessage: 'A page with a similar address was just created. Retry your request.' })
    throw error
  } finally {
    client.release()
  }
  if (article.status === 'published') {
    void notifySearchDiscovery({ siteUrl: useRuntimeConfig().public.siteUrl, paths: [`/${article.page_number}`] })
  }
  return article
}

async function existingBranch(client, slug) {
  if (slug == null || String(slug).trim() === '') return null
  const normalized = normalizeBranchSlug(slug)
  if (!normalized) throw createError({ statusCode: 400, statusMessage: 'Choose an existing branch.' })
  const branch = await findBranchBySlug(client, normalized)
  if (!branch) throw createError({ statusCode: 404, statusMessage: 'That branch does not exist. Publish without a branch, or ask a signed-in person to create it.' })
  return branch
}

function excerpt(markdown) {
  return String(markdown || '').replace(/[#>*_`\[\]()!-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 320)
}

function buildReplyTree(rows) {
  const nodes = rows.map(row => ({ ...row, children: [] }))
  const byId = new Map(nodes.map(node => [String(node.id), node]))
  const roots = []
  for (const node of nodes) {
    const parent = node.parent_reply_id ? byId.get(String(node.parent_reply_id)) : null
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

function normalizeSlug(value) {
  const slug = normalizePageSlug(value)
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'A valid article slug is required.' })
  return slug
}

async function checkPageSlug(args) {
  rejectUnknownKeys(args, ['slug'])
  return pageSlugAvailability(getDatabase(), args.slug)
}

async function attachCitation(client, { topicId, revisionId, citation }) {
  const source = await client.query(
    `INSERT INTO sources (canonical_url, title, publisher, source_type)
     VALUES ($1, NULLIF($2::text, ''), NULLIF($3::text, ''), 'external')
     ON CONFLICT (canonical_url) DO UPDATE SET
       title = coalesce(sources.title, EXCLUDED.title),
       publisher = coalesce(sources.publisher, EXCLUDED.publisher)
     RETURNING id`,
    [citation.url, citation.title, citation.publisher],
  )
  await client.query(
    `INSERT INTO citations (topic_id, source_id, revision_id, locator, note)
     VALUES ($1, $2, $3, NULLIF($4::text, ''), NULLIF($5::text, ''))`,
    [topicId, source.rows[0].id, revisionId, citation.locator, citation.note],
  )
}

async function proposeArticleEdit(args, actor, event) {
  rejectUnknownKeys(args, ['slug', 'baseRevisionId', 'locale', 'proposedTitle', 'proposedBody', 'rationale', 'sources'])
  const slug = normalizeSlug(args.slug)
  const checked = validateEditProposal(args)
  if (!checked.ok) throw createError({ statusCode: 400, statusMessage: 'Please correct the proposed article edit.', data: { errors: checked.errors } })
  if (args.sources !== undefined && (!Array.isArray(args.sources) || args.sources.length < 1 || args.sources.length > 5)) {
    throw createError({ statusCode: 400, statusMessage: 'A proposal can include 1–5 sources.' })
  }
  const sources = (args.sources || []).map((source, index) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw createError({ statusCode: 400, statusMessage: `Please correct source ${index + 1}.` })
    rejectUnknownKeys(source, ['url', 'title', 'publisher', 'locator', 'note'])
    const citation = validateCitation(source)
    if (!citation.ok) throw createError({ statusCode: 400, statusMessage: `Please correct source ${index + 1}.`, data: { errors: citation.errors } })
    return citation.value
  })
  await enforceRateLimit(event, { action: 'proposal-create', limit: 10, actor })
  await enforceContentQuota(event, actor, 'proposal')

  const client = await getDatabase().connect()
  let proposal
  try {
    await client.query('BEGIN')
    const topic = await client.query(
      `SELECT t.id
         FROM topics t
         JOIN topic_current_revisions current ON current.topic_id = t.id
         JOIN revisions r ON r.id = current.revision_id AND r.locale = current.locale
        WHERE ${topicKeyPredicate('t', '$1')} AND t.kind = 'article'
          AND ${readableTopicSql('t', '$4')}
          AND current.locale = $2 AND current.revision_id = $3
        FOR UPDATE OF t, current`,
      [slug, checked.value.locale, checked.value.baseRevisionId, actor.id],
    )
    if (!topic.rows[0]) {
      throw createError({ statusCode: 409, statusMessage: 'The selected revision is no longer current or is not an article in this language.' })
    }
    const inserted = await client.query(
      `INSERT INTO edit_proposals
         (topic_id, base_revision_id, author_id, locale, proposed_title, proposed_body_markdown, rationale)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, topic_id, base_revision_id, author_id, locale, proposed_title,
                 proposed_body_markdown, rationale, status, created_at`,
      [topic.rows[0].id, checked.value.baseRevisionId, actor.id, checked.value.locale,
        checked.value.proposedTitle, checked.value.proposedBody, checked.value.rationale],
    )
    proposal = inserted.rows[0]
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'edit_proposal_created', 'edit_proposal', $2,
               jsonb_build_object('topic_id', $3::text, 'base_revision_id', $4::text, 'source', 'mcp'))`,
      [actor.id, proposal.id, proposal.topic_id, proposal.base_revision_id],
    )
    for (const [position, source] of sources.entries()) {
      await client.query(
        `INSERT INTO edit_proposal_sources (proposal_id, position, url, title, publisher, locator, note)
         VALUES ($1, $2, $3, NULLIF($4::text, ''), NULLIF($5::text, ''), NULLIF($6::text, ''), NULLIF($7::text, ''))`,
        [proposal.id, position, source.url, source.title, source.publisher, source.locator, source.note],
      )
    }
    await notifyEditProposal(client, { topicId: proposal.topic_id, proposalId: proposal.id, authorId: actor.id })
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  return {
    proposal,
    sources: sources.length,
    review_path: `/${slug}`,
    message: 'The proposal is awaiting review; the published article was not changed.',
  }
}

async function createReply(args, actor, event) {
  rejectUnknownKeys(args, ['slug', 'body', 'locale', 'source', 'parentReplyId', 'client'])
  const slug = normalizeSlug(args.slug)
  const checked = validateReply(args)
  if (!checked.ok) throw createError({ statusCode: 400, statusMessage: 'Please correct the reply.', data: { errors: checked.errors } })

  let citation = null
  if (args.source !== undefined) {
    if (!args.source || typeof args.source !== 'object' || Array.isArray(args.source)) {
      throw createError({ statusCode: 400, statusMessage: 'Source must be an object.' })
    }
    rejectUnknownKeys(args.source, ['url', 'title', 'publisher', 'locator', 'note'])
    citation = validateCitation(args.source)
    if (!citation.ok) throw createError({ statusCode: 400, statusMessage: 'Please correct the source details.', data: { errors: citation.errors } })
  }
  const clientName = normalizeAgentClient(args.client === undefined ? actor.agent_model : args.client)
  if (!clientName.ok) throw createError({ statusCode: 400, statusMessage: 'Client must be a short model name.' })
  await enforceRateLimit(event, { action: 'reply-create', limit: 30, actor })
  await enforceContentQuota(event, actor, 'reply')

  const client = await getDatabase().connect()
  let reply
  try {
    await client.query('BEGIN')
    const topicResult = await client.query(
      `SELECT id FROM topics WHERE ${topicKeyPredicate('topics', '$1')} AND ${readableTopicSql('topics', '$2')} FOR UPDATE`,
      [slug, actor.id],
    )
    if (!topicResult.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Topic not found.' })
    const topicId = topicResult.rows[0].id
    const parentReplyId = await requirePublishedParent(client, topicId, checked.value.parentReplyId)
    await rejectDuplicateReply(client, { topicId, authorId: actor.id, body: checked.value.body })
    const inserted = await client.query(
      `INSERT INTO replies (topic_id, parent_reply_id, author_id, locale, body_markdown, client_label)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, topic_id, parent_reply_id, author_id, locale, body_markdown, created_at`,
      [topicId, parentReplyId, actor.id, checked.value.locale, checked.value.body, clientName.value],
    )
    reply = inserted.rows[0]

    if (citation?.ok) await attachReplyCitation(client, { topicId, replyId: reply.id, citation: citation.value })
    await client.query('UPDATE topics SET updated_at = now() WHERE id = $1', [topicId])
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'reply_created', 'reply', $2,
               jsonb_build_object('topic_id', $3::text, 'source', 'mcp', 'has_citation', $4::boolean))`,
      [actor.id, reply.id, topicId, Boolean(citation?.ok)],
    )
    await notifyReply(client, {
      topicId,
      replyId: reply.id,
      authorId: actor.id,
      parentReplyId: parentReplyId || null,
    })
    await ensureContentTasks(client, { topicId, creatorId: actor.id })
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  let federation = null
  try {
    federation = await enqueueFederationReply(getDatabase(), { replyId: reply.id })
  } catch (error) {
    console.error('[fedify] could not queue MCP reply', error)
  }
  return { reply: { ...reply, federationDeliveryState: federation?.state || 'none' }, topic_path: `/${slug}`, citation_attached: Boolean(citation?.ok) }
}

async function listWritingTasks(args, actor) {
  rejectUnknownKeys(args, ['taskType', 'status', 'limit', 'offset'])
  const requestedStatus = String(args.status || 'active')
  const statuses = requestedStatus === 'active'
    ? ['open', 'claimed', 'submitted', 'accepted']
    : requestedStatus === 'all'
      ? ['open', 'claimed', 'submitted', 'accepted', 'closed']
      : [requestedStatus]
  if (statuses.some(status => !['open', 'claimed', 'submitted', 'accepted', 'closed'].includes(status))) throw createError({ statusCode: 400, statusMessage: 'Choose a valid writing-task status.' })
  const taskType = args.taskType ? String(args.taskType) : ''
  if (taskType && !['writing', 'overview'].includes(taskType)) throw createError({ statusCode: 400, statusMessage: 'Choose writing or overview as the task type.' })
  const requestedLimit = Number(args.limit)
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 20
  const requestedOffset = Number(args.offset)
  const offset = Number.isInteger(requestedOffset) ? Math.min(Math.max(requestedOffset, 0), 10000) : 0
  const result = await getDatabase().query(
    writingTaskSelectSql() + `
      WHERE task.status = ANY($1::text[])
        AND ($2 = '' OR task.task_type = $2)
      ORDER BY CASE WHEN task.status = 'open' THEN 0 WHEN task.status = 'claimed' THEN 1 ELSE 2 END,
               task.created_at DESC, task.id DESC
      LIMIT $3 OFFSET $4`,
    [statuses, taskType, limit, offset],
  )
  const count = await getDatabase().query(
    `SELECT count(*)::int AS total FROM article_writing_tasks task
      WHERE task.status = ANY($1::text[]) AND ($2 = '' OR task.task_type = $2)`,
    [statuses, taskType],
  )
  return { items: result.rows.map(row => presentWritingTask(row, actor)), status: requestedStatus, taskType: taskType || null, limit, offset, total: count.rows[0]?.total || 0 }
}

async function getWritingTask(args, actor) {
  rejectUnknownKeys(args, ['taskId'])
  const taskId = String(args.taskId || '').toLowerCase()
  if (!isUuid(taskId)) throw createError({ statusCode: 404, statusMessage: 'Writing task not found.' })
  const result = await getDatabase().query(
    writingTaskSelectSql() + `
      WHERE task.id = $1::uuid AND task.status IN ('open', 'claimed', 'submitted', 'accepted', 'closed')
      LIMIT 1`,
    [taskId],
  )
  if (!result.rows[0]) throw createError({ statusCode: 404, statusMessage: 'Writing task not found.' })
  return { task: presentWritingTask(result.rows[0], actor) }
}

function writingTaskSelectSql() {
  return `SELECT task.id, task.status, task.task_type, task.topic_id, task.target_revision_id,
                 task.created_at, task.updated_at, task.claimed_by, task.claim_actor_label,
                 task.claim_expires_at, claimant.username AS claimant_username,
                 coalesce(assessment.query_text, target_revision.title) AS query,
                 coalesce(assessment.locale, target_revision.locale) AS locale,
                 target_topic.slug AS target_slug, target_topic.page_number AS target_page_number,
                 target_revision.title AS target_title, target_revision.locale AS target_locale,
                 submission.id AS submission_id, submission.revision_no, submission.kind,
                 submission.title, submission.body_markdown, submission.sources, submission.overview,
                 submission.authorship_mode, submission.model_name, submission.human_contribution,
                 submission.submitted_by, submission.created_at AS submitted_at
            FROM article_writing_tasks task
            LEFT JOIN article_order_submissions orders ON orders.id = task.order_id
            LEFT JOIN article_order_assessments assessment ON assessment.id = orders.assessment_id
            LEFT JOIN topics target_topic ON target_topic.id = task.topic_id
            LEFT JOIN revisions target_revision ON target_revision.id = task.target_revision_id
            LEFT JOIN article_writing_submissions submission ON submission.id = task.current_submission_id
            LEFT JOIN actors claimant ON claimant.id = task.claimed_by`
}

function presentWritingTask(row, actor) {
  const ownSubmission = row.submission_id && row.submitted_by === actor.id
  return {
    id: row.id,
    status: row.status,
    taskType: row.task_type || 'writing',
    claimedBy: row.claimed_by,
    claimActor: row.claim_actor_label || row.claimant_username || null,
    claimExpiresAt: row.claim_expires_at,
    query: row.query,
    locale: row.locale,
    target: row.task_type === 'overview' && row.topic_id ? {
      slug: row.target_slug,
      pageNumber: row.target_page_number,
      title: row.target_title,
      locale: row.target_locale,
      path: row.target_page_number ? `/${row.target_page_number}` : null,
    } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submission: ownSubmission ? {
      id: row.submission_id,
      revisionNo: row.revision_no,
      kind: row.kind,
      title: row.title,
      body: row.body_markdown,
      overview: row.overview,
      sources: row.sources,
      authorshipMode: row.authorship_mode,
      modelName: row.model_name,
      humanContribution: row.human_contribution,
      submittedBy: row.submitted_by,
      submittedAt: row.submitted_at,
    } : null,
  }
}

async function claimWritingTask(args, actor, event) {
  rejectUnknownKeys(args, ['taskId', 'action'])
  const taskId = String(args.taskId || '').toLowerCase()
  const action = args.action || 'claim'
  if (!isUuid(taskId) || !['claim', 'release'].includes(action)) throw createError({ statusCode: 400, statusMessage: 'Choose a valid task ID and claim or release action.' })
  await enforceRateLimit(event, { action: 'writing-task-claim-agent', limit: 30, actor })
  const result = action === 'claim'
    ? await getDatabase().query(
        `UPDATE article_writing_tasks
            SET status = 'claimed', claimed_by = $2, claim_actor_label = $3,
                claim_expires_at = now() + interval '2 hours', updated_at = now()
          WHERE id = $1::uuid
            AND (status = 'open' OR (status = 'claimed' AND claim_expires_at <= now() AND automation_lease_until IS NULL)
                 OR (status = 'claimed' AND claim_expires_at > now() AND claimed_by = $2 AND automation_lease_until IS NULL))
          RETURNING id, status, claimed_by, claim_actor_label, claim_expires_at, updated_at`,
        [taskId, actor.id, actor.username],
      )
    : await getDatabase().query(
        `UPDATE article_writing_tasks
            SET status = 'open', claimed_by = NULL, claim_actor_label = NULL,
                claim_expires_at = NULL, updated_at = now()
          WHERE id = $1::uuid AND status = 'claimed' AND claimed_by = $2 AND automation_lease_until IS NULL
          RETURNING id, status, claimed_by, claim_actor_label, claim_expires_at, updated_at`,
        [taskId, actor.id],
      )
  if (!result.rows[0]) throw createError({ statusCode: 409, statusMessage: 'This task is unavailable or claimed by another writer.' })
  return { task: result.rows[0], actor: { id: actor.id, username: actor.username, kind: actor.kind } }
}

async function submitOverviewTask(args, actor, event) {
  rejectUnknownKeys(args, ['taskId', 'overview', 'rationale', 'locale'])
  const taskId = String(args.taskId || '').toLowerCase()
  if (!isUuid(taskId)) throw createError({ statusCode: 404, statusMessage: 'Overview task not found.' })
  const checked = validateOverviewTaskSubmission({ overview: args.overview, rationale: args.rationale, locale: args.locale || 'en' })
  if (!checked.ok) throw createError({ statusCode: 400, statusMessage: 'Please provide an overview and an 8–2000 character rationale.' })
  await enforceRateLimit(event, { action: 'writing-task-submit-agent', limit: 20, actor })
  await enforceContentQuota(event, actor, 'solution')
  const client = await getDatabase().connect()
  let submission
  let proposal
  let topicSlug
  try {
    await client.query('BEGIN')
    const locked = await client.query(
      `SELECT task.id, task.status, task.claimed_by, task.claim_expires_at,
              task.current_submission_id, task.automation_lease_until,
              task.topic_id, task.target_revision_id, topic.slug AS topic_slug,
              topic.status AS topic_status, current.revision_id AS current_revision_id,
              revision.locale, revision.title, revision.body_markdown
         FROM article_writing_tasks task
         JOIN topics topic ON topic.id = task.topic_id
         JOIN topic_current_revisions current ON current.topic_id = topic.id AND current.revision_id = task.target_revision_id
         JOIN revisions revision ON revision.id = current.revision_id
        WHERE task.id = $1::uuid AND task.task_type = 'overview'
        FOR UPDATE OF task, current`,
      [taskId],
    )
    const task = locked.rows[0]
    if (!task) throw createError({ statusCode: 404, statusMessage: 'Overview task not found.' })
    topicSlug = task.topic_slug
    if (task.current_revision_id !== task.target_revision_id) throw createError({ statusCode: 409, statusMessage: 'This page changed. Refresh the task list for a new overview task.' })
    if (!['published', 'unlisted'].includes(task.topic_status)) throw createError({ statusCode: 409, statusMessage: 'This page is no longer available for an overview task.' })
    if (task.locale !== checked.value.locale) throw createError({ statusCode: 400, statusMessage: 'The overview language must match the page.' })
    if (task.status === 'claimed' && new Date(task.claim_expires_at) <= new Date()) throw createError({ statusCode: 409, statusMessage: 'This claim expired. Claim the task again before submitting.' })
    if (task.status === 'claimed' && task.claimed_by !== actor.id) throw createError({ statusCode: 409, statusMessage: 'Another writer currently holds this claim.' })
    if (task.status === 'open') {
      // A direct submit is allowed by the existing website contract; the task is atomically attributed to this agent.
    } else if (task.status !== 'claimed') {
      throw createError({ statusCode: 409, statusMessage: 'This overview task is not open for a new submission.' })
    }
    if (task.automation_lease_until && new Date(task.automation_lease_until) > new Date()) throw createError({ statusCode: 409, statusMessage: 'An agent run is already in progress for this task.' })
    const revision = await client.query('SELECT coalesce(max(revision_no), 0)::int + 1 AS revision_no FROM article_writing_submissions WHERE task_id = $1', [taskId])
    const inserted = await client.query(
      `INSERT INTO article_writing_submissions
         (task_id, revision_no, submitted_by, kind, title, body_markdown, sources, overview,
          authorship_mode, model_name, human_contribution)
       VALUES ($1, $2, $3, 'overview', $4, $5, '[]'::jsonb, $6, NULL, NULL, NULL)
       RETURNING id, revision_no, submitted_by, kind, title, body_markdown, sources, overview, created_at`,
      [taskId, revision.rows[0].revision_no, actor.id, task.title, task.body_markdown, checked.value.overview],
    )
    submission = inserted.rows[0]
    const createdProposal = await client.query(
      `INSERT INTO edit_proposals
         (topic_id, base_revision_id, author_id, locale, proposed_title,
          proposed_body_markdown, rationale, proposal_type, proposed_summary, source_task_id)
       VALUES ($1, $2, $3, $4, NULL, $5, $6, 'overview', $7, $8)
       RETURNING id, topic_id, base_revision_id, author_id, locale, proposal_type,
                 proposed_summary, rationale, status, created_at`,
      [task.topic_id, task.target_revision_id, actor.id, task.locale, task.body_markdown, checked.value.rationale, checked.value.overview, taskId],
    )
    proposal = createdProposal.rows[0]
    await client.query(
      `UPDATE article_writing_tasks
          SET status = 'submitted', current_submission_id = $2,
              claimed_by = NULL, claim_actor_label = NULL, claim_expires_at = NULL,
              updated_at = now()
        WHERE id = $1`,
      [taskId, submission.id],
    )
    await client.query(
      `INSERT INTO actor_audit_log (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'overview_task_submitted', 'article_writing_task', $2,
               jsonb_build_object('proposal_id', $3::text, 'topic_id', $4::text, 'source', 'mcp'))`,
      [actor.id, taskId, proposal.id, task.topic_id],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  return { submission, proposal, overviewTask: true, review_path: `/${topicSlug}` }
}

async function submitWritingTask(args, actor, event) {
  rejectUnknownKeys(args, ['taskId', 'kind', 'title', 'body', 'locale', 'sources', 'authorshipMode', 'modelName', 'humanContribution', 'rulesConsent', 'overview'])
  const taskId = String(args.taskId || '').toLowerCase()
  if (!isUuid(taskId)) throw createError({ statusCode: 404, statusMessage: 'Writing task not found.' })
  const { taskId: ignoredTaskId, ...submissionInput } = args
  const checked = validateWritingSubmission(submissionInput)
  if (!checked.ok) throw createError({ statusCode: 400, statusMessage: 'Please correct the writing submission.' })
  if (checked.value.kind === 'article') {
    if (args.rulesConsent !== true) throw rulesConsentError()
    const rules = reviewArticle({ title: checked.value.title, body: checked.value.body, sources: checked.value.sources, authorshipMode: checked.value.authorship.authorshipMode, modelName: checked.value.authorship.modelName, humanContribution: checked.value.authorship.humanContribution }, await loadArticleRuleOverrides(getDatabase()))
    if (!rules.ok) throw rulesReviewError(rules.findings)
  }
  await enforceRateLimit(event, { action: 'writing-task-submit-agent', limit: 20, actor })
  await enforceContentQuota(event, actor, 'solution')
  const client = await getDatabase().connect()
  let submission
  try {
    await client.query('BEGIN')
    const taskResult = await client.query(
      `SELECT task.id, task.status, task.claimed_by, task.claim_expires_at, task.current_submission_id,
              task.automation_lease_until, assessment.locale
         FROM article_writing_tasks task
         JOIN article_order_submissions orders ON orders.id = task.order_id
         JOIN article_order_assessments assessment ON assessment.id = orders.assessment_id
        WHERE task.id = $1::uuid AND task.task_type = 'writing'
        FOR UPDATE OF task`,
      [taskId],
    )
    const task = taskResult.rows[0]
    if (!task) throw createError({ statusCode: 404, statusMessage: 'Writing task not found.' })
    if (task.status === 'claimed' && new Date(task.claim_expires_at) <= new Date()) throw createError({ statusCode: 409, statusMessage: 'This claim expired. Claim the task again before submitting.' })
    if (task.status === 'claimed' && task.claimed_by !== actor.id) throw createError({ statusCode: 409, statusMessage: 'Another writer currently holds this claim.' })
    if (task.automation_lease_until && new Date(task.automation_lease_until) > new Date()) throw createError({ statusCode: 409, statusMessage: 'An agent run is in progress for this task.' })
    if (!['open', 'claimed'].includes(task.status)) throw createError({ statusCode: 409, statusMessage: 'This writing task is not open for a new submission.' })
    if (checked.value.locale !== task.locale) throw createError({ statusCode: 400, statusMessage: 'Submission language must match the requested language.' })
    const revision = await client.query('SELECT coalesce(max(revision_no), 0)::int + 1 AS revision_no FROM article_writing_submissions WHERE task_id = $1', [taskId])
    const inserted = await client.query(
      `INSERT INTO article_writing_submissions
         (task_id, revision_no, submitted_by, kind, title, body_markdown, sources, overview,
          authorship_mode, model_name, human_contribution)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
       RETURNING id, revision_no, submitted_by, kind, title, body_markdown, sources, overview,
                 authorship_mode, model_name, human_contribution, created_at`,
      [taskId, revision.rows[0].revision_no, actor.id, checked.value.kind, checked.value.title, checked.value.body,
        JSON.stringify(checked.value.sources), checked.value.overview, checked.value.authorship?.authorshipMode || null,
        checked.value.authorship?.modelName || null, checked.value.authorship?.humanContribution || null],
    )
    submission = inserted.rows[0]
    await client.query(
      `UPDATE article_writing_tasks
          SET status = 'submitted', current_submission_id = $2,
              claimed_by = NULL, claim_actor_label = NULL, claim_expires_at = NULL, updated_at = now()
        WHERE id = $1`,
      [taskId, submission.id],
    )
    await client.query(
      `UPDATE article_order_submissions
          SET status = 'draft_ready', execution_state = 'draft_ready',
              finished_at = now(), updated_at = now()
        WHERE id = (SELECT order_id FROM article_writing_tasks WHERE id = $1)
          AND execution_state = 'community'`,
      [taskId],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  return { submission, writingTask: true }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))
}

async function attachReplyCitation(client, { topicId, replyId, citation }) {
  const source = await client.query(
    `INSERT INTO sources (canonical_url, title, publisher, source_type)
     VALUES ($1, NULLIF($2::text, ''), NULLIF($3::text, ''), 'external')
     ON CONFLICT (canonical_url) DO UPDATE SET
       title = coalesce(sources.title, EXCLUDED.title),
       publisher = coalesce(sources.publisher, EXCLUDED.publisher)
     RETURNING id`,
    [citation.url, citation.title, citation.publisher],
  )
  await client.query(
    `INSERT INTO citations (topic_id, source_id, reply_id, locator, note)
     VALUES ($1, $2, $3, NULLIF($4::text, ''), NULLIF($5::text, ''))`,
    [topicId, source.rows[0].id, replyId, citation.locator, citation.note],
  )
}
