import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Optional build-time tool: pass the module location when using a bundled Sharp.
const require = createRequire(import.meta.url)
const sharp = require(process.argv[2] || 'sharp')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const publicDirectory = path.join(root, 'public')
const background = '#0b1d2a'
const galaxy = await sharp(path.join(publicDirectory, 'aiki-galaxy.png')).trim({ threshold: 5 }).png().toBuffer()

await sharp(galaxy).resize(256, 256, { fit: 'inside' }).webp({ quality: 85, alphaQuality: 100 }).toFile(path.join(publicDirectory, 'aiki-galaxy.webp'))

async function icon(size, ratio = .82, rounded = false) {
  const bound = Math.round(size * ratio)
  const mark = await sharp(galaxy).resize(bound, bound, { fit: 'inside' }).png().toBuffer()
  const image = sharp({ create: { width: size, height: size, channels: 4, background } }).composite([{ input: mark, gravity: 'centre' }])
  const rendered = await image.png().toBuffer()
  if (!rounded) return rendered
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${size * .18}" fill="white"/></svg>`)
  return sharp(rendered).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
}

for (const size of [16, 32, 180, 192, 512]) {
  await writeFile(path.join(publicDirectory, `icon-${size}.png`), await icon(size, size <= 32 ? .92 : .82, size <= 32))
}
await writeFile(path.join(publicDirectory, 'aiki-app-icon.png'), await icon(1024))
// .58 keeps even the rectangle's diagonal inside the central maskable circle.
await writeFile(path.join(publicDirectory, 'icon-512-maskable.png'), await icon(512, .58))

const sizes = [16, 32, 48, 64]
const images = await Promise.all(sizes.map(size => icon(size, .92, true)))
const header = Buffer.alloc(6 + 16 * images.length)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(images.length, 4)
let offset = header.length
images.forEach((image, index) => {
  const entry = 6 + index * 16
  header[entry] = sizes[index]
  header[entry + 1] = sizes[index]
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(image.length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += image.length
})
await writeFile(path.join(publicDirectory, 'favicon.ico'), Buffer.concat([header, ...images]))

console.log('Generated galaxy WebP, app/Apple/PWA icons, maskable icon and 16/32/48/64px ICO.')
