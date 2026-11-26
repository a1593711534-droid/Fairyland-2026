import { hero, rules } from './content.js'

export const slots = ['auto', '1', '2', '3']
const prefix = 'fairyland-2026.'
export const defaults = { reduced: false, labels: true, volume: .45 }
export const newGame = () => ({
  world: 'camp', hero: { hp: hero.hp, mana: rules.playerMana, statuses: {} },
  collection: [], items: rules.itemCharges, wins: 0, serial: 1, battle: null,
})

function load(key) {
  try { return JSON.parse(localStorage.getItem(prefix + key)) }
  catch { return null }
}

export function readSlot(slot) {
  const entry = load(slot)
  const s = entry?.game
  return entry?.version === 1 && typeof entry.at === 'number' && Number.isFinite(s?.hero?.hp) &&
    Array.isArray(s.collection) && typeof s.world === 'string' ? entry : null
}

export function latest() {
  return slots.map(readSlot).filter(Boolean).sort((a, b) => b.at - a.at)[0] ?? null
}

export function writeSlot(slot, game) {
  try {
    localStorage.setItem(prefix + slot, JSON.stringify({ version: 1, at: Date.now(), game }))
    return true
  } catch { return false }
}

export const readSettings = () => ({ ...defaults, ...load('settings') })
export function writeSettings(settings) {
  try {
    localStorage.setItem(prefix + 'settings', JSON.stringify(settings))
    return true
  } catch { return false }
}
