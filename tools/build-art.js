import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { obstacles, waypoints } from '../src/game/content.js'

const cache = new URL('../.art-cache/', import.meta.url)
mkdirSync(cache, { recursive: true })
writeFileSync(new URL('layout.json', cache), JSON.stringify({ obstacles, waypoints }))

const filter = process.argv.slice(2)
const modelNames = filter.flatMap(name => {
  if (name === 'world') return ['world', 'canopy']
  return name === 'hero' ? [name] : [name, name + '-evolved']
})
const cwd = fileURLToPath(new URL('..', import.meta.url))
const options = { cwd, stdio: 'inherit' }
execFileSync('blender', ['-b', '-t', '2', '--python-exit-code', '1', '--python', 'tools/sculpt.py',
  '--', ...filter], options)
execFileSync(process.execPath, ['tools/optimize-art.js', ...modelNames.map(name => name + '.glb')], options)
