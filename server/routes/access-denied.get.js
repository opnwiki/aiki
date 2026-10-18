import { getQuery, sendRedirect, setResponseHeader, setResponseStatus } from 'h3'
import { evaluateAccess } from '../utils/access-control.js'

const SECURITY_LABELS = {
  is_attacker: 'attacker',
  is_abuser: 'abuser',
  is_threat: 'threat',
  is_cloud_provider: 'cloud provider',
  is_vpn: 'VPN',
  is_proxy: 'proxy',
  is_tor: 'Tor',
  is_tor_exit: 'Tor exit',
  is_relay: 'relay',
  is_anonymous: 'anonymous network',
  is_bogon: 'bogon',
  is_clean: 'clean',
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
}

function languageFor(event) {
  return String(event.node.req.headers['accept-language'] || '').toLowerCase().startsWith('ru') ? 'ru' : 'en'
}

function renderPage(language, decision) {
  const ru = language === 'ru'
  const title = ru ? 'Доступ запрещён' : 'Access denied'
  const intro = ru
    ? 'Этот запрос заблокирован настройками доступа узла.'
    : 'This request was blocked by this node’s access settings.'
  const categoryLabel = ru ? 'Причина' : 'Reason'
  const category = escapeHtml(decision.category || (ru ? 'Ограничение доступа' : 'Access rule'))
  const customReason = decision.reason ? `<p class="reason">${escapeHtml(decision.reason)}</p>` : ''
  const country = decision.profile?.country ? `<div><dt>${ru ? 'Страна' : 'Country'}</dt><dd>${escapeHtml(decision.profile.country)}</dd></div>` : ''
  const securityLabels = Object.entries(decision.profile?.security || {})
    .filter(([, value]) => value === true)
    .map(([key]) => SECURITY_LABELS[key] || key)
  const security = securityLabels.length
    ? `<div><dt>Statica</dt><dd>${securityLabels.map(escapeHtml).join(', ')}</dd></div>`
    : ''
  const statica = country || security
    ? `<dl class="stats">${country}${security}</dl>`
    : `<p class="muted">${ru ? 'Профиль Statica пока недоступен.' : 'The Statica profile is not available yet.'}</p>`
  const footer = ru ? 'Если вы считаете блокировку ошибочной, обратитесь к оператору узла.' : 'If you believe this is a mistake, contact the node operator.'
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
    :root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101a15;color:#edf7ef;font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;padding:24px}.card{width:min(100%,620px);border:1px solid #496b55;border-radius:28px;background:#18251d;padding:32px;box-shadow:0 24px 70px #0008}.eyebrow{color:#9ed6ad;font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase}.icon{display:grid;place-items:center;width:52px;height:52px;border-radius:16px;background:#c86b61;color:#24100e;font-size:26px;margin-bottom:20px}h1{margin:0;font:500 36px/1.1 Georgia,serif}p{color:#c4d7c8}.panel{margin-top:24px;border:1px solid #4f6e57;border-radius:18px;padding:16px 18px;background:#203126}.panel dt{color:#9fc0a5;font-size:12px;text-transform:uppercase;letter-spacing:.1em}.panel dd{margin:2px 0 12px;font-weight:600}.panel dd:last-child{margin-bottom:0}.reason{margin:14px 0 0;color:#f0d0ca;font-weight:600}.stats{margin:14px 0 0}.muted{margin:14px 0 0;color:#9fb3a3;font-size:14px}.footer{margin:24px 0 0;font-size:14px}@media (prefers-color-scheme:light){body{background:#f0f6f1;color:#183022}.card{background:#fff;border-color:#bfd6c4;box-shadow:0 24px 70px #365a3a22}.panel{background:#f0f8f1;border-color:#bfd6c4}.panel dt{color:#5e8066}.panel dd{color:#183022}p{color:#51705a}.footer{color:#5e8066}}
  </style></head><body><main class="card"><div class="eyebrow">AIKI</div><div class="icon">!</div><h1>${title}</h1><p>${intro}</p><section class="panel"><dl><div><dt>${categoryLabel}</dt><dd>${category}</dd></div></dl>${customReason}${statica}</section><p class="footer">${footer}</p></main></body></html>`
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const from = String(query.from || '/')
  const language = languageFor(event)
  let decision
  try {
    decision = await evaluateAccess(event, { path: from })
  } catch {
    decision = { blocked: true, category: null, reason: null, profile: { country: null, security: null } }
  }
  if (!decision.blocked) return sendRedirect(event, '/', 302)
  setResponseStatus(event, 403)
  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'no-store')
  return renderPage(language, decision)
})
