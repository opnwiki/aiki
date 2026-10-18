# Automatic search engine discovery

An AIKI node announces its public pages to search engines automatically. None of the methods below requires manually registering the site in a search engine console.

## What works automatically

- `robots.txt` publishes the root `sitemap.xml` and the recent `news-sitemap.xml`.
- `sitemap.xml` contains canonical public pages with a correct `lastmod`.
- `news-sitemap.xml` contains recent articles published in the last two days.
- `/feed.xml` serves an RSS feed of the latest public pages, linked through `<link rel="alternate">`, and declares a WebSub hub.
- After a public page is published or changed, the server sends:
  - an IndexNow batch notification through the global endpoint (only when `INDEXNOW_KEY` is set);
  - a WebSub publish notification for the RSS feed.
- The RSS feed and the feed's HTTP header publish `rel="hub"` and a canonical `rel="self"`.
- Pages have a canonical URL, hreflang for available revisions, JSON-LD, internal links, and a public `llms.txt`.

## IndexNow key

Set `INDEXNOW_KEY` to a random string of 8–128 letters, digits, or dashes (for example `openssl rand -hex 16`). The node then serves `/<INDEXNOW_KEY>.txt` with the key as its body and includes the key in notifications. Without the variable, IndexNow notifications are disabled.

The key file is not an application secret. It is the standard proof that the sender controls the domain. Use a different key for every node.

A single IndexNow endpoint forwards the notification to all participating search engines; there is no need to repeat the same batch for each endpoint. Participants include Bing, Naver, Seznam, Yandex, Yep, and others.

## What is deliberately not used

- Google Search Console URL Inspection: requires a verified owner and a manual action.
- Google Indexing API: requires a service account and ownership verification and is intended only for `JobPosting` or live-stream `BroadcastEvent`, so it does not fit regular AIKI articles.
- The old `https://www.google.com/ping?sitemap=...`: Google has disabled sitemap ping.
- The old anonymous Bing `bing.com/ping?sitemap=...`: Bing removed it and recommends robots.txt and IndexNow.
- Brave and similar separate consoles: no official public registration-free API for submitting a sitemap was found; the reliable channels for them are the RSS feed, sitemap, robots.txt, and external links.

## Limits

All of these methods speed up discovery and re-crawling. Neither Google, Bing, nor IndexNow promises that every page will be indexed: quality, uniqueness, availability, canonical URLs, and internal and external links are still evaluated by the search engine itself.
