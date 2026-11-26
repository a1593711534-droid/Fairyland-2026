import * as T from 'three'

const revealTime = .675
const duration = 2.16
const tau = Math.PI * 2

let flowMap
export function flowTexture() {
  if (flowMap) return flowMap
  const size = 128
  const pixels = new Uint8Array(size * size)
  const octaves = [4, 8, 16, 32, 64]
  let seed = 518519
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  const grid = octaves.map(span => Float32Array.from({ length: span * span }, random))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0
      for (const [i, span] of octaves.entries()) {
        const sx = x / size * span, sy = y / size * span
        const ix = Math.floor(sx), iy = Math.floor(sy)
        const tx = T.MathUtils.smoothstep(sx - ix, 0, 1), ty = T.MathUtils.smoothstep(sy - iy, 0, 1)
        const data = grid[i]
        const sample = (px, py) => data[(py % span) * span + px % span]
        const a = T.MathUtils.lerp(sample(ix, iy), sample(ix + 1, iy), tx)
        const b = T.MathUtils.lerp(sample(ix, iy + 1), sample(ix + 1, iy + 1), tx)
        sum += T.MathUtils.lerp(a, b, ty) * [.46,.25,.15,.09,.05][i]
      }
      pixels[y * size + x] = Math.round(sum * 255)
    }
  }
  const texture = new T.DataTexture(pixels, size, size, T.RedFormat)
  texture.wrapS = texture.wrapT = T.RepeatWrapping
  texture.magFilter = T.LinearFilter
  texture.minFilter = T.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  flowMap = texture
  return texture
}

const mantleVertex = /* glsl */ `
  uniform float time;
  uniform float layer;
  varying vec3 field;
  varying float altitude;
  void main() {
    float h = uv.y;
    vec3 p = position;
    float phase = atan(p.z,p.x);
    float breath = smoothstep(.025,.39,time);
    float rise = smoothstep(.02,.68,time);
    float peak = (time-.74)/.28;
    float flare = 1. + .27 * exp(-peak*peak);
    altitude = h;
    float r = 1. + .16*sin(phase*3. + h*10. - time*4.)
                 + .095*sin(phase*5. - h*15. + time*6. + layer);
    p.xz *= flare*r*mix(.59,1.,breath);
    p.xz += vec2(sin(h*4.1+time*2.),cos(h*4.1+time*2.)) * h*h*.22;
    float lift = .18*sin(phase*4. + h*11. - time*9.)*h*h;
    p.y = (position.y + 1.55) * mix(.19,1.27,rise) + lift + .022;
    field = vec3(p.x, h, p.z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.);
  }
`

const mantleFragment = /* glsl */ `
  uniform float time;
  uniform float layer;
  uniform sampler2D flowMap;
  varying float altitude;
  varying vec3 field;
  void main() {
    float h = altitude;
    float a = atan(field.z,field.x) - time*3.65 + h*5.6 + layer*.72;
    float u = a*.15915494;
    float flow = h*1.38 - time*1.03;
    float roll = texture2D(flowMap,vec2(u,flow*.74+layer*.39)).r;
    float tongues = texture2D(flowMap,vec2(3.*u + roll*.26,flow+roll*.67)).r;
    float wave = .5 + .5*sin(4.*a + roll*5.2 - h*6.1);
    float spiral = .5+.5*cos(2.0*a + h*10.6 + time*2.1);
    float taper = mix(.22, .35, smoothstep(.17,.77,h))
                  + .155*h*h - .113*pow(spiral,3.);
    float fieldValue = .56*roll + .32*tongues + .24*wave;
    float flame = smoothstep(taper,taper+.22,fieldValue);
    float tip = .48 + .30*tongues + .25*pow(wave,2.);
    float cut = smoothstep(.0,.073,h) * (1.-smoothstep(tip-.23,tip,h));
    float envelope = smoothstep(.01,.23,time) * (1.-smoothstep(1.03,1.71,time));
    float heat = clamp(flame*(.98-h*.54)+tongues*.17-.018,0.,1.);
    vec3 base = mix(vec3(.24,.009,.001),vec3(1.0,.102,.004),smoothstep(.13,.54,heat));
    base = mix(base,vec3(1.0,.44,.036),smoothstep(.54,.88,heat));
    base = mix(base,vec3(1.,.92,.52),smoothstep(.87,1.,heat)*(.94-h*.60));
    float filaments = texture2D(flowMap,vec2(6.*u + tongues*.23, flow*1.51 + roll*.7)).r;
    float alpha = flame*cut*envelope*(.22 + .29*pow(wave,2.) + .18*smoothstep(.36,.69,filaments)) *
                  (1.0 - .14*layer);
    gl_FragColor = vec4(base,alpha);
    #include <colorspace_fragment>
  }
`

const smokeFragment = /* glsl */ `
  uniform float time;
  uniform sampler2D flowMap;
  varying float altitude;
  varying vec3 field;
  void main() {
    float h = altitude;
    float a = atan(field.z,field.x) - time*1.44 + h*3.6;
    float path = a*.15915494;
    float flow = h*.86-time*.26;
    float warp = texture2D(flowMap,vec2(path,flow)).r;
    float clouds = texture2D(flowMap,vec2(path+warp*.29,flow+warp*.22)).r;
    float side = .56+.44*sin(a*3.+clouds*4.9+h*3.0);
    float envelope = smoothstep(.26,.86,time) * (1.-smoothstep(1.45,2.16,time));
    float density = smoothstep(.35,.72,clouds) * smoothstep(.23,.55,h) * (1.-smoothstep(.66,1.,h));
    vec3 smoke = mix(vec3(.017,.012,.010),vec3(.28,.091,.026),
                    (1.-h)*side*(1.-smoothstep(.93,1.8,time)));
    gl_FragColor = vec4(smoke,density*envelope*.69*side);
    #include <colorspace_fragment>
  }
`

