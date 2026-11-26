import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { elements } from '../src/game/content.js'

const art = new URL('../public/art/', import.meta.url)

test('published meshes retain the UVs for dynamically loaded PBR textures', async () => {
  const required = {
    world: ['Meadow soil', 'Weathered slate', 'Alder bark', 'Faded ochre linen'],
    hero: ['Russet velvet', 'Midnight wool', 'Oiled leather'],
    turtle: ['Coat'],
    'turtle-evolved': ['Coat'],
  }
  for (const [name, materials] of Object.entries(required)) {
    const file = await readFile(new URL(name + '.glb', art))
    const model = JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)))
    const primitives = model.meshes.flatMap(mesh => mesh.primitives)
    for (const material of materials) {
      const withUVs = primitives.some(primitive =>
        model.materials[primitive.material].name.startsWith(material) &&
        primitive.attributes.TEXCOORD_0 !== undefined)
      assert.ok(withUVs, name + ' does not have UVs for ' + material)
    }
  }
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
