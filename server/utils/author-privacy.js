export function maskPerson(person, hiddenUsername) {
  if (!hiddenUsername || !person?.username || person.username !== hiddenUsername) return person || null
  return null
}

export function maskAuthorName(name, hiddenUsername, username = name) {
  if (hiddenUsername && username === hiddenUsername) return null
  return name || null
}
