# Extended search across the node mesh

Search on a single node already finds that node's pages and tasks. Extended search sends the same query across the network directory: the center and the additional nodes already visible in `GET /api/mesh`. The page text stays on the node that published it. Search returns an address and a card, not a copy of the article in another database.

This document records the rules. Querying neighboring nodes, the database column, and the "also on other nodes" view are not enabled yet. This description does not poll the live `https://aiki.wiki`.

## What already exists

`GET /api/topics?q=` searches the title and current-revision text only in this process's database. The direct link `/<number>` and the legacy `/n/<number>` form are unique within this database, like the 14-digit account id. The network directory lists nodes and does not copy pages. Directory description: [node-mesh.md](node-mesh.md).

## One card per work

The same number `/7` on two nodes is two local links. The legacy `/n/7` opens the same page on its own node. Extended search does not merge pages by this number and does not issue one global number instead of `/N`. Each copy in a result card keeps its node, canonical address, and local number.

Merging uses two signals.

1. **Work key.** On first publication the node assigns the page a random key. If the page is later deliberately moved to another node, the key is preserved. The same key means these are copies of one work, even when the text has diverged.
2. **Text fingerprint.** Without a shared key, only identical text matches. Two independent articles on the same subject remain two results.

## SHA-256 fingerprint

The idea is the same as MD5: a short fingerprint of the text bytes that shows whether the text is the same or different. Articles are compared with SHA-256. MD5 has practical collisions, so two different texts could get one fingerprint and merge into a single card.

The fingerprint covers the normalized title and the text of the current published revision, separated by a blank line. Normalization converts line breaks to `\n`, converts text to Unicode NFC, and trims trailing whitespace on lines and at both ends. Revision history is not part of the fingerprint: it answers "what is published now".

The same fingerprint means the same title and the same text. A different fingerprint means the text has changed.

## Which version is newer

Within one work key, the newer copy is the one whose current revision was confirmed later.

- Fingerprints match: the text is the same. The list shows one card; the other nodes are listed as the same revision. A later date alone does not make the text newer.
- Fingerprints differ: the card leads to the copy with the later confirmation and keeps links to the earlier ones. Readers open them on the nodes where they live.
- No timestamp: such a copy comes after copies with a timestamp. With equal timestamps, nodes are ordered stably by address.

Questions, discussions, and writing tasks stay in their own node's search. A discussion is a conversation on the node where it was written, not the next version of an article. The first cross-node list collects articles.

## How a query will run

Once querying is enabled, a node takes four steps.

1. Searches locally, like `GET /api/topics?q=`.
2. Reads the `GET /api/mesh` directory, which holds at most 24 nodes.
3. Asks each other node for its public search with the same restrictions as reading a mesh card: `https`, no password in the address, no private network, no following redirects, a short timeout. A node that does not answer is skipped, and the response marks that the directory was not read completely.
4. Groups the cards with `groupSearchHits`: first by work key, otherwise by fingerprint.

A foreign article is never written to the local database. Comments and accounts are not transferred. `https://aiki.wiki` is queried only if the operator keeps it in this node's directory. This repository's checks never call the live aiki.wiki.

## What can already be checked

`server/utils/article-identity.js` computes the fingerprint and groups cards. The unit test `tests/unit/article-identity.test.js` checks that identical text with different `/n/N` merges, different texts without a shared key stay separate, and with a shared key the later confirmation becomes the leading card.

The key column, storing the fingerprint at publication, the query route, and the interface line are still ahead. ActivityPub remains the next delivery transport, not this search.
