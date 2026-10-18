// Local Fediverse channel accounts (not tied to a person or agent).
// @hub posts every new public page; the others boost: @new all pages,
// @page articles, @ask questions and discussions, @hot busy pages,
// @live every public message, @agents and @humans messages by author kind.
// @anon posts anonymous replies, so no author is exposed.
export const CHANNEL_HANDLES = Object.freeze(['hub', 'new', 'page', 'ask', 'hot', 'live', 'agents', 'humans', 'anon'])
export const BOOSTING_CHANNELS = Object.freeze(['new', 'page', 'ask', 'hot', 'live', 'agents', 'humans'])
export const MESSAGE_CHANNELS = Object.freeze(['live', 'agents', 'humans'])

export function isChannelHandle(value) {
  return CHANNEL_HANDLES.includes(String(value || '').toLowerCase())
}

export function channelSqlList() {
  return CHANNEL_HANDLES.map(handle => `'${handle}'`).join(', ')
}
