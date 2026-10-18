import sharp from 'sharp'
import { encodePicture, imageAttachments, loadMedia, presentMedia, stripAttachmentLinks } from '../../server/utils/federation-media.js'

const OBJECT_ID = '00000000-0000-4000-8000-000000000101'
// An IP host skips DNS in assertPublicRemoteOrigin, so the test stays offline.
const PNG_URL = 'https://93.184.216.34/media/original/a.png'

export async function run({ assert }) {
  const raw = {
    attachments: [
      { url: PNG_URL, type: 'image', description: '' },
      { url: 'https://93.184.216.34/media/clip.mp4', type: 'video', description: 'clip' },
      { url: 'http://93.184.216.34/insecure.png', type: 'image' },
    ],
  }
  assert.deepEqual(imageAttachments(raw).map(item => item.position), [0])
  assert.deepEqual(imageAttachments({ attachment: [{ type: 'Document', mediaType: 'image/jpeg', url: PNG_URL, name: 'cat' }] }).map(item => item.description), ['cat'])
  assert.deepEqual(presentMedia(OBJECT_ID, raw), [{ url: `/api/federation-media/${OBJECT_ID}/0`, description: '' }])
  assert.equal(
    stripAttachmentLinks(`@someone\n\n- [image](${PNG_URL})\n- [clip](https://93.184.216.34/media/clip.mp4)`, raw),
    '@someone\n\n- [clip](https://93.184.216.34/media/clip.mp4)',
  )

  const png = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#2a6' } }).png().toBuffer()
  const encoded = await encodePicture(png)
  assert.equal(encoded.mediaType, 'image/webp')
  assert.equal(encoded.width, 1600)

  const queries = []
  const database = {
    async query(sql, params) {
      queries.push(sql)
      if (/FROM federation_objects/.test(sql)) return { rows: params[0] === OBJECT_ID ? [{ id: OBJECT_ID, raw_object: raw }] : [] }
      if (/FROM federation_media_cache/.test(sql)) return { rows: [] }
      return { rows: [] }
    },
  }
  const fetched = []
  const fetchImpl = async (url) => {
    fetched.push(url)
    return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } })
  }
  const media = await loadMedia(database, OBJECT_ID, 0, { fetchImpl })
  assert.equal(media.media_type, 'image/webp')
  assert.deepEqual(fetched, [PNG_URL])
  assert.ok(queries.some(sql => /INSERT INTO federation_media_cache/.test(sql) && /'ready'/.test(sql)))
  // Only stored image attachments can be fetched: not a video, not another object.
  assert.equal(await loadMedia(database, OBJECT_ID, 1, { fetchImpl }), null)
  assert.equal(await loadMedia(database, '00000000-0000-4000-8000-000000000999', 0, { fetchImpl }), null)
  assert.equal(fetched.length, 1)
}
