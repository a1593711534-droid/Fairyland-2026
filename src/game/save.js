import { hero, rules, species } from './content.js'

export const slots = ['auto', '1', '2', '3']
const prefix = 'fairyland-2026.'
export const defaults = { reduced: false, labels: true, volume: .45 }
const saveVersion = 2

function starterCollection() {
  return Object.entries(species).map(([kind, info]) => ({
    id: 'starter-' + kind, kind, hp: info.hp, xp: 0, level: 1, evolved: false, statuses: {}, practice: false,
  }))
}

export const newGame = () => ({
  world: 'camp', hero: { hp: hero.hp, mana: rules.playerMana, statuses: {} },
  collection: starterCollection(), items: rules.itemCharges, wins: 0, serial: 1, battle: null,
})

function load(key) {
  try { return JSON.parse(localStorage.getItem(prefix + key)) }
  catch { return null }
}

export function readSlot(slot) {
  const entry = load(slot)
  const s = entry?.game
  if (![1, saveVersion].includes(entry?.version) || !Number.isFinite(entry.at) || !Number.isFinite(s?.hero?.hp) ||
      !Array.isArray(s.collection) || typeof s.world !== 'string') return null
  if (entry.version === 1) {
    entry.version = saveVersion
    s.collection.push(...starterCollection())
  }
  return entry
}

export function latest() {
  return slots.map(readSlot).filter(Boolean).sort((a, b) => b.at - a.at)[0] ?? null
}

export function writeSlot(slot, game) {
  try {
    localStorage.setItem(prefix + slot, JSON.stringify({ version: saveVersion, at: Date.now(), game }))
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
