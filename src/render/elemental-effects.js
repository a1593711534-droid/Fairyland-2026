import * as T from 'three'
import { flowTexture } from './fire-summon.js'

const tau = Math.PI * 2
const themes = {
  water: { dark: '#08336c', bright: '#33aee9', core: '#e4fbff', mode: 0 },
  earth: { dark: '#563025', bright: '#c58a50', core: '#ffe0a4', mode: 1 },
  thunder: { dark: '#373296', bright: '#a18aff', core: '#fff8e9', mode: 2 },
  ice: { dark: '#235995', bright: '#72d5fd', core: '#f2fcff', mode: 3 },
  wind: { dark: '#1a6956', bright: '#69ddac', core: '#e8fff0', mode: 4 },
  fire: { dark: '#a11e10', bright: '#ff6b25', core: '#fff2ae', mode: 5 },
}
const cues = {
  cast:    { duration: .34, radius: .37, height: 1.0, reveal: 0 },
  impact:  { duration: .82, radius: 1.18, height: 1.36, reveal: 0 },
  area:    { duration: 1.14, radius: 1.18, height: 1.4, reveal: 0 },
  summon:  { duration: 1.64, radius: 1.30, height: 2.56, reveal: .61 },
  capture: { duration: 1.24, radius: 1.43, height: 2.24, reveal: 0 },
  evolve:  { duration: 1.98, radius: 1.46, height: 2.84, reveal: 0 },
  recall:  { duration: 1.02, radius: 1.26, height: 2.20, reveal: 0 },
}
const ribbonVertex = /* glsl */ `
  uniform float age;
  uniform float style;
  varying vec2 coord;
  varying vec3 viewDirection;
  varying vec3 viewNormal;
  void main() {
    coord = uv;
    vec3 p = position;
    float direction = mix(1.,-1.,step(.5,style));
    float sway = .09*sin(age*9.*direction + uv.x*21. + uv.y*5.);
    p.xz *= 1.+sway;
    p.y += .11*sin(uv.x*17.-age*12.+uv.y*4.)*uv.y;
    vec4 view = modelViewMatrix*vec4(p,1.);
    viewDirection = normalize(-view.xyz);
    viewNormal = normalize(normalMatrix*normal);
    gl_Position = projectionMatrix*view;
  }
`
const ribbonFragment = /* glsl */ `
  uniform float age;
  uniform float mode;
  uniform float style;
  uniform float layer;
  uniform sampler2D flowMap;
  uniform vec3 darkColor;
  uniform vec3 brightColor;
  uniform vec3 coreColor;
  varying vec2 coord;
  varying vec3 viewDirection;
  varying vec3 viewNormal;
  void main() {
    float t = coord.x;
    float y = coord.y;
    float direction = mix(1.,-1.,step(.5,style));
    vec2 flow = vec2(t*1.31-age*direction*.53, y*.78-age*.59+layer*.17);
    float curl = texture2D(flowMap, flow).r;
    float ripple = texture2D(flowMap, flow*2.9+vec2(curl*.32,y*.17)).r;
    float rim = pow(1.-abs(dot(viewNormal,viewDirection)),2.);
    float bands = .5+.5*sin(t*29.+y*7.-age*12.*direction+curl*8.);
    float web = .5+.5*sin(t*75.-y*15.+curl*20.+ripple*6.);
    float mask = 0.;
    float light = 0.;
    if (mode < .5) {
      mask = .42+.42*smoothstep(.28,.66,curl)+.17*rim;
      float foam = smoothstep(.71,.99,y)*smoothstep(.31,.58,curl);
      light = .35*rim+.23*smoothstep(.84,1.,web)+.24*smoothstep(.39,.70,ripple)+.71*foam;
    } else if (mode < 1.5) {
      mask = smoothstep(.26,.72,curl*.74+ripple*.29)*.62;
      light = smoothstep(.63,.9,bands)*ripple*.66;
    } else if (mode < 2.5) {
      float branches = smoothstep(.82,.98,web)*smoothstep(.27,.63,curl);
      mask = (.23*rim+.61*branches)*(.71+.28*sin(age*67.+y*9.));
      light = .69*branches+.42*rim;
    } else if (mode < 3.5) {
      mask = .32+.36*smoothstep(.44,.7,ripple)+.13*rim;
      float detail = smoothstep(.84,.99,web)*smoothstep(.46,.65,bands);
      light = .58*rim+.64*detail;
    } else if (mode < 4.5) {
      mask = .63*smoothstep(.28,.76,ripple*.57+bands*.42)+.11*rim;
      light = .47*rim+.52*smoothstep(.74,.99,bands);
    } else {
      mask = smoothstep(.33,.68,ripple*.53+curl*.38+bands*.2)*.78;
      light = .73*smoothstep(.30,.81,mask)+.19*rim;
    }
    float border = smoothstep(0.,.24,y)*(1.-smoothstep(.76,1.,y));
    float ends = smoothstep(0.,.13,t)*(1.-smoothstep(.74,1.,t));
    float fade = smoothstep(0.,.14,age)*(1.-smoothstep(.60,1.,age));
    vec3 color = mix(darkColor,brightColor,smoothstep(.07,.61,light+curl*.44));
    color = mix(color,coreColor,smoothstep(.59,1.,light));
    gl_FragColor = vec4(color,mask*border*ends*fade);
    #include <colorspace_fragment>
  }
`

