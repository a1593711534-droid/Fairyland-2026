import * as T from 'three'
import { artURL } from './art-url.js'

const loader = new T.TextureLoader()
const files = new Map()
const surface = [
  [/^Meadow soil/, 'soil', .74],
  [/^Weathered slate/, 'stone', .85, true],
  [/^Soft lichen/, 'soil', .36],
  [/(bark|Oil-rubbed rowan)$/, 'bark', .71],
  [/^(Midnight wool|Russet velvet|Faded ochre linen)/, 'cloth', .52],
  [/^Oiled leather/, 'hide', .54],
  [/^Coat scales/, 'scales', .39, false, true],
  [/^Coat fur/, 'fur', .33, false, true],
  [/^Coat plume/, 'plume', .36, false, true],
]

function texture(name, component) {
  const key = name + '-' + component
  if (!files.has(key)) {
    files.set(key, loader.loadAsync(artURL('surfaces/' + key + '.webp')).then(tex => {
      tex.flipY = false
      tex.wrapS = tex.wrapT = T.RepeatWrapping
      tex.anisotropy = 4
      if (component === 'color') tex.colorSpace = T.SRGBColorSpace
      return tex
    }).catch(error => { files.delete(key); throw error }))
  }
  return files.get(key)
}

export async function applySurfaces(scene) {
  const applied = new Map()
  scene.traverse(object => {
    if (!object.isMesh || !object.geometry.attributes.uv) return
    for (const material of [object.material].flat()) {
      const match = surface.find(([pattern]) => pattern.test(material.name))
      if (!match || applied.has(material)) continue
      const [, name, bump, rough, normalOnly] = match
      const colors = normalOnly ? null : texture(name, 'color')
      applied.set(material, Promise.all([colors, texture(name, 'normal'), rough ? texture(name, 'rough') : null])
        .then(([color, normal, roughness]) => {
          if (color) material.map = color
          material.normalMap = normal
          material.normalScale.setScalar(bump)
          if (roughness) material.roughnessMap = roughness
          material.needsUpdate = true
        }).catch(() => {}))
    }
  })
  await Promise.all(applied.values())
  return scene
}

export function fireflies(scene) {
  const positions = new Float32Array(56 * 3)
  const phases = new Float32Array(56)
  for (let i = 0; i < phases.length; i++) {
    const a = i * 2.39996323
    const r = 3.4 + (i * 17 % 53) / 4
    positions.set([Math.cos(a) * r, .28 + (i * 13 % 29) / 14, Math.sin(a) * r * .66], i * 3)
    phases[i] = i * .771
  }
  const geometry = new T.BufferGeometry()
  geometry.setAttribute('position', new T.BufferAttribute(positions, 3))
  geometry.setAttribute('phase', new T.BufferAttribute(phases, 1))
  const material = new T.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `
      uniform float time;
      attribute float phase;
      varying float energy;
      void main() {
        vec3 p = position + vec3(sin(time * .36 + phase) * .34, sin(time * .55 + phase) * .21, cos(time * .34 + phase) * .33);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
        energy = pow(.5+.5*sin(time*1.4+phase*3.),4.);
        gl_PointSize = 2.0+energy*4.3;
      }
    `,
    fragmentShader: `
      varying float energy;
      void main() {
        float radius = length(gl_PointCoord-.5)*2.;
        float glow = max(0.,1.-radius);
        gl_FragColor = vec4(1.,.80,.36,(glow*glow+.44*pow(glow,8.))*energy*.7);
      }
    `,
    blending: T.AdditiveBlending, transparent: true, depthWrite: false,
  })
  const dots = new T.Points(geometry, material)
  dots.frustumCulled = false
  scene.add(dots)
  return dots
}
