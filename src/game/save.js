import { hero, rules, species } from './content.js'
import { inventory, startingInventory } from './inventory.js'

export const slots = ['auto', '1', '2', '3']
const prefix = 'fairyland-2026.'
export const defaults = { reduced: false, labels: true, batterySaver: false, volume: .45, music: .55 }
const saveVersion = 3

function starterCollection() {
  return Object.entries(species).map(([kind, info]) => ({
    id: 'starter-' + kind, kind, hp: info.hp, xp: 0, level: 1, evolved: false, statuses: {}, inventory: startingInventory(kind), practice: false,
  }))
}

export const newGame = () => ({
  world: 'camp', hero: { kind: 'hero', hp: hero.hp, mana: rules.playerMana, statuses: {}, inventory: startingInventory('hero') },
  collection: starterCollection(), gold: rules.baseGold, cleared: {}, eventsSeen: {}, wins: 0, serial: 1, battle: null,
})

function load(key) {
  try { return JSON.parse(localStorage.getItem(prefix + key)) }
  catch { return null }
}

export function readSlot(slot) {
  const entry = load(slot)
  const s = entry?.game
  if (![1, 2, saveVersion].includes(entry?.version) || !Number.isFinite(entry.at) || !Number.isFinite(s?.hero?.hp) ||
      !Array.isArray(s.collection) || typeof s.world !== 'string') return null
  if (entry.version === 1) s.collection.push(...starterCollection())
  if (entry.version < saveVersion) {
    s.hero.kind = 'hero'
    s.hero.inventory = inventory(s.items > 0 ? ['fruit', 'pebble'] : ['pebble'])
    s.gold = rules.baseGold + Math.max(0, (s.items ?? 0) - 1) * 5
    s.cleared = {}
    s.eventsSeen = {}
    for (const unit of s.collection) unit.inventory ??= startingInventory(unit.kind)
    for (const unit of s.battle?.units ?? []) {
      unit.inventory = unit.kind === 'hero' ? [...s.hero.inventory] :
        [...(s.collection.find(companion => companion.id === unit.id)?.inventory ?? inventory())]
    }
    delete s.items
    entry.version = saveVersion
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