const floorFragment = /* glsl */ `
  uniform float age;
  uniform float mode;
  uniform float style;
  uniform vec3 brightColor;
  uniform vec3 coreColor;
  uniform sampler2D flowMap;
  varying vec2 coord;
  void main() {
    vec2 p = coord*2.-1.;
    float r = length(p), a = atan(p.y,p.x);
    float flow = texture2D(flowMap,p*.9+vec2(age*.13)).r;
    float spread = mix(age,1.-age,step(.5,style));
    float wave = r - (.13 + spread*.82 + .047*sin(a*5.+flow*4.));
    float bands = exp(-wave*wave*445.)*.56;
    float wake = .5+.5*sin(r*37.-spread*24.+flow*4.);
    float shape = bands + exp(-r*r*5.)*.28*wake;
    if (mode>.5 && mode<1.5) {
      float cracks=.5+.5*sin(a*12.+flow*4.);
      shape = max(shape,exp(-r*r*2.9)*smoothstep(.92,1.,cracks)*smoothstep(.03,.37,r));
    }
    if (mode>2.5&&mode<3.5) {
      float facets=.5+.5*cos(a*6.);
      shape += .44*exp(-r*r*2.8)*smoothstep(.85,.995,facets)*smoothstep(.04,.27,r);
    }
    float fade = smoothstep(0.,.13,age)*(1.-smoothstep(.51,1.,age));
    gl_FragColor=vec4(mix(brightColor,coreColor,clamp(bands+flow*.16,0.,1.)),shape*fade*(1.-smoothstep(.89,1.,r)));
    #include <colorspace_fragment>
  }
`

function ribbonsGeometry(turns, rise, width, phase) {
  const points = [], uv = [], index = []
  const steps = 62, across = 5
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const a = t * turns * tau + phase
    const r = .90 - .23*t + .09*Math.cos(tau*t)
    for (let j = 0; j <= across; j++) {
      const v = j / across
      const curl = .21*Math.sin((v-.5)*Math.PI) * Math.sin(t*Math.PI)
      const h = (v-.5) * width * (.26 + .74 * Math.sin(t*Math.PI)**.71)
      points.push((r+curl)*Math.cos(a), .13 + t*rise + h, (r+curl)*Math.sin(a))
      uv.push(t,v)
      if (i && j) {
        const p = i*(across+1)+j
        index.push(p,p-1,p-across-2,p,p-across-2,p-across-1)
      }
    }
  }
  const geometry = new T.BufferGeometry()
  geometry.setAttribute('position',new T.Float32BufferAttribute(points,3))
  geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

const forms = {
  water: [1.02, .67, .84],
  earth: [.53, .34, .53],
  thunder: [.55, .91, .57],
  ice: [.74, .85, .44],
  wind: [1.46, .86, .67],
  fire: [.91, .93, .70],
}

