import { elements } from '../game/content.js'
import { artURL } from './art-url.js'

const kinds = ['cast', 'impact', 'summon', 'capture', 'evolve']
let boot

async function startRuntime() {
  const script = new Promise((resolve, reject) => {
    const tag = document.createElement('script')
    tag.src = artURL('fx/effekseer.min.js')
    tag.onload = resolve
    tag.onerror = reject
    document.head.append(tag)
  })
  const wasm = fetch(artURL('fx/effekseer.wasm.gz')).then(async response => {
    if (!response.ok || !response.body) throw Error('Effekseer WASM is unavailable')
    const data = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    return URL.createObjectURL(new Blob([data], { type: 'application/wasm' }))
  })
  const [, url] = await Promise.all([script, wasm])
  try {
    await new Promise((resolve, reject) => globalThis.effekseer.initRuntime(url, resolve, reject))
    return globalThis.effekseer
  } finally { URL.revokeObjectURL(url) }
}

export class EffekseerStage {
  constructor(renderer) {
    this.renderer = renderer
    this.effects = new Map()
    this.moving = []
    this.elapsed = 0
  }

  async warm() {
    if (this.loading) return this.loading
    boot ??= startRuntime()
    this.loading = boot.then(runtime => {
      this.context = runtime.createContext()
      this.context.init(this.renderer.getContext(), { instanceMaxCount: 1600 })
      this.context.setRestorationOfStatesFlag(false)
      this.renderer.resetState()
      return Promise.allSettled(Object.keys(elements).flatMap(element =>
        kinds.map(kind => this.load(kind, element))))
    }).catch(() => null)
    return this.loading
  }

  load(kind, element) {
    const key = kind + '-' + element
    if (!this.effects.has(key)) {
      const entry = { asset: null }
      this.effects.set(key, entry)
      entry.wait = new Promise((resolve, reject) => {
        const asset = this.context.loadEffect(artURL('fx/' + key + '.efk'), 1,
          () => { entry.asset = asset; resolve(asset) }, (_, path) => reject(Error(path || key)))
      })
    }
    return this.effects.get(key).wait
  }

  play(kind, element, origin, destination, size = 1) {
    const file = kind === 'area' ? 'impact' : kind
    const asset = this.effects.get(file + '-' + element)?.asset
    if (!asset || !this.context) return false
    const height = kind === 'cast' ? .88 : kind === 'impact' ? .32 : .025
    const handle = this.context.play(asset, origin.x, height, origin.z)
    if (!handle) return false
    handle.setScale(size, size, size)
    if (destination) this.moving.push({ handle, origin: { ...origin }, destination: { ...destination }, elapsed: 0 })
    this.elapsed = Math.max(this.elapsed, 2.25)
    return true
  }

  draw(camera, dt) {
    if (!this.context || this.elapsed <= 0) return
    this.elapsed -= dt
    this.moving = this.moving.filter(state => {
      state.elapsed += dt
      const t = Math.min(1, state.elapsed / .33)
      const { origin, destination } = state
      state.handle.setLocation(origin.x + (destination.x - origin.x) * t, .85 + Math.sin(Math.PI * t) * .78,
        origin.z + (destination.z - origin.z) * t)
      return t < 1
    })
    this.context.update(Math.min(6, dt * 60))
    this.context.setProjectionMatrix(camera.projectionMatrix.elements)
    this.context.setCameraMatrix(camera.matrixWorldInverse.elements)
    this.context.draw()
    this.renderer.resetState()
  }

  clear() {
    this.context?.stopAll()
    this.moving = []
    this.elapsed = 0
  }
}
