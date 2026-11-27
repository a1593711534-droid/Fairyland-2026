import { encounters, encounterTuning, rules, species, waypoints } from './content.js'
import { free, movementBlocks } from './geometry.js'
import { placeItem } from './inventory.js'

export const isStory = node => ['main', 'side'].includes(node?.type)
export const requiresBattle = (game, key) => isStory(waypoints[key]) && !game.cleared?.[key]

export function random(state) {
  let n = state.seed >>> 0 || 1
  n ^= n << 13
  n ^= n >>> 17
  n ^= n << 5
  state.seed = n >>> 0 || 1
  return state.seed / 4294967296
}

export function encounterAt(game, key, seed) {
  const node = waypoints[key]
  const revisit = isStory(node) && !requiresBattle(game, key)
  const base = encounters[revisit ? node.revisit : node?.layout]
  if (!base) return null
  const layout = { seed }
  const occupied = [{ x: -8.5, z: -.1, radius: rules.bodyRadius * 2 }]
  const roster = Object.keys(species)
  const units = base.map(([kind, x, z, team], i) => {
    const alternatives = [...Array(7)].map(() => ({
      x: x + (random(layout) * 2 - 1) * encounterTuning.jitter,
      z: z + (random(layout) * 2 - 1) * encounterTuning.jitter,
    }))
    const blocks = [...movementBlocks([], null), ...occupied]
    const point = alternatives.find(p => free(p, blocks)) ?? { x, z }
    occupied.push({ ...point, radius: rules.bodyRadius * 2 })
    const variation = revisit && i === base.length - 1 ? roster[Math.floor(random(layout) * roster.length)] : kind
    return [variation, point.x, point.z, team]
  })
  return { units, reward: revisit ? encounterTuning.revisitReward : node.reward }
}

export function chooseEvent(game, key, choice) {
  const event = waypoints[key]?.event
  if (!event || game.eventsSeen[key]) return '這個地點已探索。'
  if (choice === 'item') {
    const problem = placeItem(game.hero, event.item)
    if (problem) return problem
  } else if (choice === 'gold') game.gold += event.gold
  else return '請選擇一項收穫。'
  game.eventsSeen[key] = choice
  return null
}