const ribbonGeometries = new Map()
function ribbons(element, colors, uniforms) {
  if (!ribbonGeometries.has(element)) {
    const [turns, rise, width] = forms[element]
    ribbonGeometries.set(element, Array.from({ length: element==='earth' ? 2 : 3 }, (_, i) =>
      ribbonsGeometry(turns - i*.15,rise - i*.11,width - i*.07,i*2.39)))
  }
  return ribbonGeometries.get(element).map((geometry, i) =>
    new T.Mesh(geometry, new T.ShaderMaterial({
      uniforms: { ...uniforms, layer: { value: i }, darkColor: { value: colors.dark } },
      vertexShader: ribbonVertex, fragmentShader: ribbonFragment, side: T.DoubleSide,
      depthWrite: false, transparent: true, forceSinglePass: true, toneMapped: false,
      blending: element === 'wind' || element === 'thunder' ? T.AdditiveBlending : T.NormalBlending,
    })))
}

const diskGeometry = new T.PlaneGeometry(2,2)
function floor(uniforms) {
  const disk = new T.Mesh(diskGeometry,new T.ShaderMaterial({
    uniforms, fragmentShader: floorFragment,
    vertexShader: 'varying vec2 coord; void main(){coord=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false,
  }))
  disk.rotation.x = -Math.PI/2
  disk.position.y = .041
  return disk
}

const solidGeometry = {
  earth: new T.DodecahedronGeometry(1, 0),
  ice: new T.OctahedronGeometry(1, 0),
  water: new T.IcosahedronGeometry(1, 1),
}
const direct = new T.Object3D()

function solids(element, colors) {
  const geometry = solidGeometry[element]
  if (!geometry) return null
  const ice = element === 'ice', water = element === 'water'
  const mesh = new T.InstancedMesh(geometry, new T.MeshStandardMaterial({
    color: water ? colors.bright : colors.dark, roughness: ice ? .23 : water ? .14 : .91,
    metalness: ice ? .34 : .04, flatShading: !water, emissive: colors.bright, emissiveIntensity: ice ? .32 : .07,
  }), ice ? 12 : 17)
  mesh.frustumCulled = false
  return mesh
}

function lightning(colors, outer = false) {
  const geometry = new T.BufferGeometry()
  geometry.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(66*3),3))
  geometry.setIndex(Array.from({ length: 32 }, (_, i) => [i*2,i*2+1,i*2+2,i*2+1,i*2+3,i*2+2]).flat())
  const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial({
    color: outer ? colors.bright : colors.core,
    transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending,
  }))
  mesh.frustumCulled = false
  return mesh
}

function animateBolt(mesh, t, radius, height, cast, streak) {
  const position = mesh.geometry.attributes.position
  const flicker = Math.floor(t*14)
  const outer = streak===1
  const branch = Math.max(0,streak-1)
  const angle = flicker*.83+branch*2.12
  for (let i=0; i<33; i++) {
    const u=i/32, segment = Math.floor(u*8)
    const jitter = Math.sin((segment*19+flicker)*2.17)*.57+Math.sin(u*73+angle)*.12
    const fork = branch*u*.41
    const x = Math.sin(angle+u*8)*radius*u*.56+jitter*radius*.48+Math.cos(angle)*fork
    const z = Math.cos(angle+u*7)*radius*u*.45+Math.sin(angle)*fork
    const y = cast ? (u-.5)*1.27 : (u*(1-branch*.17)+branch*.10)*height
    const width = (.019 + (1-u)*.040)*(outer ? 2.65 : branch ? .56 : 1)
    position.setXYZ(i*2,x-width,y,z)
    position.setXYZ(i*2+1,x+width,y,z)
  }
  position.needsUpdate=true
  mesh.material.opacity=Math.max(0,1-t)*(.56+.42*Math.sin(t*66)**2)*(outer ? .24 : branch ? .68 : 1)
}

