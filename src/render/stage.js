import * as T from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { distance, lineOfSight } from '../game/geometry.js'
import { elementalEffect } from './elemental-effects.js'
import { idleSequence } from './idle-sequence.js'
import { advanceBearing, angularDifference, bearing, observedPoint, TURN_ANGLE, turnProgress } from './attention.js'
import { Vigilance } from './vigilance.js'
import { applySurfaces, fireflies, surfaceTime } from './surfaces.js'
import { artURL } from './art-url.js'
import { fireSummon, warmFire } from './fire-summon.js'
import { attachTouchControls } from './touch-controls.js'

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

const turnAxis = new T.Vector3(0, 1, 0)
const headRotation = new T.Quaternion()

function portraitFloor() {
  const floor = new T.Mesh(new T.PlaneGeometry(9.2, 9.2), new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 spot;
      void main() {
        spot = (uv-.5)*2.;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 spot;
      void main() {
        float r = dot(spot,spot);
        float light = exp(-r*3.6)*(1.-smoothstep(.20,.96,r));
        vec3 tint = mix(vec3(.081,.161,.170),vec3(.147,.179,.158),1.-abs(spot.x)*.6);
        gl_FragColor = vec4(tint,light*.57);
        #include <colorspace_fragment>
      }
    `,
  }))
  floor.rotation.x = -Math.PI / 2
  floor.position.set(.78,.006,0)
  floor.renderOrder = -1
  return floor
}

export class Stage {
  constructor(host, callbacks) {
    this.host = host
    this.callbacks = callbacks
    this.scene = new T.Scene()
    this.scene.background = new T.Color('#193133')
    this.forestFog = new T.FogExp2('#345755', .0165)
    this.studio = portraitFloor()
    this.scene.add(this.studio)
    this.camera = new T.OrthographicCamera(-1, 1, 1, -1, .1, 99)
    this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    const gl = this.renderer.getContext()
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    this.software = debug && /swiftshader|llvmpipe|software/i.test(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
    this.touchLayout = matchMedia('(any-pointer: coarse)')
    this.performanceScale = 1
    this.frameLoad = 0
    this.frameSample = 0
    this.renderer.shadowMap.enabled = !this.software
    this.renderer.shadowMap.type = T.PCFShadowMap
    this.renderer.toneMapping = T.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.18
    this.canvas = this.renderer.domElement
    this.canvas.setAttribute('aria-label', '3D 場景')
    this.canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault()
      this.contextLost = true
    })
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false
      this.last = performance.now()
      this.layout()
    })
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
    this.magicLights = Array.from({ length: 2 }, () => new T.PointLight('#ff741d', 0, 6.3, 1.75))
    this.scene.add(...this.magicLights)
    this.units = new Map()
    this.reduced = false
    this.visualSeed = Math.floor(Math.random() * 2 ** 32)
    this.clock = 0
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
    document.addEventListener('visibilitychange', () => { this.last = performance.now() })
    this.resize = new ResizeObserver(() => this.layout())
    this.resize.observe(host)
    this.mapLoaded = asset('world').then(data => {
      this.land = data.scene
      this.scene.add(this.land)
      this.land.visible = ['world', 'battle'].includes(this.mode)
      this.land.traverse(object => {
        if (!object.isMesh) return
        object.receiveShadow = true
        object.castShadow = /^(Weathered slate|Alder bark|Silver birch bark|Oil-rubbed rowan)/.test(object.material.name)
      })
    }).catch(error => callbacks.error(error))
    void Promise.all([this.mapLoaded, asset('canopy')]).then(([, data]) => {
      this.land?.add(data.scene)
    }).catch(error => callbacks.error(error))
    this.setMode('menu')
    this.attach()
    requestAnimationFrame(now => this.frame(now))
  }

  setMode(mode) {
    if (mode === this.mode) return
    this.mode = mode
    this.touch?.reset()
    if ((mode === 'world' || mode === 'battle') && !this.fireWarm) {
      this.fireWarm = true
      const idle = globalThis.requestIdleCallback ?? globalThis.requestAnimationFrame
      idle(() => {
        this.fireWarm = warmFire(this.renderer, this.scene, this.camera).catch(() => {})
      })
    }
    const landscape = mode === 'world' || mode === 'battle'
    this.scene.fog = landscape ? this.forestFog : null
    this.studio.visible = mode === 'choose' || mode === 'inspect'
    this.motes.visible = landscape
    this.groundShadows.visible = mode !== 'menu'
    this.ambient.intensity = landscape ? 2.18 : 1.95
    this.key.intensity = landscape ? 2.64 : 3.48
    this.rim.intensity = landscape ? 2.45 : 2.82
    for (const tick of this.effects) tick(Infinity)
    this.effects = []
    this.host.hidden = mode === 'menu'
    for (const id of this.units.keys()) this.remove(id)
    this.clearMarks()
    this.clearHover()
    if (this.land) this.land.visible = ['world', 'battle'].includes(mode)
    this.scene.background.set(['choose', 'inspect'].includes(mode) ? '#162823' : '#193133')
    this.resetCamera()
    this.layout()
  }

  layout() {
    const width = this.host.clientWidth || 1
    const height = this.host.clientHeight || 1
    const resized = width !== this.width || height !== this.height
    this.width = width
    this.height = height
    this.offset = { x: this.host.offsetLeft, y: this.host.offsetTop }
    const ratio = this.pixelRatio()
    if (ratio !== this.renderer.getPixelRatio()) this.renderer.setPixelRatio(ratio)
    if (resized) this.renderer.setSize(width, height, false)
    this.placeCamera()
  }

  pixelRatio() {
    if (this.software) return 1
    if (this.batterySaver) return Math.min(devicePixelRatio, 1)
    if (!this.touchLayout.matches) return Math.min(devicePixelRatio, 1.3)
    const limit = Math.sqrt(1_650_000 / (this.width * this.height))
    return Math.min(devicePixelRatio, Math.max(.82, Math.min(1.5, limit) * this.performanceScale))
  }

  setBatterySaver(active) {
    if (this.batterySaver === active) return
    this.batterySaver = active
    this.performanceScale = 1
    this.frameLoad = this.frameSample = 0
    this.layout()
  }

  resetCamera() {
    this.view = { ...(presets[this.mode] ?? presets.world) }
    if (this.touchLayout.matches) {
      if (['choose', 'inspect'].includes(this.mode)) this.view.x = .78
      if (this.mode === 'battle') this.view.zoom = 18
    }
    if (this.width && this.height) this.placeCamera()
  }

  zoomCamera(ratio) {
    const portrait = ['choose', 'inspect'].includes(this.mode)
    this.view.zoom = T.MathUtils.clamp(this.view.zoom * ratio, portrait ? 1.8 : 8.2, portrait ? 5.8 : 26)
    this.placeCamera()
  }

  panCamera(previous, current, anchor = this.worldPoint(previous)) {
    const target = this.worldPoint(current)
    if (!anchor || !target) return
    this.view.x = T.MathUtils.clamp(this.view.x + anchor.x - target.x, -16, 16)
    this.view.z = T.MathUtils.clamp(this.view.z + anchor.z - target.z, -12, 12)
    this.placeCamera()
  }

  placeCamera() {
    const { x, z, azimuth, elevation, zoom } = this.view
    const aspect = this.width / this.height
    const h = zoom / Math.min(1.8, aspect) * 1.64
    const portrait = ['choose', 'inspect'].includes(this.mode)
    const staged = this.touchLayout.matches && portrait
    const horizontal = staged && aspect >= 1 ? -h * aspect * .19 : 0
    const vertical = staged && aspect < 1 ? -h * .13 : 0
    this.camera.left = -h * aspect / 2 + horizontal
    this.camera.right = h * aspect / 2 + horizontal
    this.camera.top = h / 2 + vertical
    this.camera.bottom = -h / 2 + vertical
    const radius = 33
    this.camera.position.set(x + Math.sin(azimuth) * radius * Math.cos(elevation),
      Math.sin(elevation) * radius, z + Math.cos(azimuth) * radius * Math.cos(elevation))
    this.camera.lookAt(x, portrait ? 1.15 : 0, z)
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
    if (existing) {
      if (options.team !== undefined && existing.team !== options.team) {
        existing.team = options.team
        existing.focusAt = 0
      }
      if (options.dead !== undefined) existing.dead = options.dead
      return existing.loading
    }
    const pivot = new T.Group()
    pivot.position.set(pos.x, 0, pos.z)
    pivot.rotation.y = options.angle ?? .35
    pivot.scale.setScalar(options.scale ?? 1)
    pivot.visible = !options.hidden
    const portrait = this.mode === 'choose' || this.mode === 'inspect'
    const idle = !options.ghost && idleSequence(name, id, portrait, this.visualSeed + Math.floor(this.clock * 1000))
    const unit = { id, pivot, actions: new Map(), dead: Boolean(options.dead), idle, portrait, team: options.team,
      idleIn: idle?.firstDelay, idlePause: idle?.firstDelay, ghost: Boolean(options.ghost), gaze: 0,
      nextLook: this.clock + (idle?.firstDelay ?? 2) * .64, headBase: new T.Quaternion(),
      bodyBase: new T.Quaternion(), shoulder: 0, lids: [],
      blinkAt: this.clock + (idle?.firstDelay ?? 2) * .92 }
    if (idle && this.mode === 'battle') unit.vigilance = new Vigilance(name, idle.sample)
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
        const blink = obj.morphTargetDictionary?.Blink
        if (blink !== undefined && !unit.ghost) unit.lids.push([obj, blink])
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
      unit.head = model.scene.getObjectByName('Head')
      unit.body = model.scene.getObjectByName('Body')
      unit.mixer = new T.AnimationMixer(model.scene)
      for (const clip of model.animations) unit.actions.set(clip.name, unit.mixer.clipAction(clip))
      if (!unit.ghost) this.play(id, unit.dead ? 'death' : 'idle', unit.dead, unit.dead)
    }).catch(error => this.callbacks.error(error))
    return unit.loading
  }

  reveal(id) {
    const unit = this.units.get(id)
    if (unit) {
      unit.pivot.visible = true
      if (unit.shadow) unit.shadow.visible = true
      if (unit.vigilance) {
        unit.focusAt = 0
        this.updateFocus(unit)
      }
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

  play(id, clip, once = true, finish = false, speed = 1) {
    const unit = this.units.get(id)
    const next = unit?.actions.get(clip)
    if (!next || unit.current === next && !once) return
    const previous = unit.current
    next.reset()
    next.enabled = true
    next.setEffectiveWeight(1)
    next.setEffectiveTimeScale(speed)
    next.setLoop(once ? T.LoopOnce : T.LoopRepeat, once ? 1 : Infinity)
    next.clampWhenFinished = once
    next.play()
    if (previous && previous !== next) {
      if (this.reduced && clip === 'idle') {
        previous.stop()
        unit.mixer.update(0)
      } else previous.crossFadeTo(next, clip.startsWith('idle') && unit.currentName.startsWith('idle') ? .18 : .12, false)
    }
    if (finish) next.time = next.getClip().duration
    unit.current = next
    unit.currentName = clip
    unit.returnToRest = once && clip !== 'death' && clip !== 'caught'
    if (!clip.startsWith('turn_')) unit.stepTurn = null
    if (clip === 'death' || clip === 'caught') {
      unit.notice = null
      unit.headingGoal = null
    }
    if (clip === 'hit') unit.blinkAt = this.clock
    if (clip === 'idle') unit.idleIn = unit.idlePause
    if (!clip.startsWith('idle') && !clip.startsWith('turn_')) {
      unit.idlePause = unit.idle?.firstDelay
      unit.notice = null
    }
  }

  lookAround(unit) {
    const { idle, pivot, portrait } = unit
    const jitter = (idle.sample() - .5) * 2
    let pos, mood = 'rest'
    if (portrait) {
      const camera = this.camera.position
      const heading = bearing(pivot.position, camera) + jitter * 1.16
      pos = { x: pivot.position.x + Math.sin(heading), z: pivot.position.z + Math.cos(heading) }
    } else {
      const candidates = Array.from(this.units.values())
        .filter(other => other.id !== unit.id && !other.dead && !other.ghost && other.pivot.visible)
        .map(other => ({ pos: other.pivot.position, team: other.team }))
      const observed = observedPoint({ pos: pivot.position, team: unit.team }, candidates, idle.sample())
      if (observed) ({ pos, mood } = observed)
      else {
        // Glance toward a nearby patch of ground independently of the last facing.
        const direction = bearing(pivot.position, { x: .25, z: -.63 }) + jitter * 1.64
        pos = { x: pivot.position.x + Math.sin(direction) * 3, z: pivot.position.z + Math.cos(direction) * 3 }
      }
    }
    this.notice(unit, pos, mood, false)
    unit.nextLook = this.clock + 3.1 + idle.sample() * 4.7
  }

  notice(unit, point, mood, urgent) {
    const delay = unit.idle.glanceDelay()
    const start = this.clock + delay
    unit.notice = { point, mood, urgent, start, stepAt: start + .32 + unit.idle.sample() * .26,
      end: start + 1.45 + unit.idle.sample() * 1.6, steps: urgent ? 3 : unit.idle.sample() < .61 ? 1 : 0 }
    if (urgent && unit.currentName === 'idle') unit.idleIn = Math.min(unit.idleIn, delay + 1.24)
  }

  signal(point, source, mood = 'alert', radius = 6.2) {
    if (this.mode !== 'battle' || this.reduced || !point) return
    const instigator = this.units.get(source)
    const where = { x: point.x, z: point.z }
    for (const unit of this.units.values()) {
      if (unit.id === source || !unit.idle || unit.focus || unit.dead || !unit.pivot.visible || !unit.currentName) continue
      const away = distance(unit.pivot.position, where)
      if (away > radius || away < .16 || !lineOfSight(unit.pivot.position, where)) continue
      const ally = unit.team === instigator?.team && unit.team === 'ally'
      const urgent = !ally && (away < 3.3 || mood === 'alert')
      if (unit.notice?.urgent && !urgent && this.clock < unit.notice.end) continue
      if (unit.notice?.urgent && urgent && this.clock < unit.notice.end &&
          distance(unit.notice.point, unit.pivot.position) + .6 < away) continue
      this.notice(unit, where, ally || mood === 'arrival' ? 'social' : urgent ? 'alert' : 'watch', urgent)
      unit.nextLook = Math.max(unit.nextLook, this.clock + 3.4)
    }
  }

  attacked(id, attacker) {
    const unit = this.units.get(id)
    if (!unit?.vigilance) return
    unit.vigilance.attacked(unit, this.units.get(attacker), this.clock)
    unit.focusAt = 0
  }

  updateFocus(unit) {
    if (!unit.vigilance) return
    if (this.reduced) {
      unit.focus = null
      return
    }
    if (this.clock < (unit.focusAt ?? 0)) return
    unit.focusAt = this.clock + .108
    unit.focus = unit.vigilance.update(unit, this.units, this.clock)
  }

  updateFacing(unit, dt) {
    const current = unit.currentName
    const turning = unit.stepTurn
    if (turning && current.startsWith('turn_')) {
      const progress = turnProgress(unit.current.time / unit.current.getClip().duration)
      unit.pivot.rotation.y = turning.started + turning.angle * progress
    } else if (unit.headingGoal !== null && unit.headingGoal !== undefined) {
      unit.pivot.rotation.y = advanceBearing(unit.pivot.rotation.y, unit.headingGoal, dt * (unit.travel ? 14 : 20))
      if (Math.abs(angularDifference(unit.pivot.rotation.y, unit.headingGoal)) < .005) unit.headingGoal = null
    }

    const notice = unit.notice
    const focus = unit.focus
    const rearLook = current?.startsWith('guard_look_back_')
    const alertPose = current?.startsWith('guard') || current?.startsWith('threat_display')
    const looking = !rearLook && !this.reduced && unit.idle && !unit.travel && (focus || notice && this.clock >= notice.start &&
      this.clock < notice.end) && (current?.startsWith('idle') || alertPose || turning)
    let gaze = 0
    let shoulder = 0
    if (looking) {
      const angle = angularDifference(unit.pivot.rotation.y, bearing(unit.pivot.position, (focus ?? notice).point))
      const limit = unit.idle.neck * (focus?.multi ? 1.47 : 1)
      const scan = focus?.scan ?? 0
      const offset = Math.abs(angle + scan) > limit && Math.abs(angle - scan) < Math.abs(angle + scan) ? -scan : scan
      gaze = Math.max(-limit, Math.min(limit, angle + offset)) * (turning ? .54 : 1)
      if (focus?.checking && !focus.step && Math.abs(angle) > 1.08) {
        shoulder = Math.sign(angle) * Math.min(.32, (Math.abs(angle) - 1.08) * .25)
      }
      const focusedStep = focus?.step && this.clock >= (unit.focusStepAt ?? 0)
      const fleetingStep = !focus && notice.steps > 0 && this.clock >= notice.stepAt
      if (!turning && (focusedStep || fleetingStep) &&
          (current === 'idle' || current?.startsWith('guard')) && Math.abs(angle) > (focus?.multi ? .89 : .73)) {
        if (focusedStep) unit.focusStepAt = this.clock + (focus.multi ? .42 : .66)
        else {
          notice.steps--
          notice.stepAt = this.clock + .68
          notice.end = Math.max(notice.end, this.clock + 1.62)
        }
        const direction = Math.sign(angle)
        const suffix = direction > 0 ? 'right' : 'left'
        const quick = 'turn_pivot_' + suffix
        const pivot = Math.abs(angle) > TURN_ANGLE && unit.actions.has(quick)
        const name = pivot ? quick : 'turn_' + suffix
        if (unit.actions.has(name)) {
          unit.headingGoal = null
          unit.stepTurn = { started: unit.pivot.rotation.y, angle }
          const speed = focus?.fast ? 1.10 + unit.idle.sample() * .18 : .94 + unit.idle.sample() * .19
          this.play(unit.id, name, true, false, speed)
        }
      }
    } else if (notice && this.clock >= notice.end) {
      unit.notice = null
    }
    unit.gaze += (gaze - unit.gaze) * (this.reduced ? 1 : 1 - Math.exp(-dt * (unit.idle?.quick < .18 ? 13 : 9)))
    unit.shoulder += (shoulder - unit.shoulder) * (this.reduced ? 1 : 1 - Math.exp(-dt * 7))
    if (unit.body && Math.abs(unit.shoulder) > .001) {
      unit.bodyBase.copy(unit.body.quaternion)
      headRotation.setFromAxisAngle(turnAxis, unit.shoulder)
      unit.body.quaternion.multiply(headRotation)
      unit.hasShoulder = true
    }
    if (unit.head && Math.abs(unit.gaze) > .001) {
      unit.headBase.copy(unit.head.quaternion)
      headRotation.setFromAxisAngle(turnAxis, unit.gaze)
      unit.head.quaternion.multiply(headRotation)
      unit.hasGaze = true
    }
  }

  updateBlink(unit) {
    if (!unit.idle || !unit.lids.length) return
    const period = unit.idle.quick < .18 ? .118 : .181
    const since = this.clock - unit.blinkAt
    if (since > period) unit.blinkAt = this.clock + 1.9 + unit.idle.sample() * 4.1
    const phase = since >= 0 && since < period ? Math.sin(Math.PI * since / period) ** .82 : 0
    const close = unit.dead ? 1 : this.reduced ? 0 : phase
    for (const [mesh, target] of unit.lids) mesh.morphTargetInfluences[target] = close
  }

  updateIdle(unit, dt) {
    const action = unit.current
    if (!action || !unit.pivot.visible) return
    const focus = unit.focus
    const watch = focus?.multi && unit.actions.has('guard_alert') ? 'guard_alert' : 'guard'
    if (unit.returnToRest && action.time >= action.getClip().duration - .001) {
      this.play(unit.id, focus && unit.actions.has(watch) ? watch : 'idle', false)
      return
    }
    const current = unit.currentName
    const resting = current.startsWith('idle') || current.startsWith('guard') || current.startsWith('threat_display')
    if (this.reduced) {
      if ((resting || current.startsWith('turn_')) && current !== 'idle') this.play(unit.id, 'idle', false)
      return
    }
    if (!unit.idle || unit.travel) return
    if (focus) {
      if (!resting || current.startsWith('threat_display')) return
      if (current.startsWith('guard_look_back_')) {
        if (focus.fast && unit.rearLookTicket !== focus.ticket) this.play(unit.id, watch, false)
        return
      }
      const direction = angularDifference(unit.pivot.rotation.y, bearing(unit.pivot.position, focus.point))
      const glance = 'guard_look_back_' + (direction > 0 ? 'right' : 'left')
      if (!focus.step && !focus.display && Math.abs(direction) > 2.44 && unit.actions.has(glance) &&
          focus.ticket !== unit.rearLookTicket && this.clock > (unit.rearLookAt ?? 0)) {
        unit.rearLookTicket = unit.reactionTicket = focus.ticket
        unit.rearLookAt = this.clock + 2.4 + unit.idle.sample() * 3.1
        this.play(unit.id, glance, true, false, .84 + unit.idle.sample() * .33)
        return
      }
      if (focus.display && Math.abs(direction) < .75 &&
          unit.actions.has('threat_display')) {
        unit.vigilance.consumeDisplay(focus.id)
        focus.display = false
        const show = focus.multi && unit.actions.has('threat_display_wide') ? 'threat_display_wide' : 'threat_display'
        this.play(unit.id, show)
      } else if (focus.ticket !== unit.reactionTicket && unit.actions.has('guard_react_' + focus.reaction)) {
        unit.reactionTicket = focus.ticket
        this.play(unit.id, 'guard_react_' + focus.reaction, true, false, .94 + unit.idle.sample() * .24)
      } else if (!current.startsWith('guard_react_') && current !== watch && unit.actions.has(watch)) {
        this.play(unit.id, watch, false)
      }
      return
    }
    if (current.startsWith('guard')) {
      this.play(unit.id, 'idle', false)
      return
    }
    const urgent = unit.notice?.urgent && this.clock >= unit.notice.start
    if (urgent && ['idle_sit','idle_groom','idle_browse','idle_preens','idle_check_wand'].includes(unit.currentName)) {
      this.play(unit.id, 'idle', false)
      return
    }
    if (unit.currentName !== 'idle') return
    if (this.clock >= unit.nextLook && (!unit.notice || this.clock >= unit.notice.end)) this.lookAround(unit)
    if (urgent && unit.notice.steps > 0 &&
        Math.abs(angularDifference(unit.pivot.rotation.y, bearing(unit.pivot.position, unit.notice.point))) > .73) return
    unit.idleIn -= dt
    if (unit.idleIn > 0) return
    const { clip, pause, speed } = unit.idle.next(unit.notice?.mood)
    unit.idleIn = unit.idlePause = pause
    this.play(unit.id, clip, true, false, speed)
  }

  face(actor, target) {
    const unit = this.units.get(actor)
    if (!unit || !target) return
    if (distance(unit.pivot.position, target) < .01) return
    const heading = bearing(unit.pivot.position, target)
    if (this.reduced) unit.pivot.rotation.y = heading
    else unit.headingGoal = heading
  }

  move(actor, points, reduced) {
    const unit = this.units.get(actor)
    if (!unit) return Promise.resolve()
    unit.travel?.resolve()
    unit.travel = null
    const cost = points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0)
    const finish = points.at(-1)
    if (finish) this.signal(finish, actor, 'move', 5.0)
    if (cost < .001 || reduced) {
      if (finish) {
        this.face(actor, finish)
        unit.pivot.position.set(finish.x, 0, finish.z)
      }
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

  hit(event, nearby = false) {
    this.worldPoint(event)
    const candidates = [...this.units.values()].filter(unit => !unit.dead && !unit.ghost && unit.pivot.visible)
    const picked = this.ray.intersectObjects(candidates.map(unit => unit.pivot), true).find(result => result.object.isMesh)
    let obj = picked?.object
    while (obj?.parent && obj.parent !== this.actors) obj = obj.parent
    if (obj) return candidates.find(u => u.pivot === obj)?.id
    if (!nearby) return null
    const bounds = this.canvas.getBoundingClientRect()
    let closest = 25
    let id = null
    for (const unit of candidates) {
      if (!this.callbacks.touchTarget?.(unit.id)) continue
      const aim = this.project(unit.pivot.position, .64)
      const gap = Math.hypot(aim.x + bounds.left - event.clientX, aim.y + bounds.top - event.clientY)
      if (gap < closest) {
        closest = gap
        id = unit.id
      }
    }
    return id
  }

  attach() {
    const clear = () => {
      this.pendingPointer = null
      this.callbacks.hover(null)
    }
    const portrait = () => ['choose', 'inspect'].includes(this.mode)
    this.touch = attachTouchControls(this.canvas, {
      aims: () => this.callbacks.touchAim?.(),
      preview: event => { if (this.mode === 'battle') this.pendingPointer = event },
      clear,
      pan: (prev, next) => {
        if (portrait()) {
          this.view.azimuth -= (next.clientX - prev.clientX) * .01
          this.placeCamera()
        } else this.panCamera(prev, next)
      },
      pinch: (prev, next, zoom, turn) => {
        const anchor = portrait() ? null : this.worldPoint(prev)
        this.view.azimuth += turn
        this.zoomCamera(zoom)
        if (anchor) this.panCamera(prev, next, anchor)
      },
      tap: event => {
        if (this.mode !== 'battle') return
        const where = this.worldPoint(event)
        if (where) this.callbacks.click(where, this.callbacks.touchAim?.() ? null : this.hit(event, true))
      },
    })
    this.canvas.addEventListener('contextmenu', event => {
      if (event.button === 2 && !event.shiftKey) event.preventDefault()
    })
    this.canvas.addEventListener('pointerdown', event => {
      if (event.shiftKey || (event.button !== 2 && event.button !== 1)) return
      this.drag = { x: event.clientX, y: event.clientY, center: event.button === 1,
        pointerId: event.pointerId, moved: false }
      this.canvas.setPointerCapture(event.pointerId)
    })
    this.canvas.addEventListener('pointermove', event => {
      if (event.pointerType === 'touch') return
      if (this.drag) {
        if (event.pointerId !== this.drag.pointerId) return
        const dx = event.clientX - this.drag.x
        const dy = event.clientY - this.drag.y
        if (!this.drag.moved && Math.hypot(dx, dy) < 6) return
        this.drag.moved = true
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
    this.canvas.addEventListener('pointerup', event => {
      if (this.drag?.pointerId !== event.pointerId) return
      const { moved, center, x, y } = this.drag
      this.drag = null
      if (!moved && !center && event.button === 2 && Math.hypot(event.clientX - x, event.clientY - y) < 6)
        this.callbacks.cancel()
    })
    const release = event => {
      if (this.drag?.pointerId === event.pointerId) this.drag = null
    }
    this.canvas.addEventListener('pointercancel', release)
    this.canvas.addEventListener('lostpointercapture', release)
    this.canvas.addEventListener('pointerleave', event => {
      if (event.pointerType !== 'touch') clear()
    })
    this.canvas.addEventListener('click', event => {
      if (this.touch.synthetic(event)) return
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
    const light = this.magicLights.find(light => !light.userData.busy)
    if (type === 'summon' && element === 'fire') {
      const fire = fireSummon(this.scene, point, light)
      this.effects.push(fire.advance)
      return fire.ready
    }
    const effect = elementalEffect(this.scene, point, element, type, towards, scale, light)
    this.effects.push(effect.advance)
    return effect.ready
  }

  frame(now) {
    requestAnimationFrame(next => this.frame(next))
    if (this.host.hidden || document.hidden || this.contextLost) {
      this.last = now
      return
    }
    if (now - this.last < (this.software ? 48 : this.batterySaver ? 31 : 14)) return
    const dt = (now - this.last) / 1000
    this.last = now
    if (this.touchLayout.matches && !this.software && !this.batterySaver && dt < .13) {
      this.frameLoad += dt
      this.frameSample++
      if (this.frameSample === 90) {
        const average = this.frameLoad / this.frameSample
        const next = T.MathUtils.clamp(this.performanceScale + (average > .024 ? -.12 : average < .019 ? .06 : 0), .66, 1)
        if (next !== this.performanceScale) {
          this.performanceScale = next
          this.layout()
        }
        this.frameLoad = this.frameSample = 0
      }
    }
    this.clock += dt
    if (this.pendingPointer) {
      const pointer = this.pendingPointer
      this.pendingPointer = null
      this.callbacks.hover(this.worldPoint(pointer))
    }
    for (const unit of this.units.values()) {
      if (unit.hasGaze) {
        unit.head.quaternion.copy(unit.headBase)
        unit.hasGaze = false
      }
      if (unit.hasShoulder) {
        unit.body.quaternion.copy(unit.bodyBase)
        unit.hasShoulder = false
      }
      if (unit.pivot.visible && !(this.reduced && unit.currentName === 'idle')) unit.mixer?.update(dt)
      this.tickTravel(unit, dt)
      if (unit.shadow) {
        unit.shadow.position.x = unit.pivot.position.x
        unit.shadow.position.z = unit.pivot.position.z
      }
      if (unit.current && unit.pivot.visible) {
        this.updateFocus(unit)
        this.updateFacing(unit, dt)
        this.updateIdle(unit, dt)
        this.updateBlink(unit)
      }
    }
    this.effects = this.effects.filter(tick => tick(dt))
    this.callbacks.frame(this)
    this.motes.material.uniforms.time.value = now / 1000
    surfaceTime(now / 1000)
    this.renderer.render(this.scene, this.camera)
  }
}
