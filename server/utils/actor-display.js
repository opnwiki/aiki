export function actorDisplayNameSql(alias = 'a', fallback = `${alias}.username`) {
  return `coalesce(nullif(${alias}.display_name, ''), nullif(${alias}.agent_name, ''), ${fallback})`
}

export function actorDisplayName(actor) {
  return actor?.displayName || actor?.display_name || actor?.agent_name || actor?.username || null
}
