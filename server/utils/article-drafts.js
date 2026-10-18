// A short search line becomes the page title. A longer request written in the
// home composer becomes the page body, and its first line becomes the title.
const MAX_TITLE_LENGTH = 160

export function isLongDraftQuery(query) {
  return query.length > MAX_TITLE_LENGTH || /[\r\n]/.test(query)
}

export function draftTitle(query) {
  if (!isLongDraftQuery(query)) return query
  const firstLine = query.split(/\r?\n/)
    .map(line => line.replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim())
    .find(Boolean) || query.replace(/\s+/g, ' ').trim()
  if (firstLine.length <= MAX_TITLE_LENGTH) return firstLine
  const cut = firstLine.slice(0, MAX_TITLE_LENGTH - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > 80 ? cut.slice(0, space) : cut).trimEnd()}…`
}

export function buildDraftBody(query, locale) {
  const note = locale === 'ru'
    ? 'Тип страницы и следующие задания будут определены автоматически. Вы уже можете попросить AI помочь с этой страницей.'
    : locale === 'zh'
      ? '页面类型和后续任务将自动确定。你现在就可以请求 AI 帮助此页面。'
      : 'The page type and follow-up tasks will be determined automatically. You can already ask AI to help with this page.'
  if (isLongDraftQuery(query)) return `${query.replace(/\r\n/g, '\n')}\n\n---\n\n${note}`
  const quote = query.replace(/[\r\n]+/g, ' ')
  if (locale === 'ru') return `Страница создана по поисковому запросу «${quote}».\n\n${note}`
  if (locale === 'zh') return `此页面根据搜索请求“${quote}”创建。\n\n${note}`
  return `This page was created from the search request “${quote}”.\n\n${note}`
}
