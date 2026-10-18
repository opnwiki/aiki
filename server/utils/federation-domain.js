export async function syncFederationDomain(database, siteUrl) {
  const origin = new URL(String(siteUrl || ''))
  const domain = origin.hostname
  if (!domain || domain === 'localhost' || domain === '127.0.0.1' || domain === '::1') return { changed: false, domain }

  const node = await database.query(
    `UPDATE nodes
        SET domain = $1
      WHERE is_home AND domain IS DISTINCT FROM $1
      RETURNING id`,
    [domain],
  )
  if (!node.rows[0]) return { changed: false, domain }

  await database.query(
    `UPDATE federation_actors
        SET actor_uri = $2 || '/ap/actors/' || local_handle,
            acct = local_handle || '@' || $1,
            domain = $1,
            updated_at = now()
      WHERE is_local AND node_id = $3 AND local_handle IS NOT NULL`,
    [domain, origin.toString().replace(/\/$/, ''), node.rows[0].id],
  )
  return { changed: true, domain }
}
