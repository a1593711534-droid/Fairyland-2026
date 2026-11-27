import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import atlas from '../src/game/continent.json' with { type: 'json' }
import { atlasGround, atlasPoint, atlasRoute, countries, sites } from '../src/game/overworld.js'
import { waypoints } from '../src/game/content.js'

test('the six existing save location IDs all have connected terrain routes', () => {
  assert.deepEqual(Object.keys(sites).sort(), Object.keys(waypoints).sort())
  for (const from of Object.keys(sites)) {
    for (const to of Object.keys(sites)) {
      const route = atlasRoute(from, to)
      assert.deepEqual(route[0], atlasPoint(from))
      assert.deepEqual(route.at(-1), atlasPoint(to))
      assert.ok(route.every(p => p.y > .05), from + ' → ' + to + ' must stay above the water')
    }
  }
})

test('the atlas reserves 72 separate locations above water, with no playable markers', () => {
  const points = countries.flatMap(({ id }) => {
    const spots = atlas.reserves[id]
    assert.equal(spots.length, 12, id)
    return spots
  })
  assert.equal(new Set(points.map(pair => pair.join(','))).size, 72)
  for (const [x,z] of points) {
    assert.ok(atlasGround(x,z).y > .4)
    assert.ok(Object.values(sites).every(p => Math.hypot(x-p.x,z-p.z) > 2))
  }
  assert.ok(atlas.landmarks.filter(spot => spot.kind.endsWith('-cave')).length >= 3)
})

test('the continent is a separate lit terrain mesh with province borders and structures', () => {
  const glb = readFileSync(new URL('../public/art/continent.glb', import.meta.url))
  const root = JSON.parse(glb.toString('utf8',20,20+glb.readUInt32LE(12)))
  const names = root.materials.map(material => material.name)
  for (const name of ['Atlas relief','Atlas sea','Ivory stone','Border ink','Cave depth','Glacial ice','Basalt','Wood']) {
    assert.ok(names.some(item => item === name || item.startsWith(name + ".")), name)
  }
  assert.ok(root.meshes.flatMap(mesh => mesh.primitives).length > 10)
})
