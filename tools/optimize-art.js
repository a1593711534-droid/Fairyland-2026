import { readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const input = fileURLToPath(new URL('../.art-cache/', import.meta.url))
const output = fileURLToPath(new URL('../public/art/', import.meta.url))
const gltfpack = fileURLToPath(new URL('../node_modules/gltfpack/cli.js', import.meta.url))
for (const file of readdirSync(input).filter(name => name.endsWith('.glb'))) {
  if (process.argv.length > 2 && !process.argv.slice(2).includes(file)) continue
  const ratio = file === 'world.glb' ? '0.36' : ['canopy.glb', 'continent.glb'].includes(file) ? '1.0' : '0.72'
  const simplify = file === 'world.glb' ? ['-sa'] : []
  // Three.js binds separate tileable textures by material name after loading these meshes.
  execFileSync(process.execPath, [gltfpack, '-i', input + file, '-o', output + file,
    '-cc', '-km', '-kv', '-vtf', '-si', ratio, '-se', '0.014', '-vp', '14', '-af', '15', ...simplify], { stdio: 'inherit' })
}
