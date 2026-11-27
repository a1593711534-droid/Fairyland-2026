import atlas from './continent.json' with { type: 'json' }
import heights from './continent-heights.json' with { type: 'json' }

export const { name: continentName, countries, sites } = atlas
export const continentView = { x: 0, z: -.4, azimuth: .025, elevation: .98, zoom: 76 }

export function atlasGround(x, z) {
  const { minX, minZ, step, width, rows } = heights
  const col = Math.max(0, Math.min(width - 1, (x - minX) / step))
  const row = Math.max(0, Math.min(rows - 1, (z - minZ) / step))
  const c = Math.min(width - 2, Math.floor(col))
  const r = Math.min(rows - 2, Math.floor(row))
  const u = col - c
  const v = row - r
  const values = heights.values
  const top = values[r * width + c] * (1 - u) + values[r * width + c + 1] * u
  const bottom = values[(r + 1) * width + c] * (1 - u) + values[(r + 1) * width + c + 1] * u
  return { x, z, y: (top * (1 - v) + bottom * v) * .01 + .037 }
}

const node = id => sites[id]
export const atlasPoint = id => atlasGround(node(id).x, node(id).z)

const roads = new Map()
for (const [from, to, bends, bridge = 0] of atlas.roads) {
  const route = [[node(from).x, node(from).z], ...bends, [node(to).x, node(to).z]]
  const points = route.flatMap(([x, z], i) => {
    if (i === route.length - 1) return [atlasGround(x, z)]
    const [nextX, nextZ] = route[i + 1]
    const steps = Math.ceil(Math.hypot(nextX - x, nextZ - z) * 2)
    return Array.from({ length: steps }, (_, j) => {
      const t = j / steps
      const point = atlasGround(x + (nextX - x) * t, z + (nextZ - z) * t)
      point.y = Math.max(point.y, bridge + .04)
      return point
    })
  })
  const cost = points.slice(1).reduce((total, p, i) => total + Math.hypot(p.x - points[i].x, p.z - points[i].z), 0)
  if (!roads.has(from)) roads.set(from, [])
  if (!roads.has(to)) roads.set(to, [])
  roads.get(from).push({ to, cost, points })
  roads.get(to).push({ to: from, cost, points: [...points].reverse() })
}

export function atlasRoute(from, to) {
  if (!node(from) || !node(to)) return []
  const links = new Map([[from, { cost: 0, points: [atlasPoint(from)] }]])
  const open = new Set(roads.keys())
  while (open.size) {
    const id = [...open].reduce((best, candidate) => (links.get(candidate)?.cost ?? Infinity) <
      (links.get(best)?.cost ?? Infinity) ? candidate : best)
    const route = links.get(id)
    if (!route) return []
    if (id === to) return route.points
    open.delete(id)
    for (const edge of roads.get(id) ?? []) {
      const cost = route.cost + edge.cost
      if (cost < (links.get(edge.to)?.cost ?? Infinity)) {
        links.set(edge.to, { cost, points: [...route.points, ...edge.points.slice(1)] })
      }
    }
  }
  return []
}
