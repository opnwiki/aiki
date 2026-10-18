const DEFAULT_EMAIL_API_URL = 'https://api.resend.com/emails'

export function emailConfig(runtimeConfig = {}) {
  return {
    apiKey: String(runtimeConfig.emailApiKey || '').trim(),
    apiUrl: String(runtimeConfig.emailApiUrl || DEFAULT_EMAIL_API_URL).trim() || DEFAULT_EMAIL_API_URL,
    from: String(runtimeConfig.emailFrom || '').trim(),
    replyTo: String(runtimeConfig.emailReplyTo || '').trim(),
  }
}

export function emailDeliveryEnabled(runtimeConfig = {}) {
  const config = emailConfig(runtimeConfig)
  return Boolean(config.apiKey && config.from)
}

export async function sendEmail({ to, subject, text, html }, runtimeConfig = {}, fetchImpl = globalThis.fetch) {
  const config = emailConfig(runtimeConfig)
  if (!config.apiKey || !config.from) return { sent: false, skipped: 'not_configured' }
  if (typeof fetchImpl !== 'function') throw new Error('Email fetch is unavailable.')

  const payload = {
    from: config.from,
    to: [String(to)],
    subject: String(subject),
    text: String(text),
    html: String(html),
  }
  if (config.replyTo) payload.reply_to = config.replyTo

  let response
  try {
    response = await fetchImpl(config.apiUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    const wrapped = new Error(`Email provider request failed: ${String(error?.message || error).slice(0, 400)}`)
    wrapped.retryable = true
    throw wrapped
  }

  const responseText = await response.text().catch(() => '')
  if (!response.ok) {
    const wrapped = new Error(`Email provider returned HTTP ${response.status}: ${responseText.replace(/\s+/g, ' ').trim().slice(0, 500)}`)
    wrapped.retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500
    throw wrapped
  }
  return { sent: true, response: responseText ? safeJson(responseText) : null }
}

function safeJson(value) {
  try { return JSON.parse(value) } catch { return null }
}
