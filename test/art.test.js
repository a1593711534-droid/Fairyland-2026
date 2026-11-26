import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { elements } from '../src/game/content.js'

const art = new URL('../public/art/', import.meta.url)

async function modelJson(name) {
  const file = await readFile(new URL(name + '.glb', art))
  return JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)))
}

test('published meshes retain the UVs for dynamically loaded PBR textures', async () => {
  const required = {
    world: ['Meadow soil', 'Weathered slate', 'Alder bark', 'Faded ochre linen'],
    hero: ['Russet velvet', 'Midnight wool', 'Oiled leather'],
    turtle: ['Coat'],
    'turtle-evolved': ['Coat'],
  }
  for (const [name, materials] of Object.entries(required)) {
    const model = await modelJson(name)
    const primitives = model.meshes.flatMap(mesh => mesh.primitives)
    for (const material of materials) {
      const withUVs = primitives.some(primitive =>
        model.materials[primitive.material].name.startsWith(material) &&
        primitive.attributes.TEXCOORD_0 !== undefined)
      assert.ok(withUVs, name + ' does not have UVs for ' + material)
    }
  }
})

test('the hero and all creature forms have rigged, vertex-painted inset eyes', async () => {
  const creatures = ['turtle', 'dino', 'cat', 'bird', 'mouse', 'dog']
  const models = ['hero', ...creatures.flatMap(name => [name, name + '-evolved'])]
  for (const name of models) {
    const model = await modelJson(name)
    const eyes = model.meshes.flatMap(mesh => mesh.primitives).filter(primitive =>
      model.materials[primitive.material].name === 'Inset cornea')
    assert.ok(eyes.length > 0, name)
    for (const { attributes } of eyes) {
      assert.ok(attributes.COLOR_0 !== undefined && attributes.JOINTS_0 !== undefined, name)
    }
    assert.ok(model.meshes.some(mesh => mesh.extras?.targetNames?.includes('Blink') &&
      mesh.primitives.some(primitive => primitive.targets?.length)), name + ' has no blink morph')
  }
})

test('physical costume, shell and feather layers survive model export', async () => {
  const distinct = {
    hero: ['Russet velvet', 'Russet velvet lining', 'Midnight wool', 'Oiled leather', 'Struck brass detail'],
    turtle: ['Carapace scutes', 'Carapace lip', 'Carapace plastron'],
    bird: ['Feather coverts', 'Feather primaries', 'Horn beak upper', 'Horn beak lower'],
  }
  for (const [name, materials] of Object.entries(distinct)) {
    const model = await modelJson(name)
    const assigned = model.meshes.flatMap(mesh => mesh.primitives).map(primitive => model.materials[primitive.material].name)
    for (const material of materials) assert.ok(assigned.some(entry => entry.startsWith(material)), name + ': ' + material)
  }
})

test('forest crowns use a UV-mapped atlas with a bounded triangle count', async () => {
  const model = await modelJson('canopy')
  const material = model.materials.findIndex(entry => entry.name === 'Alder foliage atlas')
  const leaves = model.meshes.flatMap(mesh => mesh.primitives).filter(primitive => primitive.material === material)
  assert.ok(leaves.length)
  assert.ok(leaves.every(primitive => primitive.attributes.TEXCOORD_0 !== undefined))
  const triangles = leaves.reduce((sum, primitive) => sum + model.accessors[primitive.indices].count / 3, 0)
  assert.ok(triangles >= 3000 && triangles < 4000, triangles)
  const atlas = await readFile(new URL('surfaces/alder-canopy.webp', art))
  assert.equal(atlas.toString('ascii', 8, 12), 'WEBP')
})

test('published Effekseer effects cover every combination used in battle', async () => {
  for (const element of Object.keys(elements)) {
    for (const kind of ['cast', 'impact', 'summon', 'capture', 'evolve']) {
      const filename = 'fx/' + kind + '-' + element + '.efk'
      const file = await readFile(new URL(filename, art))
      assert.equal(file.toString('ascii', 0, 4), 'SKFE', filename)
    }
  }
})
