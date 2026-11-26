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
  return (end, limit = Infinity) => {
    if (!end) return null
    const direct = distance(start, end)
    if (direct > limit || !free(end, blocks)) return null
    if (visible(start, end, blocks)) return { points: [start, end], cost: direct }
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
    let total = limit
    for (let i = 0; i < points.length; i++) {
      const weight = graph.cost[i] + distance(points[i], end)
      if (weight > total || (weight === total && best >= 0) || !visible(points[i], end, blocks)) continue
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

// Sample the same continuous routes used by move validation for a ground overlay.
export function movementMask(start, budget, routeTo, spacing = .14) {
  const bounds = {
    minX: Math.max(minX, start.x - budget - spacing),
    maxX: Math.min(maxX, start.x + budget + spacing),
    minZ: Math.max(minZ, start.z - budget - spacing),
    maxZ: Math.min(maxZ, start.z + budget + spacing),
  }
  const w = bounds.maxX - bounds.minX
  const h = bounds.maxZ - bounds.minZ
  const columns = Math.ceil(w / spacing)
  const rows = Math.ceil(h / spacing)
  const mask = new Uint8Array(columns * rows)
  for (let row = 0; row < rows; row++) {
    const z = bounds.minZ + (row + .5) * h / rows
    for (let column = 0; column < columns; column++) {
      const x = bounds.minX + (column + .5) * w / columns
      if (routeTo({ x, z }, budget)) mask[row * columns + column] = 255
    }
  }
  return { bounds, columns, rows, mask }
}