function shell(top, bottom, layer, fragment) {
  return new T.Mesh(new T.CylinderGeometry(top, bottom, 3.1, 46, 20, true), new T.ShaderMaterial({
    uniforms: { time: { value: 0 }, layer: { value: layer }, flowMap: { value: flowTexture() } },
    vertexShader: mantleVertex,
    fragmentShader: fragment,
    side: T.DoubleSide,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  }))
}

function heatOnGround() {
  const disk = new T.Mesh(new T.PlaneGeometry(5.6, 5.6), new T.ShaderMaterial({
    uniforms: { time: { value: 0 }, flowMap: { value: flowTexture() } },
    transparent: true, depthWrite: false, toneMapped: false,
    blending: T.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 spot;
      void main() {
        spot = (uv-.5)*2.;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform sampler2D flowMap;
      varying vec2 spot;
      void main() {
        float r = length(spot);
        float a = atan(spot.y,spot.x);
        float n = texture2D(flowMap,spot*.68+vec2(time*.025,0.)).r;
        float crack = (r-.53 + .031*sin(8.*a)+.049*n)/.048;
        float fissure = exp(-crack*crack);
        float pool = exp(-r*r*6.) * (.67+.33*n);
        float fade = smoothstep(0.,.24,time)*(1.-smoothstep(1.12,2.16,time));
        gl_FragColor = vec4(1.,.229,.016,(pool*.32+fissure*.45*n)*fade);
        #include <colorspace_fragment>
      }
    `,
  }))
  disk.rotation.x = -Math.PI / 2
  disk.position.y = .018
  return disk
}

function embers() {
  const count = 55
  const positions = new Float32Array(count * 2 * 3)
  const heat = new Float32Array(count * 2)
  const geometry = new T.BufferGeometry()
  geometry.setAttribute('position', new T.BufferAttribute(positions, 3))
  geometry.setAttribute('heat', new T.BufferAttribute(heat, 1))
  const mesh = new T.LineSegments(geometry, new T.ShaderMaterial({
    blending: T.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false,
    vertexShader: /* glsl */ `
      attribute float heat;
      varying float energy;
      void main() {
        energy = heat;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float energy;
      void main() {
        gl_FragColor = vec4(1., .21+.55*energy, .022+.29*energy, energy);
        #include <colorspace_fragment>
      }
    `,
  }))
  mesh.frustumCulled = false
  mesh.renderOrder = 13

  function advance(time) {
    const { position, heat } = geometry.attributes
    for (let i = 0; i < count; i++) {
      const t = time - .09 - (i * 19 % 51) / 70
      const speed = .86 + (i * 17 % 31) / 18
      const start = (i * 13 % count) / count * tau
      const radius = .86 + (i * 31 % 49) / 63
      const brightness = t <= 0 ? 0 : Math.max(0, 1 - t / (.64 + i % 13 / 23))
      for (let end = 0; end < 2; end++) {
        const u = Math.max(0, t - end * .047)
        const angle = start + u * (3.4 - u * .67)
        const r = radius - u * .38 + u * u * .34
        position.setXYZ(i * 2 + end, Math.cos(angle) * r,
          .06 + speed * u + Math.sin(start + u * 9) * u * .22, Math.sin(angle) * r)
        heat.setX(i * 2 + end, brightness * (end ? .09 : .96))
      }
    }
    position.needsUpdate = heat.needsUpdate = true
  }
  return { mesh, advance }
}

function fireMeshes() {
  const ground = heatOnGround()
  const smoke = shell(.91, 1.50, 0, smokeFragment)
  smoke.scale.y = 1.19
  const plume = [shell(.57, 1.42, 0, mantleFragment), shell(.45, 1.23, 1, mantleFragment),
    shell(.30, 1.03, 2, mantleFragment)]
  const sparks = embers()
  return { meshes: [ground, smoke, ...plume, sparks.mesh], sparks }
}

export async function warmFire(renderer, scene, camera) {
  const { meshes } = fireMeshes()
  const sample = new T.Group()
  sample.add(...meshes)
  await renderer.compileAsync(sample, camera, scene)
  // Retain one program reference per material. These meshes are never drawn.
  return sample
}

export function fireSummon(scene, point, light) {
  const group = new T.Group()
  group.position.set(point.x, 0, point.z)
  const { meshes, sparks } = fireMeshes()
  if (light) {
    light.userData.busy = true
    light.color.set('#ff741d')
    light.position.set(point.x,1.24,point.z)
  }
  group.add(...meshes)
  scene.add(group)
  let time = 0
  let reveal
  const ready = new Promise(resolve => { reveal = resolve })

  function advance(dt) {
    time += dt
    if (reveal && time >= revealTime) {
      reveal()
      reveal = null
    }
    if (time >= duration) {
      if (light) {
        light.intensity = 0
        light.userData.busy = false
      }
      scene.remove(group)
      for (const mesh of meshes) {
        mesh.geometry.dispose()
        mesh.material.dispose()
      }
      return false
    }
    for (const mesh of meshes) {
      const clock = mesh.material.uniforms.time
      if (clock) clock.value = time
    }
    sparks.advance(time)
    if (light) light.intensity = 32 * T.MathUtils.smoothstep(time, .01, .34) *
      (1 - T.MathUtils.smoothstep(time, 1.10, 1.88)) *
      (.89 + .07 * Math.sin(time * 34) + .04 * Math.sin(time * 57))
    return true
  }
  return { advance, ready }
}
