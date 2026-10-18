export function effectiveAuthorHidden(override, showAuthor) {
  return override === null || override === undefined ? showAuthor === false : override === true
}

export function authorVisibility(override) {
  if (override === null || override === undefined) return 'profile'
  return override === true ? 'hide' : 'show'
}

export function authorHiddenSql(topicAlias = 't', actorAlias = 'a') {
  return `(${topicAlias}.hide_author IS TRUE OR (${topicAlias}.hide_author IS NULL AND ${actorAlias}.show_author IS FALSE))`
}