export function elementalEffect(scene, point, element, type, toward, scale, light) {
  const theme = themes[element], cue = cues[type]
  const colors = { dark: new T.Color(theme.dark), bright: new T.Color(theme.bright), core: new T.Color(theme.core) }
  const inward = type === 'capture' || type === 'recall'
  const cast = type === 'cast'
  const uniforms = { age: { value: 0 }, style: { value: inward ? 1 : 0 },
    mode: { value: theme.mode }, flowMap: { value: flowTexture() },
    brightColor: { value: colors.bright }, coreColor: { value: colors.core } }
  const group = new T.Group(), current = new T.Vector3(point.x,cast ? .83 : 0,point.z)
  const spiral = new T.Group()
  spiral.add(...ribbons(element,colors,uniforms))
  group.position.copy(current)
  group.add(spiral)
  const origin = current.clone()
  const destination = toward && new T.Vector3(toward.x,.67,toward.z)
  const land = cast ? null : floor(uniforms)
  const chips = solids(element,colors)
  const bolts = element === 'thunder' ? Array.from({ length: 4 }, (_, i) => lightning(colors,i>0)) : []
  if (land) group.add(land)
  if (chips) group.add(chips)
  for (const bolt of bolts) group.add(bolt)
  if (light) {
    light.color.copy(colors.bright)
    light.userData.busy = true
  }
  scene.add(group)
  let clock = 0, signal
  const ready = cue.reveal ? new Promise(resolve => { signal=resolve }) : undefined

  return {
    ready,
    advance(dt) {
      clock += dt
      if (signal && clock >= cue.reveal) {
        signal()
        signal=null
      }
      if (clock >= cue.duration) {
        if (light) { light.intensity=0; light.userData.busy=false }
        scene.remove(group)
        group.traverse(obj => { if (obj.isMesh) obj.material.dispose() })
        for (const bolt of bolts) bolt.geometry.dispose()
        return false
      }
      const t = clock/cue.duration
      uniforms.age.value=t
      const grow = 1-(1-t)**3
      const rise = T.MathUtils.smoothstep(t,0,.47)
      const radius = cue.radius*scale*(inward ? 1.12-grow*.82 : .33+.82*grow)
      const crest = element === 'water' && !cast ? .81+.27*Math.sin(t*Math.PI) : 1
      spiral.scale.set(radius,cue.height*crest*(inward ? 1.04-t*.56 : .28+.78*rise),radius)
      spiral.rotation.y = (inward ? -1 : 1)*t*(element==='wind' ? 5.9 : 3.5)
      land?.scale.setScalar(cue.radius*scale*1.7)
      if (destination) {
        const journey = Math.min(1,t*1.5)
        current.lerpVectors(origin,destination,journey)
        current.y += .46*Math.sin(Math.PI*journey)
        group.position.copy(current)
      }
      if (chips) for (let i=0; i<chips.count; i++) {
        const spin = i*2.399963, life = Math.max(0,t-i%3*.052)
        const step = inward ? .97-life*.72 : .22+life*.95
        const a = spin+(inward?-1:1)*life*3.8
        const anchored = element==='ice' && !cast
        const r = (anchored ? .35+i%4*.16 : step)*cue.radius*scale*(.65+i%7*.10)
        const h = anchored ? (.23+i%5*.115)*Math.sin(life*Math.PI) :
          (.54+i%5*.23)*Math.sin(life*Math.PI)*(element==='water'?1.26:1)
        const size = (cast ? .06 : .115+i%5*.022)*Math.sin(Math.PI*life)**.75
        direct.position.set(Math.cos(a)*r,h,Math.sin(a)*r)
        direct.rotation.set(anchored ? .22*Math.cos(spin) : spin+life*3.6,a,
          anchored ? .36*Math.sin(spin) : spin*.2+life*3.5)
        direct.scale.set(size,size*(element==='ice' ? 2.62 : element==='water' ? 1.43 : .86),size)
        direct.updateMatrix()
        chips.setMatrixAt(i,direct.matrix)
      }
      if (chips) chips.instanceMatrix.needsUpdate=true
      for (let i=0; i<bolts.length; i++) animateBolt(bolts[i],t,radius,cue.height,cast,i)
      if (light) {
        light.position.copy(group.position)
        light.position.y += .78
        light.intensity = (cast ? 13 : 24)*Math.sin(Math.PI*t)**1.6
      }
      return true
    },
  }
}
