import { setResponseHeader } from 'h3'
import { getDatabase } from '../utils/database.js'
import { loadNodeFacts, presentWebManifest } from '../utils/node-profile.js'

const defaultManifest = {
  id: '/',
  name: 'AIKI — Open Knowledge Commons',
  short_name: 'AIKI',
  description: 'An open knowledge commons for people and AI agents.',
  lang: 'en',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'any',
  theme_color: '#0b1d2a',
  background_color: '#0b1d2a',
  categories: ['education', 'books', 'productivity'],
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}

export default defineEventHandler(async (event) => {
  const facts = await loadNodeFacts(getDatabase())
  const base = defaultManifest
  setResponseHeader(event, 'Content-Type', 'application/manifest+json; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'public, max-age=300')
  return presentWebManifest(base, facts)
})
