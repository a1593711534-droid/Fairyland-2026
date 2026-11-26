import { obstacles, rules } from './content.js'

export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const square = dx ** 2 + dz ** 2
  const t = square ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / square)) : 0
  return distance(point, { x: a.x + dx * t, z: a.z + dz * t })
}

const { minX, maxX, minZ, maxZ } = rules.board
export const inBounds = p => Number.isFinite(p?.x) && Number.isFinite(p?.z) &&
  p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ
export const free = (p, blocks) => inBounds(p) && blocks.every(block => distance(p, block) >= block.radius)
export const lineOfSight = (a, b) => obstacles.every(o => distanceToSegment(o, a, b) > o.radius * .87)
const visible = (a, b, blocks) => blocks.every(block => distanceToSegment(block, a, b) > block.radius - .0001)

export function movementBlocks(actors, mover) {
  return [
    ...obstacles.map(o => ({ ...o, radius: o.radius + rules.bodyRadius })),
    ...actors.filter(u => u !== mover && u.hp > 0).map(u => ({ ...u.pos, radius: rules.bodyRadius * 2 })),
  ]
}

// Continuous visibility graph around circular collider offsets, with no tile snapping.
export function router(start, blocks) {
  const points = [start]
  const sides = 12
  for (const block of blocks) {
    for (let i = 0; i < sides; i++) {
      const angle = 2 * Math.PI * i / sides
      const margin = (block.radius + .025) / Math.cos(Math.PI / sides)
      const point = { x: block.x + Math.cos(angle) * margin, z: block.z + Math.sin(angle) * margin }
      if (free(point, blocks)) points.push(point)
    }
  }
  let graph
  return end => {
    if (!free(end, blocks)) return null
    if (visible(start, end, blocks)) return { points: [start, end], cost: distance(start, end) }
    if (!graph) {
      const cost = points.map(() => Infinity)
      const previous = points.map(() => -1)
      const open = new Set(points.keys())
      cost[0] = 0
      while (open.size) {
        let best = -1
        for (const i of open) if (best < 0 || cost[i] < cost[best]) best = i
        if (!Number.isFinite(cost[best])) break
        open.delete(best)
        for (const next of open) {
          const weight = cost[best] + distance(points[best], points[next])
          if (weight >= cost[next] || !visible(points[best], points[next], blocks)) continue
          cost[next] = weight
          previous[next] = best
        }
      }
      graph = { cost, previous }
    }
    let best = -1
    let total = Infinity
    for (let i = 0; i < points.length; i++) {
      const weight = graph.cost[i] + distance(points[i], end)
      if (weight >= total || !visible(points[i], end, blocks)) continue
      best = i
      total = weight
    }
    if (best < 0) return null
    const path = [end]
    while (best >= 0) {
      path.push(points[best])
      best = graph.previous[best]
    }
    return { points: path.reverse(), cost: total }
  }
}

export function travel(path, amount) {
  const points = [path.points[0]]
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1]
    const b = path.points[i]
    const segment = distance(a, b)
    if (segment > amount) {
      points.push({ x: a.x + (b.x - a.x) * amount / segment, z: a.z + (b.z - a.z) * amount / segment })
      break
    }
    points.push(b)
    amount -= segment
  }
  return points
}
