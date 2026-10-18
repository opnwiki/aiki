# AIKI node mesh

The central instance and additional nodes are the same AIKI build. There is no separate "network server". A node's role is set by configuration: the public address of this process and the address of the center.

The default center is `https://aiki.wiki`. If the process's public address matches the center address, this process is the central instance. Otherwise the process is an additional node that knows where the center is.

The center address can be changed in the admin settings. An empty saved value means `https://aiki.wiki` again, unless the `AIKI_HUB_URL` variable overrides it.

## How nodes find each other

Additional nodes do not need to know each other in advance. They know the center.

1. An additional node sends its address to the center (`POST /api/mesh/announce`).
2. The center itself requests `GET /api/mesh` at that address and accepts the node only if the card names the same address in `self.url`.
3. The center keeps the shared directory.
4. An additional node reads the center's directory and sees the other nodes.
5. Additional nodes are linked through the center: they end up in the same directory and can therefore find each other. This is the first mesh — a mesh through the center.

Direct exchange of pages, comments, and accounts is not part of this slice. The directory answers "which nodes exist and who are we linked to", not "copy someone else's articles".

A public page already opens from the internet at its own node's address. Another node finds that address through the directory. This is how project documentation, proposal forums, fandom wikis, and API references are run. Examples: [use-cases.md](use-cases.md).

Only the center accepts announcements. An additional node does not build its own directory: it refreshes the map from the center's directory.

## The map in the admin settings

An owner or admin sees on the settings page:

- this node's role: center or additional;
- how many nodes are in the directory, including itself;
- the center address;
- the list of nodes and the map.

The center is in the middle of the map, with a line to every node. Fainter lines connect additional nodes: they find each other through the center. Regular members cannot change the map.

The public `GET /api/mesh` card returns the same directory without signing in, so another node can read it. The card protocol is `aiki-mesh-0`.

## Version

The "About this node" page shows the release number, currently `1.2.11`. The public `GET /api/node` returns the same number in `node.version`.

An additional node compares its number with the center's `node.version`. The comparison is numeric, so `1.2.11` is newer than `1.2.10` and `1.2.2`. If the center's number is higher, the owner and admins see in the settings that a new version is available. The center does not show this to itself. If the center did not answer, redirected the request, or returned a non-numeric version, there is no notice. A local process whose center is still `https://aiki.wiki` does not poll that address.

## Why the first transport is not ActivityPub

ActivityPub fits as the next step: an actor, an inbox, and signed delivery. The first mesh needs a shared directory and a map, not an activity feed. A small directory lives in the same code as the node and does not require a second product.

Later the card may get an ActivityPub actor. The center's role and the rule "additional nodes find each other through the center" do not change. Signatures, inboxes, and page delivery are not part of this slice yet.

## Limits of this slice

- The directory holds at most 24 nodes.
- Only an `https` address without a username, password, path, or private network is accepted. An `http` loopback address is accepted only with `AIKI_MESH_ALLOW_LOOPBACK=1`; this is for local testing, not production.
- Redirect responses are not followed, so the center never follows someone else's redirect into an internal network.
- A card is accepted only if `self.url` matches the announced address.
- Changing the center address clears the previous directory: the old center's nodes do not stay on the new map.
- Page and account identifiers remain local to the node's database. The directory does not make them globally unique. How extended search recognizes the same article on different nodes and where the text is newer: [cross-node-search.md](cross-node-search.md). Querying neighboring nodes is not enabled yet.
- A test node does not poll the live aiki.wiki and does not add it to its directory.

## Configuration

- `NUXT_PUBLIC_SITE_URL` or `SITE_URL` — the public address of this node.
- `AIKI_HUB_URL` — the center address. Defaults to `https://aiki.wiki`.
- `AIKI_MESH_ALLOW_LOOPBACK=1` — allows loopback addresses for local directory testing.

The center address saved in the admin settings is stored per database. While it is not empty, it takes precedence over `AIKI_HUB_URL`.
