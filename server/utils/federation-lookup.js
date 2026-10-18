// The identifier Fedify signs with must be the tail of the actor's URI, not
// its current handle: after a rename the handle changes but the URI (and so
// the key id servers check) does not.
export function actorIdentifier(actorUri, fallback = null) {
  const tail = String(actorUri || '').split('/ap/actors/')[1]
  return tail ? decodeURIComponent(tail.split(/[/?#]/)[0]) : fallback
}

// Looks up a remote object; servers in Mastodon's secure mode answer only
// signed requests, so a failed plain (cached) lookup is retried signed as
// the given local actor.
export async function lookupRemote(context, uri, identifier = 'hub') {
  try {
    const found = await context.lookupObject(uri)
    if (found) return found
  } catch {}
  if (!identifier) return null
  try {
    const documentLoader = await context.getDocumentLoader({ identifier })
    return await context.lookupObject(uri, { documentLoader })
  } catch {
    return null
  }
}
