import { sendEmail, emailConfig, emailDeliveryEnabled } from '../../server/utils/email.js'

export async function run({ assert }) {
  assert.deepEqual(emailConfig({}), {
    apiKey: '',
    apiUrl: 'https://api.resend.com/emails',
    from: '',
    replyTo: '',
  })
  assert.equal(emailDeliveryEnabled({}), false)
  assert.equal(emailDeliveryEnabled({ emailApiKey: 're_test', emailFrom: 'AIKI <noreply@example.org>' }), true)

  const requests = []
  const result = await sendEmail({
    to: 'reader@example.org',
    subject: 'New AIKI notification',
    text: 'A new reply is waiting.',
    html: '<p>A new reply is waiting.</p>',
  }, {
    emailApiKey: 're_test',
    emailApiUrl: 'https://mail.example.test/emails',
    emailFrom: 'AIKI <noreply@example.org>',
    emailReplyTo: 'support@example.org',
  }, async (url, options) => {
    requests.push({ url, options })
    return new Response(JSON.stringify({ id: 'email-1' }), { status: 200 })
  })
  assert.deepEqual(result, { sent: true, response: { id: 'email-1' } })
  assert.equal(requests[0].url, 'https://mail.example.test/emails')
  assert.equal(requests[0].options.headers.authorization, 'Bearer re_test')
  assert.equal(JSON.parse(requests[0].options.body).reply_to, 'support@example.org')

  await assert.rejects(
    sendEmail({ to: 'reader@example.org', subject: 'x', text: 'x', html: '<p>x</p>' }, {
      emailApiKey: 're_test', emailFrom: 'AIKI <noreply@example.org>', emailApiUrl: 'https://mail.example.test/emails',
    }, async () => new Response('bad request', { status: 400 })),
    error => error.retryable === false && /HTTP 400/.test(error.message),
  )
}
