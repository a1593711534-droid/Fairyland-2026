import * as T from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { distance } from '../game/geometry.js'
import { trailFX } from './effects.js'
import { EffekseerStage } from './effekseer.js'
import { applySurfaces, fireflies } from './surfaces.js'
import { artURL } from './art-url.js'

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
const library = new Map()
const asset = name => {
  if (!library.has(name)) {
    library.set(name, loader.loadAsync(artURL(name + '.glb')).then(async data => { await applySurfaces(data.scene); return data }).catch(error => {
      library.delete(name)
      throw error
    }))
  }
  return library.get(name)
}

const presets = {
  choose: { x: 0, z: 0, azimuth: .30, elevation: .21, zoom: 3.4 },
  world: { x: .1, z: .4, azimuth: .25, elevation: 1.00, zoom: 17.6 },
  battle: { x: -.2, z: .1, azimuth: .11, elevation: .93, zoom: 14.25 },
  inspect: { x: 0, z: 0, azimuth: .30, elevation: .22, zoom: 2.55 },
}

const cloneUnit = data => ({
  ...data, scene: clone(data.scene),
})

export class Stage {
  constructor(host, callbacks) {
    this.host = host
    this.callbacks = callbacks
    this.scene = new T.Scene()
    this.scene.background = new T.Color('#193133')
    this.scene.fog = new T.FogExp2('#345755', .0165)
    this.camera = new T.OrthographicCamera(-1, 1, 1, -1, .1, 99)
    this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    const gl = this.renderer.getContext()
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    this.software = debug && /swiftshader|llvmpipe|software/i.test(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
    this.renderer.setPixelRatio(this.software ? 1 : Math.min(devicePixelRatio, 1.3))
    this.renderer.shadowMap.enabled = !this.software
    this.renderer.shadowMap.type = T.PCFShadowMap
    this.renderer.toneMapping = T.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.18
    this.effekseer = new EffekseerStage(this.renderer)
    this.canvas = this.renderer.domElement
    this.canvas.setAttribute('aria-label', '3D 場景')
    host.append(this.canvas)

    this.ambient = new T.HemisphereLight('#c4e5f0', '#745e42', 2.18)
    this.scene.add(this.ambient)
    const key = this.key = new T.DirectionalLight('#ffe0ac', 2.64)
    key.position.set(-11, 12, 8)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    Object.assign(key.shadow.camera, { left: -19, right: 19, top: 17, bottom: -17, near: .5, far: 52 })
    key.shadow.normalBias = .034
    this.scene.add(key)
    const rim = this.rim = new T.DirectionalLight('#9dd7ee', 2.45)
    rim.position.set(9, 8, -15)
    this.scene.add(rim)
    this.units = new Map()
    this.actors = new T.Group()
    this.scene.add(this.actors)
    this.cursor = new T.Group()
    this.scene.add(this.cursor)
    this.motes = fireflies(this.scene)
    this.groundShadows = new T.Group()
    this.scene.add(this.groundShadows)
    this.shadows = new T.MeshBasicMaterial({
      map: new T.CanvasTexture(this.shadowTexture()), color: '#0f211b', transparent: true, opacity: .58,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
    })
    this.effects = []
    this.ray = new T.Raycaster()
    this.floor = new T.Plane(new T.Vector3(0, 1, 0), 0)
    this.v = new T.Vector3()
    this.last = performance.now()
    this.resize = new ResizeObserver(() => this.layout())
    this.resize.observe(host)
    this.mapLoaded = asset('world').then(data => {
      this.land = data.scene
      this.scene.add(this.land)
      this.land.visible = ['world', 'battle'].includes(this.mode)
      this.land.traverse(object => {
        if (object.isMesh) object.receiveShadow = true
      })
    }).catch(error => callbacks.error(error))
    this.setMode('menu')
    this.attach()
    requestAnimationFrame(now => this.frame(now))
  }

  setMode(mode) {
    if (mode === this.mode) return
    this.mode = mode
    this.effekseer.clear()
    if (mode === 'battle' || mode === 'inspect') void this.effekseer.warm()
    const landscape = mode === 'world' || mode === 'battle'
    this.motes.visible = landscape
    this.groundShadows.visible = landscape
    this.ambient.intensity = landscape ? 2.18 : 2.55
    this.key.intensity = landscape ? 2.64 : 3.1
    this.rim.intensity = landscape ? 2.45 : 3.2
    for (const tick of this.effects) tick(Infinity)
    this.effects = []
    this.host.hidden = mode === 'menu'
    for (const id of this.units.keys()) this.remove(id)
    this.clearMarks()
    this.clearHover()
    if (this.land) this.land.visible = ['world', 'battle'].includes(mode)
    this.scene.background.set(['choose', 'inspect'].includes(mode) ? '#162823' : '#193133')
    this.view = { ...(presets[mode] ?? presets.world) }
    this.layout()
  }

  layout() {
    this.width = this.host.clientWidth || 1
    this.height = this.host.clientHeight || 1
    this.renderer.setSize(this.width, this.height)
    this.placeCamera()
  }

  placeCamera() {
    const { x, z, azimuth, elevation, zoom } = this.view
    const aspect = this.width / this.height
    const h = zoom / Math.min(1.8, aspect) * 1.64
    this.camera.left = -h * aspect / 2
    this.camera.right = h * aspect / 2
    this.camera.top = h / 2
    this.camera.bottom = -h / 2
    const radius = 33
    this.camera.position.set(x + Math.sin(azimuth) * radius * Math.cos(elevation),
      Math.sin(elevation) * radius, z + Math.cos(azimuth) * radius * Math.cos(elevation))
    this.camera.lookAt(x, this.mode === 'choose' || this.mode === 'inspect' ? 1.15 : 0, z)
    this.camera.updateProjectionMatrix()
    this.camera.updateMatrixWorld()
  }

  shadowTexture() {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    const ctx = canvas.getContext('2d')
    const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 31)
    gradient.addColorStop(0, '#ffffff')
    gradient.addColorStop(.36, '#ffffffab')
    gradient.addColorStop(1, '#ffffff00')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 64, 64)
    return canvas
  }

  bind(id, name, pos, options = {}) {
    const existing = this.units.get(id)
    if (existing) return existing.loading
    const pivot = new T.Group()
    pivot.position.set(pos.x, 0, pos.z)
    pivot.rotation.y = options.angle ?? .35
    pivot.scale.setScalar(options.scale ?? 1)
    pivot.visible = !options.hidden
    const unit = { id, pivot, actions: new Map(), dead: Boolean(options.dead) }
    if (!options.ghost) {
      unit.shadow = new T.Mesh(new T.PlaneGeometry(name === 'hero' ? 1.65 : 1.95, name === 'hero' ? 1.70 : 2.35), this.shadows)
      unit.shadow.visible = !options.hidden
      unit.shadow.rotation.x = -Math.PI / 2
      unit.shadow.position.set(pos.x, .014, pos.z)
      this.groundShadows.add(unit.shadow)
    }
    this.units.set(id, unit)
    this.actors.add(pivot)
    unit.loading = asset(name).then(data => {
      if (this.units.get(id) !== unit) return
      const model = cloneUnit(data)
      model.scene.traverse(obj => {
        if (!obj.isMesh) return
        obj.castShadow = !options.ghost
        obj.receiveShadow = false
        obj.frustumCulled = false
        if (options.tint || options.ghost) {
          obj.material = obj.material.clone()
          obj.material.color.multiply(new T.Color(options.tint ?? '#b8d1ff'))
          if (options.ghost) {
            obj.material.transparent = true
            obj.material.opacity = .42
            obj.material.depthWrite = false
            obj.raycast = () => {}
          }
          obj.userData.ownedMaterial = true
        }
      })
      pivot.add(model.scene)
      unit.mixer = new T.AnimationMixer(model.scene)
      for (const clip of model.animations) unit.actions.set(clip.name, unit.mixer.clipAction(clip))
      this.play(id, unit.dead ? 'death' : 'idle', unit.dead, unit.dead)
    }).catch(error => this.callbacks.error(error))
    return unit.loading
  }

  reveal(id) {
    const unit = this.units.get(id)
    if (unit) {
      unit.pivot.visible = true
      if (unit.shadow) unit.shadow.visible = true
    }
  }

  remove(id) {
    const unit = this.units.get(id)
    if (!unit) return
    unit.travel?.resolve()
    unit.mixer?.stopAllAction()
    unit.pivot.traverse(obj => { if (obj.userData.ownedMaterial) obj.material.dispose() })
    this.actors.remove(unit.pivot)
    if (unit.shadow) {
      this.groundShadows.remove(unit.shadow)
      unit.shadow.geometry.dispose()
    }
    this.units.delete(id)
  }

  play(id, clip, once = true, finish = false) {
    const unit = this.units.get(id)
    const next = unit?.actions.get(clip)
    if (!next || unit.current === next && !once) return
    const previous = unit.current
    next.reset()
    next.enabled = true
    next.setEffectiveWeight(1)
    next.setLoop(once ? T.LoopOnce : T.LoopRepeat, once ? 1 : Infinity)
    next.clampWhenFinished = once
    next.play()
    if (previous && previous !== next) previous.crossFadeTo(next, .13, false)
    if (finish) next.time = next.getClip().duration
    unit.current = next
    unit.returnAt = once && clip !== 'death' && clip !== 'caught' ? performance.now() + next.getClip().duration * 1000 : null
  }

  face(actor, target) {
    const unit = this.units.get(actor)
    if (!unit || !target) return
    const a = unit.pivot.position
    unit.pivot.rotation.y = Math.atan2(target.x - a.x, target.z - a.z)
  }

  move(actor, points, reduced) {
    const unit = this.units.get(actor)
    if (!unit) return Promise.resolve()
    unit.travel?.resolve()
    unit.travel = null
    const cost = points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0)
    if (cost < .001 || reduced) {
      const finish = points.at(-1)
      if (finish) unit.pivot.position.set(finish.x, 0, finish.z)
      this.play(actor, 'idle', false)
      return Promise.resolve()
    }
    this.play(actor, 'walk', false)
    return new Promise(resolve => {
      unit.travel = { points, i: 1, speed: this.mode === 'world' ? 13 : 10, resolve }
    })
  }

  tickTravel(unit, dt) {
    const move = unit.travel
    if (!move) return
    let allowance = dt * move.speed
    while (move.i < move.points.length) {
      const from = unit.pivot.position
      const goal = move.points[move.i]
      const step = distance(from, goal)
      if (step > .001) this.face(unit.id, goal)
      if (step > allowance) {
        from.x += (goal.x - from.x) * allowance / step
        from.z += (goal.z - from.z) * allowance / step
        return
      }
      from.set(goal.x, 0, goal.z)
      allowance -= step
      move.i++
    }
    unit.travel = null
    this.play(unit.id, 'idle', false)
    move.resolve()
  }

  project(pos, height = 0) {
    this.v.set(pos.x, height, pos.z).project(this.camera)
    return { x: (this.v.x + 1) * this.width / 2, y: (1 - this.v.y) * this.height / 2, show: Math.abs(this.v.x) <= 1.05 && Math.abs(this.v.y) <= 1.05 }
  }

  worldPoint(event) {
    const dim = this.canvas.getBoundingClientRect()
    this.ray.setFromCamera({ x: ((event.clientX - dim.left) / dim.width) * 2 - 1,
      y: 1 - (event.clientY - dim.top) / dim.height * 2 }, this.camera)
    const point = this.ray.ray.intersectPlane(this.floor, this.v)
    return point ? { x: point.x, z: point.z } : null
  }

  hit(event) {
    this.worldPoint(event)
    const picked = this.ray.intersectObjects(this.actors.children, true).find(result => result.object.isMesh)
    let obj = picked?.object
    while (obj?.parent && obj.parent !== this.actors) obj = obj.parent
    return obj ? [...this.units.values()].find(u => u.pivot === obj)?.id : null
  }

  attach() {
    this.canvas.addEventListener('contextmenu', event => event.preventDefault())
    this.canvas.addEventListener('pointerdown', event => {
      if (event.button !== 2 && event.button !== 1) return
      this.drag = { x: event.clientX, y: event.clientY, center: event.button === 1 }
      this.canvas.setPointerCapture(event.pointerId)
    })
    this.canvas.addEventListener('pointermove', event => {
      if (this.drag) {
        const dx = event.clientX - this.drag.x
        const dy = event.clientY - this.drag.y
        if (this.drag.center) {
          this.view.x = T.MathUtils.clamp(this.view.x - dx * .023, -17, 17)
          this.view.z = T.MathUtils.clamp(this.view.z - dy * .030, -13, 13)
        } else {
          this.view.azimuth -= dx * .006
          this.view.elevation = T.MathUtils.clamp(this.view.elevation + dy * .006, .2, 1.40)
        }
        Object.assign(this.drag, { x: event.clientX, y: event.clientY })
        this.placeCamera()
        return
      }
      if (this.mode === 'battle') this.pendingPointer = event
    })
    const release = () => { this.drag = null }
    this.canvas.addEventListener('pointerup', release)
    this.canvas.addEventListener('pointercancel', release)
    this.canvas.addEventListener('pointerleave', () => {
      this.pendingPointer = null
      this.clearHover()
      this.callbacks.hover(null)
    })
    this.canvas.addEventListener('click', event => {
      if (this.mode === 'battle') {
        const point = this.worldPoint(event)
        if (point) this.callbacks.click(point, this.hit(event))
      }
    })
    this.canvas.addEventListener('wheel', event => {
      if (!['world', 'battle'].includes(this.mode)) return
      event.preventDefault()
      this.view.zoom = T.MathUtils.clamp(this.view.zoom + event.deltaY * .012, 8.2, 24)
      this.placeCamera()
    }, { passive: false })
  }

  ring(pos, radius, color, opacity = .8, inner = .9) {
    const ring = new T.Mesh(new T.RingGeometry(radius * inner, radius, 64),
      new T.MeshBasicMaterial({ color, side: T.DoubleSide, transparent: true, opacity, depthWrite: false }))
    ring.rotation.x = -Math.PI / 2
    ring.position.set(pos.x, .055, pos.z)
    ring.renderOrder = 2
    return ring
  }

  clear(group) {
    for (const obj of [...group.children]) {
      group.remove(obj)
      obj.geometry?.dispose()
      obj.userData.moveMask?.dispose()
      obj.material?.dispose()
    }
  }

  clearMarks() {
    if (!this.marks) {
      this.marks = new T.Group()
      this.scene.add(this.marks)
    }
    this.clear(this.marks)
  }

  mark(pos, radius, color, area = false) {
    this.marks.add(this.ring(pos, radius, color, area ? .31 : .84, area ? .985 : .85))
  }

  movementArea({ bounds, columns, rows, mask }) {
    const texture = new T.DataTexture(mask, columns, rows, T.RedFormat)
    texture.minFilter = T.LinearFilter
    texture.magFilter = T.LinearFilter
    texture.unpackAlignment = 1
    texture.needsUpdate = true
    const geometry = new T.PlaneGeometry(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ)
    const material = new T.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: {
        field: { value: texture },
        cell: { value: new T.Vector2(1 / columns, 1 / rows) },
      },
      vertexShader: `
        varying vec2 texcoord;
        void main() {
          texcoord = vec2(uv.x, 1.0 - uv.y);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 texcoord;
        uniform sampler2D field;
        uniform vec2 cell;
        float reach(vec2 point) {
          if (min(point.x, point.y) < 0.0 || max(point.x, point.y) > 1.0) return 0.0;
          return texture2D(field, point).r;
        }
        void main() {
          float body = smoothstep(0.38, 0.65, reach(texcoord));
          float inside = min(min(reach(texcoord + vec2(cell.x, 0.0)), reach(texcoord - vec2(cell.x, 0.0))),
                            min(reach(texcoord + vec2(0.0, cell.y)), reach(texcoord - vec2(0.0, cell.y))));
          float edge = body * (1.0 - smoothstep(0.18, 0.88, inside));
          gl_FragColor = vec4(mix(vec3(.24, .66, .56), vec3(.62, .97, .85), edge), body * .19 + edge * .49);
        }
      `,
    })
    const zone = new T.Mesh(geometry, material)
    zone.rotation.x = -Math.PI / 2
    zone.position.set((bounds.minX + bounds.maxX) / 2, .042, (bounds.minZ + bounds.maxZ) / 2)
    zone.renderOrder = 1
    zone.userData.moveMask = texture
    this.marks.add(zone)
  }

  clearHover() {
    this.clear(this.cursor)
  }

  path(destination, segments, marker, radius = .25) {
    this.clearHover()
    this.cursor.add(this.ring(destination, radius, marker, .97, radius > 1 ? .975 : .86))
    for (const { points, color } of segments) {
      if (points.length < 2) continue
      const dots = points.map(p => new T.Vector3(p.x, .068, p.z))
      const line = new T.Line(new T.BufferGeometry().setFromPoints(dots), new T.LineDashedMaterial({
        color, dashSize: .24, gapSize: .065, transparent: true, opacity: .97, depthTest: true,
      }))
      line.computeLineDistances()
      line.renderOrder = 3
      this.cursor.add(line)
    }
  }

  effect(point, element, type, towards, scale = 1) {
    if (this.effekseer.play(type, element, point, towards, scale)) return
    this.effects.push(trailFX(this.scene, point, element, type, towards))
  }

  frame(now) {
    requestAnimationFrame(next => this.frame(next))
    if (now - this.last < (this.software ? 70 : 24)) return
    const dt = Math.min(.12, (now - this.last) / 1000)
    this.last = now
    if (this.host.hidden) return
    if (this.pendingPointer) {
      const pointer = this.pendingPointer
      this.pendingPointer = null
      this.callbacks.hover(this.worldPoint(pointer))
    }
    for (const unit of this.units.values()) {
      unit.mixer?.update(dt)
      this.tickTravel(unit, dt)
      if (unit.shadow) {
        unit.shadow.position.x = unit.pivot.position.x
        unit.shadow.position.z = unit.pivot.position.z
      }
      if (unit.returnAt && now > unit.returnAt) this.play(unit.id, 'idle', false)
    }
    this.effects = this.effects.filter(tick => tick(dt))
    this.callbacks.frame(this)
    this.motes.material.uniforms.time.value = now / 1000
    this.renderer.render(this.scene, this.camera)
    this.effekseer.draw(this.camera, dt)
  }
}
