export const DEFAULT_ACCENT_LIGHT = '#3d5c4e'
export const DEFAULT_ACCENT_DARK = '#8aa899'
const INK_DARK = '#14201a'
const INK_LIGHT = '#f4f7f5'

export function normalizeAccent(value) {
  const hex = String(value || '').trim().toLowerCase()
  return /^#[0-9a-f]{6}$/.test(hex) ? hex : null
}

export function resolveAccent(value, fallback) {
  return normalizeAccent(value) || fallback
}

function channels(hex) {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function linear(channel) {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(hex) {
  const [red, green, blue] = channels(hex)
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
}

function contrast(background, foreground) {
  const lighter = Math.max(relativeLuminance(background), relativeLuminance(foreground))
  const darker = Math.min(relativeLuminance(background), relativeLuminance(foreground))
  return (lighter + 0.05) / (darker + 0.05)
}

export function accentInk(hex) {
  return contrast(hex, INK_DARK) >= contrast(hex, INK_LIGHT) ? INK_DARK : INK_LIGHT
}

function mix(hex, toward, amount) {
  const [r1, g1, b1] = channels(hex)
  const [r2, g2, b2] = channels(toward)
  const channel = (from, to) => Math.round(from + (to - from) * amount).toString(16).padStart(2, '0')
  return `#${channel(r1, r2)}${channel(g1, g2)}${channel(b1, b2)}`
}

export function accentHover(hex) {
  const ink = accentInk(hex)
  return mix(hex, ink === INK_DARK ? '#ffffff' : '#000000', 0.16)
}

export function accentDeclaration({ light, dark } = {}) {
  const chosen = {
    light: resolveAccent(light, DEFAULT_ACCENT_LIGHT),
    dark: resolveAccent(dark, DEFAULT_ACCENT_DARK),
  }
  return Object.entries(chosen).flatMap(([name, color]) => [
    `--aiki-accent-${name}:${color}`,
    `--aiki-accent-${name}-ink:${accentInk(color)}`,
    `--aiki-accent-${name}-hover:${accentHover(color)}`,
  ]).join(';')
}
