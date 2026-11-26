import * as T from 'three'
import { elements } from '../game/content.js'

const { sin, cos, PI } = Math
const TAU = PI * 2
const profiles = {
  fire:    { n: 28, size: .09, curve: (a,k,t) => [cos(a+t*4)*(1-t*.8)*k, t*(2.5+k), sin(a+t*4)*(1-t*.8)*k] },
  water:   { n: 38, size: .075, curve: (a,k,t) => [cos(a)*t*2*k, .12+sin(t*PI*2+a*4)*.26+t*.42, sin(a)*t*2*k] },
  earth:   { n: 26, size: .11, curve: (a,k,t) => [cos(a)*k*(.7+t*.66), .10+sin(t*PI)*(1.4+k), sin(a)*k*(.7+t*.66)] },
  thunder: { n: 31, size: .085, curve: (a,k,t) => [cos(a)*k*(.7+sin(t*33)*.38), (1-t)*k*3, sin(a)*k*(.7+cos(t*35)*.4)] },
  ice:     { n: 38, size: .09, curve: (a,k,t) => [cos(a)*(.2+t*2)*k, .17+sin(t*PI)*k, sin(a)*(.2+t*2)*k] },
  wind:    { n: 43, size: .067, curve: (a,k,t) => [cos(a+t*7)*k*(1+t*.63), .10+t*(1.72+k)+sin(a)*.42, sin(a+t*7)*k*(1+t*.63)] },
}

export function trailFX(scene, point, element, type, toward = null) {
  const profile = profiles[element]
  const color = elements[element].color
  const geometry = new T.BufferGeometry()
  const vertices = new Float32Array(profile.n * 3)
  geometry.setAttribute('position', new T.BufferAttribute(vertices, 3))
  const dots = new T.Points(geometry, new T.PointsMaterial({
    color, size: profile.size, transparent: true, opacity: .85, blending: T.AdditiveBlending, depthWrite: false,
  }))
  dots.frustumCulled = false
  const rings = []
  const group = new T.Group()
  group.add(dots)
  const origin = new T.Vector3(point.x, .08, point.z)
  group.position.copy(origin)
  const destination = toward && new T.Vector3(toward.x, .92, toward.z)
  const bands = type === 'cast' ? 0 : element === 'water' || element === 'wind' ? 3 : 1
  for (let i = 0; i < bands; i++) {
    const ring = new T.Mesh(new T.RingGeometry(.92, 1, element === 'earth' ? 7 : element === 'ice' ? 6 : 64),
      new T.MeshBasicMaterial({ color, side: T.DoubleSide, transparent: true, depthWrite: false, opacity: .6 }))
    ring.rotation.x = -PI / 2
    ring.rotation.z = i * .4
    group.add(ring)
    rings.push(ring)
  }
  scene.add(group)
  const duration = type === 'cast' ? .52 : 1.13
  let age = 0
  return dt => {
    age += dt
    const t = Math.min(1, age / duration)
    if (destination) {
      group.position.lerpVectors(origin, destination, t)
      group.position.y += .73 * sin(t * PI)
    }
    const inward = type === 'capture'
    for (let i = 0; i < profile.n; i++) {
      const a = i * 2.399963
      const k = .23 + (i * 37 % 23) / 23
      const pos = profile.curve(a, k, inward ? 1 - t : t)
      const scale = type === 'cast' ? .33 : 1
      vertices.set(pos.map(value => value * scale), i * 3)
    }
    geometry.attributes.position.needsUpdate = true
    dots.material.opacity = .86 * (1 - t ** 2)
    for (const [i, ring] of rings.entries()) {
      const radius = (.22 + (inward ? 1 - t : t) * (1.74 + i * .32))
      ring.scale.setScalar(radius)
      ring.position.y = .022 + i * .089
      ring.material.opacity = .60 * (1 - t) / (1 + i * .42)
    }
    if (age < duration) return true
    scene.remove(group)
    group.traverse(obj => { obj.geometry?.dispose(); obj.material?.dispose() })
    return false
  }
}
