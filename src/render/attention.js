import { distance, lineOfSight } from '../game/geometry.js'
import { areOpponents } from '../game/combat.js'

export const TURN_ANGLE = Math.PI / 3
export const bearing = (a, b) => Math.atan2(b.x - a.x, b.z - a.z)
export const angularDifference = (current, target) => Math.atan2(Math.sin(target - current), Math.cos(target - current))
export const advanceBearing = (current, target, max) => current + Math.max(-max, Math.min(max, angularDifference(current, target)))

function ease(start, end, progress) {
  const u = Math.max(0, Math.min(1, (progress - start) / (end - start)))
  return u * u * (3 - 2 * u)
}

// Matches the two planted-foot phases in tools/idle_behaviors.py.
export const turnProgress = progress => .48 * ease(.17, .48, progress) + .52 * ease(.54, .93, progress)

export function nearbyInterest(origin, candidates, maxDistance = 7.5) {
  return candidates.filter(({ pos }) => {
    const away = distance(origin, pos)
    return away > .23 && away < maxDistance && lineOfSight(origin, pos)
  }).sort((a, b) => distance(origin, a.pos) - distance(origin, b.pos))
}

export function initialBearing(unit, candidates) {
  const others = candidates.filter(other => other.id !== unit.id && !other.dismissed && other.hp > 0)
  const seen = nearbyInterest(unit.pos, others, 40)
  const toward = seen.find(other => areOpponents(unit, other)) ?? seen[0]
  return toward ? bearing(unit.pos, toward.pos) : bearing(unit.pos, { x: .1, z: 0 })
}

export function observedPoint(observer, candidates, sample) {
  const seen = nearbyInterest(observer.pos, candidates)
  if (!seen.length || sample >= .76) return null
  const index = Math.floor((sample / .76) ** 2 * Math.min(3, seen.length))
  const at = seen[index]
  return { pos: at.pos, mood: at.team === observer.team ? 'social' : 'watch' }
}
