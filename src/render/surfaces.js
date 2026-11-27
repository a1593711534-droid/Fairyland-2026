import * as T from 'three'
import { artURL } from './art-url.js'

const loader = new T.TextureLoader()
const files = new Map()
const surface = [
  [/^Meadow soil/, 'soil', .46],
  [/^Weathered slate/, 'stone', .60, true],
  [/^Soft lichen/, 'soil', .28],
  [/(bark|Oil-rubbed rowan)$/, 'bark', .53],
  [/^(Midnight wool|Russet velvet|Faded ochre linen)/, 'cloth', .52],
  [/^Oiled leather/, 'hide', .54],
  [/^Carapace/, 'scales', .31, true],
  [/^Feather/, 'plume', .27, true, true],
  [/^Coat scales/, 'scales', .36, true],
  [/^Coat fur/, 'fur', .22, true, true],
  [/^Coat plume/, 'plume', .24, true, true],
]

function texture(name, component = '') {
  const key = component ? name + '-' + component : name
  if (!files.has(key)) {
    files.set(key, loader.loadAsync(artURL('surfaces/' + key + '.webp')).then(tex => {
      tex.flipY = false
      tex.wrapS = tex.wrapT = T.RepeatWrapping
      tex.anisotropy = 4
      if (component === 'color' || !component) tex.colorSpace = T.SRGBColorSpace
      return tex
    }).catch(error => { files.delete(key); throw error }))
  }
  return files.get(key)
}

function foliage(material) {
  material.visible = false
  return texture('alder-canopy').then(map => {
    map.wrapS = map.wrapT = T.ClampToEdgeWrapping
    material.map = map
    material.alphaTest = .34
    material.alphaToCoverage = true
    material.side = T.DoubleSide
    material.roughness = .89
    material.visible = true
    material.needsUpdate = true
  })
}

const waterTime = { value: 0 }

function water(material) {
  material.onBeforeCompile = shader => {
    shader.uniforms.waterTime = waterTime
    shader.vertexShader = 'varying vec2 localWater;\n' + shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nlocalWater = uv;')
    shader.fragmentShader = 'varying vec2 localWater;\nuniform float waterTime;\n' +
      shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        vec2 p = localWater * 3.28;
        float a = sin(p.x * 3.0 + p.y * 1.9 - waterTime * .97);
        float b = sin(p.x * .77 - p.y * 2.52 + waterTime * 1.27);
        float caustic = pow(max(0., a*.53 + b*.59), 7.);
        diffuseColor.rgb = diffuseColor.rgb * (.83 + .13*a + .12*b) + caustic*vec3(.12,.23,.21);
      `)
  }
  material.needsUpdate = true
}

export function surfaceTime(time) {
  waterTime.value = time
}

export async function applySurfaces(scene) {
  const applied = new Map()
  scene.traverse(object => {
    if (!object.isMesh || !object.geometry.attributes.uv) return
    for (const material of [object.material].flat()) {
      if (applied.has(material)) continue
      if (material.name === 'Alder foliage atlas') {
        applied.set(material, foliage(material).catch(() => {}))
        continue
      }
      if (material.name === 'Moonstone pool') {
        water(material)
        applied.set(material, null)
        continue
      }
      const match = surface.find(([pattern]) => pattern.test(material.name))
      if (!match) continue
      const [, name, bump, rough, normalOnly] = match
      const colors = normalOnly ? null : texture(name, 'color')
      applied.set(material, Promise.all([colors, texture(name, 'normal'), rough ? texture(name, 'rough') : null])
        .then(([color, normal, roughness]) => {
          if (color) material.map = color
          material.normalMap = normal
          material.normalScale.setScalar(bump)
          if (roughness) {
            material.roughnessMap = roughness
            if (name === 'scales') material.roughness = material.name.startsWith('Carapace') ? .81 : .87
            else if (normalOnly) material.roughness = .98
          }
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
