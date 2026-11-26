"""Author and export the original Fairyland meshes and authored action curves in Blender."""
import json
import math
import os
import subprocess
import random
from pathlib import Path
from math import exp

import bpy
from mathutils import Vector, noise

OUT = Path(__file__).resolve().parents[1] / '.art-cache'
OUT.mkdir(parents=True, exist_ok=True)
TAU = math.tau


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, hex_color, roughness=.74, metal=0, emission=0):
    rgb = [int(hex_color[i:i+2], 16) / 255 for i in (0, 2, 4)]
    rgb = [x / 12.92 if x < .04045 else ((x + .055) / 1.055) ** 2.4 for x in rgb]
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*rgb, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Emission Color'].default_value = (*rgb, 1)
    bsdf.inputs['Emission Strength'].default_value = emission
    return mat


def mesh(name, verts, faces, mats, smooth=True):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    for mat in mats:
        data.materials.append(mat)
    if smooth:
        for face in data.polygons:
            face.use_smooth = True
    return obj


def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def ovoid(name, at, scale, mat, twist=0, rough=0, rows=13, sides=24, sculpt=None):
    verts = []
    for i in range(rows + 1):
        latitude = math.pi * i / rows
        for j in range(sides):
            angle = TAU * j / sides
            v = Vector((scale[0] * math.sin(latitude) * math.cos(angle),
                        scale[1] * math.sin(latitude) * math.sin(angle),
                        scale[2] * math.cos(latitude)))
            growth = 1 + rough * noise.noise_vector(v * 3.1)[0]
            x = v.x * math.cos(twist) + v.z * math.sin(twist)
            z = -v.x * math.sin(twist) + v.z * math.cos(twist)
            point = (at[0] + x * growth, at[1] + v.y * growth, at[2] + z * growth)
            verts.append(sculpt(*point) if sculpt else point)
    faces = []
    for i in range(rows):
        for j in range(sides):
            a, b = i*sides + j, i*sides + (j+1)%sides
            faces.append((a, a+sides, b+sides, b))
    return mesh(name, verts, faces, [mat])


def loft(name, sections, mat, sides=12, ripple=0, steps=1):
    if steps > 1:
        keys = [(*position, width, depth) for position, width, depth in sections]
        curve = []
        for i in range(len(keys) - 1):
            a = keys[max(0, i - 1)]
            b, c = keys[i:i+2]
            d = keys[min(len(keys)-1, i+2)]
            for j in range(steps):
                t = j / steps
                curve.append(tuple(.5 * ((2*w) + (-q+x)*t + (2*q-5*w+4*x-y)*t*t + (-q+3*w-3*x+y)*t*t*t)
                                   for q,w,x,y in zip(a,b,c,d)))
        curve.append(keys[-1])
        sections = [(v[:3], max(.002, v[3]), max(.002, v[4])) for v in curve]
    verts, faces = [], []
    for index, (position, width, depth) in enumerate(sections):
        center = Vector(position)
        left = Vector(sections[max(0, index-1)][0])
        right = Vector(sections[min(len(sections)-1, index+1)][0])
        direction = (right - left).normalized()
        basis = Vector((1, 0, 0))
        if abs(direction.dot(basis)) > .83:
            basis = Vector((0, 1, 0))
        right = (basis - direction * basis.dot(direction)).normalized()
        forward = direction.cross(right)
        for j in range(sides):
            angle = TAU * j / sides
            wobble = 1 + ripple * (math.cos(angle*5 + index*.37/steps) + .4*math.sin(angle*3-index/steps))
            v = center + right*math.cos(angle)*width*wobble + forward*math.sin(angle)*depth*wobble
            verts.append(v)
        if index:
            for j in range(sides):
                k = (index-1)*sides+j
                n = (index-1)*sides+(j+1)%sides
                faces.append((k, n, n+sides, k+sides))
    faces.append(tuple(reversed(range(sides))))
    start = (len(sections)-1)*sides
    faces.append(tuple(range(start, start+sides)))
    return mesh(name, verts, faces, [mat])


def fuse(parts, name, mat, size=.07):
    activate(parts[0])
    for obj in parts:
        obj.select_set(True)
    bpy.ops.object.join()
    obj = parts[0]
    obj.name = name
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=.001)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.data.remesh_voxel_size = size
    bpy.ops.object.voxel_remesh()
    smooth = obj.modifiers.new('Sculpt relaxation', 'SMOOTH')
    smooth.factor = 1.25
    smooth.iterations = 5
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for face in obj.data.polygons:
        face.use_smooth = True
    return obj


def read_obj(path, name, mat, convert=lambda v: v):
    verts, faces = [], []
    for line in Path(path).read_text().splitlines():
        words = line.split()
        if not words:
            continue
        if words[0] == 'v':
            verts.append(convert(tuple(float(word) for word in words[1:4])))
        elif words[0] == 'f':
            faces.append(tuple(int(word.split('/')[0])-1 for word in words[1:]))
    return mesh(name, verts, faces, [mat])


def retopology(obj, kind, evolved, mat):
    binary = os.environ.get('FAIRYLAND_INSTANT_MESHES')
    if not binary:
        return obj
    name = kind + ('-evolved' if evolved else '')
    source = OUT / (name + '-sculpt.obj')
    result = OUT / (name + '-retopo.obj')
    with source.open('w') as handle:
        for vert in obj.data.vertices:
            handle.write('v %.7f %.7f %.7f\n' % tuple(vert.co))
        for poly in obj.data.polygons:
            handle.write('f ' + ' '.join(str(v+1) for v in poly.vertices) + '\n')
    subprocess.run([binary,'-t','2','-d','-D','-f',str(5200 if evolved else 4200),
        '-o',result,source],check=True,stdout=subprocess.DEVNULL)
    result_mesh = read_obj(result, 'Retopologized ' + name + ' anatomical sculpt', mat)
    bpy.data.objects.remove(obj,do_unlink=True)
    return result_mesh


def uv_project(obj, size=1, mode='box'):
    layer=obj.data.uv_layers.new(name='Material texture coordinates')
    cx=sum(v.co.x for v in obj.data.vertices)/max(1,len(obj.data.vertices))
    cy=sum(v.co.y for v in obj.data.vertices)/max(1,len(obj.data.vertices))
    for face in obj.data.polygons:
        axis=max(range(3),key=lambda i: abs(face.normal[i]))
        for link in face.loop_indices:
            x,y,z=obj.data.vertices[obj.data.loops[link].vertex_index].co
            if mode=='trunk':
                a=math.atan2(y-cy,x-cx)/math.tau
                if face.center.x < cx and a < -.3:
                    a+=1
                u,v=a*1.6, z/size
            elif mode=='ground' or axis==2:
                u,v=x/size,y/size
            elif axis==1:
                u,v=x/size,z/size
            else:
                u,v=y/size,z/size
            layer.data[link].uv=(u,v)


def blend(a, b, amount):
    t = min(1, max(0, amount))
    return [x + (y - x) * t for x, y in zip(a,b)]


def soft(low, high, value):
    t = min(1, max(0, (value-low)/(high-low)))
    return t*t*(3-2*t)


def pigment(obj, base, apply):
    tint = base.copy()
    colors = obj.data.color_attributes.new('Surface pigment', 'BYTE_COLOR', 'POINT')
    nodes = tint.node_tree.nodes
    paint = nodes.new('ShaderNodeVertexColor')
    paint.layer_name = colors.name
    tint.node_tree.links.new(paint.outputs['Color'], nodes.get('Principled BSDF').inputs['Base Color'])
    obj.data.materials[0] = tint
    for vert in obj.data.vertices:
        color = apply(vert.co)
        colors.data[vert.index].color = (*(min(1, max(0, c)) for c in color), 1)


def grain(v, scale, amount):
    return 1 + noise.noise_vector(v * scale + Vector((.197, .819, 1.421)))[0] * amount


def surface_texture(obj, mat, scale, strength):
    pigment(obj, mat, lambda v: [c*grain(v, scale, strength) for c in mat.diffuse_color[:3]])


def carve_shell(height, evolved, dark, base, accent):
    sides, rings = 84, 38
    width, depth = .66+.21*evolved, .78+.17*evolved
    seams = [(.47*math.cos(TAU*i/7), .47*math.sin(TAU*i/7)) for i in range(7)]
    seams.append((0,0))

    def relief(u, v):
        d = sorted(math.hypot(u-x,v-y) for x,y in seams)[:2]
        return soft(.018,.094,d[1]-d[0])

    verts, faces = [], []
    for i in range(rings+1):
        r = i/rings
        for j in range(sides):
            angle = j*TAU/sides
            u,v = r*math.cos(angle), r*math.sin(angle)
            ridge = relief(u,v)
            z = height+.10+(.61+.13*evolved)*(1-r*r)**.72
            z += .028*ridge + .018*math.sin(angle*7)*r
            z -= .105*soft(.88,1.0,r)
            verts.append((u*width, .13+v*depth, z))
    for i in range(rings):
        for j in range(sides):
            a,b=i*sides+j,i*sides+(j+1)%sides
            faces.append((a,a+sides,b+sides,b))
    shell = mesh('Carved shell with connected scute relief', verts, faces, [dark])
    def scute_color(p):
        u,v = p.x/width,(p.y-.13)/depth
        radius = math.hypot(u,v)
        t = relief(u,v)
        paint = blend(dark.diffuse_color[:3], base.diffuse_color[:3], t*.82)
        paint = blend(paint, accent.diffuse_color[:3], .32*soft(.72,.98,radius))
        streak = .99 + math.sin(98*radius+math.cos(u*8))*t*.075
        return [c*grain(p, 57, .24)*streak for c in paint]
    pigment(shell, dark, scute_color)
    return shell


def skin(obj, rig, weight):
    group_map = {}
    for vert in obj.data.vertices:
        for bone, influence in weight(vert.co):
            if influence < .001:
                continue
            if bone not in group_map:
                group_map[bone] = obj.vertex_groups.new(name=bone)
            group_map[bone].add([vert.index], influence, 'REPLACE')
    obj.parent = rig
    deform = obj.modifiers.new('Rig deformation', 'ARMATURE')
    deform.object = rig


def skeleton(name, height, hind_y, front_y, span, bird=False, person=False):
    data = bpy.data.armatures.new(name + ' skeleton')
    rig = bpy.data.objects.new(name + ' rig', data)
    bpy.context.collection.objects.link(rig)
    activate(rig)
    bpy.ops.object.mode_set(mode='EDIT')

    def bone(key, head, tail, parent=None):
        item = data.edit_bones.new(key)
        item.head, item.tail = head, tail
        if parent:
            item.parent = data.edit_bones[parent]

    chest = height * (.52 if not person else .60)
    bone('Body', (0, 0, chest), (0, 0, chest+.35))
    bone('Head', (0, -.36, height*.72), (0, -.36, height*.92), 'Body')
    bone('Tail', (0, .58, chest*.93), (0, 1.12, chest), 'Body')
    for sign, side in [(-1, 'L'), (1, 'R')]:
        for key, y in [('Front', front_y), ('Back', hind_y)]:
            p = (sign * span, y, chest)
            tip = (sign * span, y, .12)
            if key == 'Front' and (bird or person):
                if bird:
                    tip = (sign * (span+.8), y + .22, chest-.16)
                else:
                    p = (sign*.43, -.03, height*.72)
                    tip = (sign*.59, -.25, height*.42)
            bone(key+side, p, tip, 'Body')
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig


def animate(rig, style):
    gait, lift, strike_gain, walk_time = {
        'hero': (.54,.072,1.0,27), 'turtle': (.32,.035,.76,39), 'dino': (.55,.080,1.27,31),
        'cat': (.61,.087,1.12,23), 'bird': (.36,.163,.86,25), 'mouse': (.71,.142,.69,20),
        'dog': (.58,.094,1.12,26),
    }[style]
    specs = {
        'idle': (60, True), 'walk': (walk_time, True), 'attack': (27, False), 'skill': (38, False),
        'hit': (19, False), 'death': (36, False), 'summon': (42, False),
        'capture': (43, False), 'appear': (32, False), 'caught': (34, False), 'evolve': (63, False),
    }
    scene = bpy.context.scene
    scene.render.fps = 30
    bird = style == 'bird'
    person = style == 'hero'
    data = rig.animation_data_create()
    for clip, (duration, loop) in specs.items():
        action = bpy.data.actions.new(clip)
        data.action = action
        for step in range(9):
            t = step / 8
            frame = 1 + round(t * duration)
            wave = math.sin(t * TAU)
            beat = math.sin(t * math.pi)
            for bone in rig.pose.bones:
                name = bone.name
                side = -1 if name.endswith('L') else 1
                bone.rotation_mode = 'XYZ'
                rotation = [0, 0, 0]
                position = [0, 0, 0]
                scale = [1, 1, 1]
                if clip == 'idle':
                    if name == 'Body':
                        position[1] = .035 * (1 - math.cos(t * TAU))
                        scale[1] = 1 + .016 * (1 - math.cos(t * TAU))
                    if name == 'Head':
                        rotation = [.055 * wave, .10 * wave, .045 * (1-math.cos(t*TAU))]
                    if name == 'Tail' or bird and name.startswith('Front'):
                        rotation[2] = (.09 if bird else .19)*wave * side
                if clip == 'walk':
                    if name.startswith(('Front', 'Back')):
                        rotation[0] = gait*wave*side*(-1 if name.startswith('Back') else 1)
                        if bird and name.startswith('Front'):
                            rotation[2] = .46*wave*side
                    if name == 'Body':
                        position[1] = lift*abs(wave)
                        rotation[2] = .045*wave
                    if name == 'Head':
                        rotation[0] = .11*wave
                    if name == 'Tail':
                        rotation[2] = .30*wave
                if clip in ('attack', 'skill', 'summon', 'capture'):
                    strike = math.sin(t*TAU - .55) + math.sin(.55)
                    if name == 'Body':
                        rotation[0] = (.25 if clip == 'attack' else -.16)*strike*strike_gain
                        position[1] = (.11 if clip == 'attack' else .14)*beat
                        position[2] = -.20*beat if clip == 'attack' else 0
                    if name == 'Head':
                        rotation[0] = (.32 if clip == 'attack' else -.24)*strike
                    if name.startswith('Front'):
                        rotation[0] = (-.92 if person else -.61)*beat*(1 if name.endswith('R') or clip != 'attack' else .45)
                        rotation[2] = .34*side*beat if clip != 'attack' else .09*beat
                    if name == 'Tail':
                        rotation[0] = .49*beat
                if clip == 'hit':
                    recoil = math.sin(math.pi * min(1, t*1.25)) * (1-t*.65)
                    if name == 'Body':
                        rotation[0] = -.31*recoil
                        rotation[2] = .16*recoil
                        position[1] = .09*recoil
                    if name == 'Head':
                        rotation[0] = -.37*recoil
                    if name.startswith('Front'):
                        rotation[0] = .29*recoil
                if clip == 'death':
                    fall = t*t*(3-2*t)
                    if name == 'Body':
                        rotation[2] = 1.40*fall
                        position[1] = -.47*fall
                    if name.startswith(('Front', 'Back')):
                        rotation[0] = .55*fall*side
                    if name == 'Head':
                        rotation[0] = -.45*fall
                if clip == 'evolve':
                    gather = math.sin(math.pi*min(1,t/.44))**2 if t < .44 else 0
                    reveal = math.sin(math.pi*min(1,max(0,(t-.28)/.72)))**2
                    settle = soft(.24,.64,t)
                    if name == 'Body':
                        position[1] = .64*reveal - .16*gather
                        rotation[1] = TAU*settle
                        rotation[0] = .19*gather - .16*reveal
                        scale = [ .16+.84*settle ] * 3
                    if name == 'Head':
                        rotation[0] = .19*gather - .44*reveal
                    if name.startswith('Front'):
                        rotation[2] = side*(.99 if bird else .57)*reveal
                        rotation[0] = .35*gather - .46*reveal
                    if name == 'Tail':
                        rotation[2] = .68*reveal
                if clip in ('appear', 'caught'):
                    grow = t*t*(3-2*t)
                    if name == 'Body':
                        size = .09 + .91*(grow if clip == 'appear' else 1-grow)
                        scale = [size, size, size]
                        position[1] = .32*beat
                        rotation[2] = .19*beat
                    if name.startswith('Front'):
                        rotation[0] = -.63*beat
                    if name == 'Head':
                        rotation[0] = -.36*beat
                bone.location = position
                bone.rotation_euler = rotation
                bone.scale = scale
                for prop in ('location', 'rotation_euler', 'scale'):
                    bone.keyframe_insert(prop, frame=frame, group=name)
        track = data.nla_tracks.new()
        track.name = clip
        track.strips.new(clip, 1, action)
        track.mute = True
        data.action = None
    scene.frame_set(1)


COLORS = {
    'turtle': ('73aeb2', '326f79', 'c3e4bd'),
    'dino': ('c25e3c', '733730', 'ffc076'),
    'cat': ('799073', '3e6551', 'e0d5a7'),
    'bird': ('439687', '265b6a', 'd5e9af'),
    'mouse': ('baa479', '6f5749', 'ffe991'),
    'dog': ('a7c5d4', '587c9d', 'ebf6ed'),
}


def export(name, animations=False):
    out = OUT / (name + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=str(out), export_format='GLB', export_animations=animations,
        export_animation_mode='NLA_TRACKS',
    )


def animal(kind, evolved):
    reset()
    base, dark, accent = COLORS[kind]
    skinmat = material('Coat', base)
    darkmat = material('Markings', dark)
    lightmat = material('Crest', accent, .53)
    eye = material('Obsidian eyes', '0e2024', .16)
    iris = material('Iris of the ' + kind, accent, .32, emission=.055)
    glint = material('Eye glints', 'edf7e5', .19, emission=.45)
    rose = material('Ear interior', 'ad787b', .8)
    E = int(evolved)
    height = {'turtle':1.36, 'dino':1.92, 'cat':1.82, 'bird':1.83, 'mouse':1.45, 'dog':1.91}[kind] + .44*E
    chest = height * .50
    front_y, hind_y = -.44, .50
    span = .28 if kind != 'turtle' else .43
    parts = []
    pinned = []
    ell = lambda name, at, scale, mat=skinmat, tilt=0: ovoid(name, at, scale, mat, tilt, .05)
    def fix(obj, bone):
        pinned.append((obj, bone))
        return obj
    def detail(name, at, scale, mat, bone, tilt=0):
        return fix(ell(name, at, scale, mat, tilt), bone)
    def trim(name, sections, mat, bone, sides=12):
        return fix(loft(name, sections, mat, sides, .032, steps=3), bone)

    bodylength = {'turtle':.80, 'dino':.73, 'cat':.69, 'bird':.49, 'mouse':.47, 'dog':.70}[kind]
    width = {'turtle':.56, 'dino':.41, 'cat':.35, 'bird':.37, 'mouse':.36, 'dog':.38}[kind]+.10*E
    headz = height * {'turtle':.53,'dino':.81,'cat':.76,'bird':.75,'mouse':.70,'dog':.75}[kind]
    heady = {'turtle':-.79,'dino':-.58,'cat':-.61,'bird':-.32,'mouse':-.35,'dog':-.66}[kind]
    headw = {'turtle':.29,'dino':.38,'cat':.35,'bird':.32,'mouse':.34,'dog':.32}[kind]+.06*E
    parts.extend([ell('Rib cage', (0,.05,chest), (width,bodylength,chest*.57)),
                  ell('Cranium', (0,heady,headz), (headw,headw*.97,headw*.94)),
                  ell('Neck', (0,heady*.74,(chest+headz)*.5), (width*.61, width*.77, abs(headz-chest)*.51+.19))])
    muzzle_depth = .27 if kind in ('dog','dino','turtle') else .15
    if kind != 'bird':
        parts.append(ell('Muzzle', (0,heady-headw*.70,headz-headw*.26), (headw*.71,muzzle_depth,headw*.48)))
        if kind in ('dog','cat','mouse'):
            detail('Nose', (0,heady-headw*.70-muzzle_depth*.99,headz-headw*.17),(.075,.045,.039),eye,'Head')
    for side, suffix in ((-1,'L'),(1,'R')):
        for key,y in [('Front',front_y),('Back',hind_y)]:
            if kind == 'bird' and key == 'Front':
                continue
            s = (span if kind != 'bird' else .17)*side
            if kind == 'dino' and key == 'Front':
                parts.append(loft('Grasping forelimb', [((s*.77,-.30,chest+.18),.15,.14),
                    ((s,-.54,chest-.03),.079,.088),((s*.83,-.69,chest-.06),.054,.055),
                    ((s*.83,-.76,chest-.09),.022,.030)],skinmat))
                continue
            leg = .145 if kind != 'turtle' else .185
            parts.append(loft('Sculpted leg', [((s*.67,y,chest),leg*1.24,leg),
                ((s,y+.08,chest*.63),leg*.87,leg*.82),((s*1.08,y-.04,.19),leg*.65,leg*.79),
                ((s*1.10,y-.13,.095),leg*.92,leg*1.21),((s*1.1,y-.11,.028),leg*.72,leg*.86)],skinmat))
            if kind in ('bird','turtle','dino','dog'):
                for toe in (-1,0,1):
                    detail('Toe ridge', (s*1.1+toe*leg*.41,y-.25,.063),(.035,.079,.043),lightmat,key+suffix)
        eyex = side * headw*.61
        eyey = heady - headw*.77
        eyez = headz+headw*.16
        detail('Eye socket', (eyex,eyey,eyez),(.088,.043,.068),darkmat,'Head',side*.23)
        detail('Glossy eye', (eyex,eyey-.034,eyez+.002),(.061,.035,.057),eye,'Head',side*.23)
        detail('Iris', (eyex-side*.008,eyey-.066,eyez+.002),(.039,.011,.038),iris,'Head',side*.23)
        detail('Pupil', (eyex-side*.010,eyey-.077,eyez+.002),
               (.011 if kind in ('cat','dino') else .021,.006,.026),eye,'Head',side*.11)
        detail('Glint', (eyex-.014,eyey-.083,eyez+.020),(.010,.005,.010),glint,'Head')
        trim('Sculpted upper eyelid', [((eyex-.083,eyey-.017,eyez-.014),.011,.011),
            ((eyex-.031,eyey-.060,eyez+.055),.014,.013),((eyex+.029,eyey-.063,eyez+.055),.012,.012),
            ((eyex+.082,eyey-.019,eyez-.008),.003,.005)],skinmat,'Head',8)
        if kind in ('cat','dog','mouse'):
            ear = .29 if kind == 'cat' else .43 if kind == 'dog' else .23
            if kind == 'mouse':
                ear += .10*E
                parts.append(ell('Round ear', (side*(headw*.91),heady+.005,headz+headw*.72),
                                 (.185,.107,.212),skinmat,side*.24))
                detail('Inner ear', (side*headw*.97,heady-.083,headz+headw*.74),(.123,.035,.145),rose,'Head',side*.25)
            else:
                tipx = side * (headw + .10 + .17*E)
                tipz = headz+headw*.65 + ear + .09*E
                parts.append(loft('Swept ear', [((side*headw*.58,heady+.03,headz+headw*.54),.154,.124),
                    ((side*headw*.87,heady+.085,headz+headw*.70+ear*.43),.127,.081),
                    ((tipx,heady+.14,tipz),.012,.017)],skinmat))
                trim('Inner ear', [((side*headw*.65,heady-.073,headz+headw*.64),.095,.035),
                    ((side*headw*.87,heady-.012,headz+headw*.71+ear*.44),.085,.038),
                    ((tipx*.97,heady+.103,tipz-.03),.008,.009)],rose,'Head')
    if kind == 'turtle':
        fix(carve_shell(chest, E, darkmat, skinmat, lightmat), 'Body')
        if E:
            for j in range(7):
                x = (j-3)*.143
                trim('Coral shell ridge', [((x,.19,chest+.56),.089,.086),((x*.99,.26,chest+.95-abs(x)*.6),.050,.055),
                    ((x*1.13,.31,chest+1.07-abs(x)*.6),.012,.011)],lightmat,'Body',8)
    if kind == 'dino':
        for j in range(5+3*E):
            y = -.55 + j*(.164 if E else .24)
            z = headz+.17 if j<2 else chest+.43
            trim('Ember dorsal ridge', [((0,y,z),.11,.12),((0,y+.07,z+.14+.16*E),.083,.09),
                ((0,y+.17,z+.29+.28*E),.007,.012)],lightmat,'Head' if j<2 else 'Body',9)
        if E:
            for side in (-1,1):
                trim('Horn', [((side*.25,heady+.12,headz+.22),.11,.10),((side*.39,heady+.22,headz+.44),.063,.061),
                    ((side*.54,heady+.24,headz+.55),.009,.014)],darkmat,'Head')
    if kind == 'cat' and E:
        for j in range(9):
            a = j*TAU/9
            x, y = math.cos(a),math.sin(a)
            trim('Forest crown leaf', [((x*.20,heady+y*.17,headz+.17),.066,.046),((x*.38,heady+y*.26,headz+.37),.10,.048),
                 ((x*.56,heady+y*.38,headz+.53),.011,.008)],lightmat,'Head',9)
    if kind == 'bird':
        trim('Beak', [((0,heady-.20,headz-.01),.145,.105),((0,heady-.40,headz-.05),.089,.061),
            ((0,heady-.54,headz-.114),.014,.015)],lightmat,'Head',13)
        for side, suffix in ((-1,'L'),(1,'R')):
            detail('Wing coverts', (side*.34,.09,chest+.04),(.25,.40,.23),darkmat,'Front'+suffix,side*.32)
            for j in range(7+3*E):
                w = .29+j*.062
                trim('Flight feather', [((side*w,-.13+j*.04,chest+.08+j*.006),.10,.084),
                    ((side*(w+.20+E*.16),.30+j*.06,chest-.06+j*.017),.067,.046),
                    ((side*(w+.24+E*.20),.52+j*.065,chest-.11+j*.022),.014,.012)], lightmat if j%3==0 else skinmat,'Front'+suffix,9)
            trim('Head plume', [((side*.13,heady+.13,headz+.17),.076,.075),((side*.13,heady+.28,headz+.40+E*.13),.068,.047),
                 ((side*.17,heady+.51+E*.19,headz+.48+E*.26),.008,.008)],darkmat,'Head',9)
    tailwidth = {'turtle':.12,'dino':.26,'cat':.15,'bird':.18,'mouse':.084,'dog':.24}[kind] + .05*E
    tailend = {'turtle':.96,'dino':1.52,'cat':1.23,'bird':1.31,'mouse':1.37,'dog':1.26}[kind]+.22*E
    tall = kind in ('cat','dog','mouse')
    trim('Tapered tail', [((0,bodylength*.78,chest*.88),tailwidth,tailwidth),
         ((.09,.89,chest*.94),tailwidth*.94,tailwidth*.80),
         ((.16,tailend*.84,chest + (.30+.28*E if tall else -.10)),tailwidth*.65,tailwidth*.56),
         ((.04,tailend,chest + (.55+.39*E if tall else -.18)),.015,.018)], darkmat, 'Tail', 13)
    if E and kind in ('dog','mouse'):
        for j in range(6):
            y = .10 + j*.125
            trim('Crystal spine', [((0,y,chest+.22),.12,.10),((.034,y+.13,chest+.51),.061,.057),
                 ((.052,y+.24,chest+.68-j*.021),.008,.01)],lightmat,'Body',6)

    if kind in ('cat','dog'):
        for side in (-1,1):
            for i in range(4):
                z = headz - headw*.21 - i*.084
                x = side*(headw*.73-i*.011)
                y = heady+.088+i*.052
                parts.append(loft('Sculpted cheek fur', [((x*.87,y-.083,z+.035),.105,.104),
                    ((x,y,z-.01),.086,.073),((x*1.26,y+.133,z-.11),.016,.018)],
                    skinmat,11,.044,steps=3))
    body = fuse(parts, 'Sculpted continuous anatomy', skinmat, .030)
    body = retopology(body, kind, evolved, skinmat)
    uv_project(body,.72)

    def coat(v):
        base = skinmat.diffuse_color[:3]
        shade = darkmat.diffuse_color[:3]
        accent = lightmat.diffuse_color[:3]
        scale = 1.6 if kind == 'dino' else 2.6
        dapple = noise.noise_vector(Vector((v.x*9, v.y*6, v.z*10)))[0]
        back = soft(chest*.88, chest*1.65, v.z)*soft(heady+.25,.48,v.y)
        belly = (1-soft(chest*.61,chest*1.09,v.z))*soft(.16,.63,-v.y)
        muzzle = soft(-heady+headw*.32,-heady+headw*.83,-v.y)*(1-soft(headz-headw*.18,headz+headw*.05,v.z))
        fringe = max(belly*.73,muzzle*.76)
        if kind == 'cat':
            stripe = (.5+.5*math.sin(v.y*33+abs(v.x)*8+v.z*4))**4
            back += stripe*soft(.12,.31,abs(v.x))*.29
        elif kind in ('mouse','dino'):
            back += soft(.18,.55,dapple)*.22
        style = blend(base, shade, back*.62)
        style = blend(style, accent, fringe)
        ridge = max(0, math.sin(v.y*29 + v.z*36 + v.x*17 + dapple*4))**7
        texture = .20 if kind in ('turtle','dino') else .11
        style = blend(style, accent, ridge*texture*(.35+back*.55))
        return [value*grain(v, 38, .20)*(1+scale*dapple*.06) for value in style]

    pigment(body, skinmat, coat)
    rig = skeleton(kind, height, hind_y, front_y, span, bird=kind=='bird')
    def body_weights(v):
        bone = 'Body'
        strength = 0
        if v.y < heady+.16 and v.z > headz-headw*.5:
            bone = 'Head'
            strength = min(1, max(0,(heady+.16-v.y)*4+(v.z-headz)*2.3+.3))
        elif v.z < chest*.78 and abs(v.x) > span*.46:
            side = 'R' if v.x > 0 else 'L'
            bone = ('Back' if v.y > .07 else 'Front') + side
            strength = min(1, max(0,(chest*.78-v.z)*4))
        return [(bone,strength),('Body',1-strength)]
    skin(body,rig,body_weights)
    for obj,bone in pinned:
        skin(obj,rig,lambda v, bone=bone: [(bone,1)])
    animate(rig,kind)
    export(kind + ('-evolved' if evolved else ''), True)


def person():
    reset()
    cloth = material('Midnight wool', '527e72')
    cloak = material('Russet velvet', '8b342d')
    gold = material('Antique brass', 'e5ac66', .47, .28)
    skinmat = material('Porcelain complexion', 'e6b38f')
    hair = material('Chestnut hair', '3f2525')
    boot = material('Oiled leather', '3c302a')
    gem = material('Ember glass', 'ffad59', .2, emission=1.35)
    white = material('Eye highlight', 'f2e9d9', .25)
    ink = material('Iris', '302d32', .27)
    stitch = material('Woven bronze thread', 'ab8056')
    lip = material('Warm contour', '945a56')
    pinned = []
    def fix(obj, bone='Body'):
        pinned.append((obj,bone))
        return obj
    def ell(name, at, size, mat, bone='Body', twist=0):
        return fix(ovoid(name,at,size,mat,twist,.028),bone)
    def tube(name, sections, mat, bone='Body', sides=16):
        return fix(loft(name,sections,mat,sides,.036,steps=3),bone)
    tube('Woven field coat', [((0,.025,.98),.36,.28),((0,.035,1.18),.35,.24),
         ((0,.018,1.46),.24,.18),((0,.017,1.71),.34,.21),((0,.035,1.84),.40,.20),
         ((0,.025,1.96),.24,.16)],cloth,sides=32)
    tube('Shoulder cape and collar', [((0,.035,1.53),.435,.28),((0,.04,1.68),.46,.25),
         ((0,.05,1.87),.40,.24),((0,.04,2.00),.24,.18)],cloak,sides=32)
    tube('Brass collar trim', [((0,.04,1.966),.258,.189),((0,.04,1.995),.25,.184),((0,.04,2.024),.24,.174)],gold,sides=28)
    tube('Waist belt', [((0,.02,1.365),.282,.20),((0,.02,1.43),.28,.194)],boot,sides=28)
    ell('Cloak clasp', (0,-.213,1.74),(.096,.038,.095),gold)
    ell('Cloak clasp inset', (0,-.247,1.74),(.046,.020,.047),gem)
    ell('Buckle', (.027,-.18,1.395),(.074,.026,.048),gold)
    ell('Pouch', (-.277,-.049,1.20),(.12,.11,.16),boot,twist=.18)
    cape_v, cape_f = [], []
    row_count, width_count = 25, 23
    for i in range(row_count):
        v=i/(row_count-1)
        for j in range(width_count):
            u=(j/(width_count-1)-.5)*2
            width=.31+.24*v+.06*math.sin(v*math.pi)
            x=u*width+.066*v*v
            y=.195+.27*v+.042*math.sin(u*13+v*2)*v-.053*u*u
            z=1.915-1.42*v-.12*math.cos(u*math.pi*.70)*v+.038*math.sin(u*15)*v**5
            cape_v.append((x,y,z))
    for i in range(row_count-1):
        for j in range(width_count-1):
            k=i*width_count+j
            cape_f.append((k,k+1,k+width_count+1,k+width_count))
    cape = mesh('Woven trailing cloak with weighted folds',cape_v,cape_f,[cloak])
    activate(cape)
    thickness = cape.modifiers.new('Double-sided stitched fabric','SOLIDIFY')
    thickness.thickness = .020
    bpy.ops.object.modifier_apply(modifier=thickness.name)
    uv_project(cape,1.10)
    hem=[]
    for j in range(0,width_count,2):
        x,y,z=cape_v[(row_count-1)*width_count+j]
        hem.append(((x,y+.013,z+.014),.012,.010))
    tube('Bound copper cape hem',hem,stitch,'Tail',9)
    for s, suffix in ((-1,'L'),(1,'R')):
        arm = 'Front'+suffix
        leg = 'Back'+suffix
        tube('Sleeve', [((s*.325,.02,1.82),.145,.123),((s*.43,.005,1.66),.123,.101),
              ((s*.52,-.044,1.43),.10,.080),((s*.54,-.11,1.27),.074,.073)], cloth, arm)
        tube('Leather bracer', [((s*.50,-.035,1.45),.103,.087),((s*.54,-.10,1.31),.085,.078),
              ((s*.55,-.12,1.27),.085,.080)], boot, arm)
        palm = ovoid('Palm', (s*.555,-.138,1.204),(.066,.061,.083),skinmat, s*.13)
        hand_parts = [palm]
        for finger in range(4):
            y = -.182 + finger*.023
            z = 1.141 + abs(finger-1)*.012
            hand_parts.append(loft('Finger', [((s*.566,y,z+.047),.022,.018),
                ((s*.581,y,z-.009),.018,.016),((s*.566,y+.008,z-.037),.012,.013)],skinmat,8,steps=2))
        hand_parts.append(loft('Thumb', [((s*.521,-.173,1.246),.035,.024),
             ((s*.499,-.198,1.198),.022,.018),((s*.513,-.208,1.170),.012,.016)],skinmat,10,steps=3))
        fix(fuse(hand_parts, 'Hand with sculpted digits', skinmat, .009),arm)
        tube('Trousers', [((s*.155,.02,1.13),.145,.137),((s*.185,.046,.81),.121,.112),
              ((s*.19,.02,.51),.101,.094),((s*.206,.01,.29),.084,.078)],cloth,leg)
        tube('Soft riding boot', [((s*.19,.025,.52),.113,.11),((s*.21,-.005,.30),.105,.095),
              ((s*.216,-.06,.16),.112,.102),((s*.22,-.19,.10),.118,.083),((s*.22,-.27,.083),.091,.047)],boot,leg)
        ell('Boot stud', (s*.21,-.079,.44),(.042,.022,.025),gold,leg)
        ell('Ivory sclera', (s*.066,-.156,2.232),(.034,.017,.015),white,'Head',s*.09)
        ell('Hazel iris', (s*.063,-.171,2.231),(.015,.007,.013),material('Hazel iris '+suffix,'8f6a46',.29),'Head')
        ell('Pupil', (s*.063,-.176,2.231),(.007,.004,.010),ink,'Head')
        ell('Eye gleam', (s*.063-.004,-.180,2.235),(.0035,.0025,.004),white,'Head')
        tube('Upper eyelid', [((s*.033,-.161,2.228),.002,.003),
             ((s*.062,-.176,2.243),.0055,.004),((s*.089,-.163,2.242),.005,.003),
             ((s*.104,-.143,2.228),.002,.003)],hair,'Head',8)
        for dent in range(3):
            dz=.109+dent*.074
            tube('Boot lace', [((s*.14,-.109,dz),.005,.005),((s*.205,-.136,dz+.022),.007,.006),
                ((s*.259,-.094,dz+.033),.005,.005)],stitch,leg,6)
    for side, suffix in ((-1,'L'),(1,'R')):
        arm, leg = 'Front'+suffix, 'Back'+suffix
        tube('Bound cuff seam', [((side*.519,-.078,1.361),.089,.079),
            ((side*.522,-.085,1.348),.088,.079)],stitch,arm,12)
        tube('Leather boot piping', [((side*.19,.025,.499),.116,.113),
            ((side*.192,.021,.481),.117,.111)],stitch,leg,12)
        tube('Velvet seam', [((side*.387,-.084,1.58),.012,.013),
            ((side*.315,-.175,1.56),.012,.013),((side*.19,-.218,1.55),.012,.013),
            ((side*.05,-.241,1.55),.008,.008)],stitch,sides=8)
        tube('Brow', [((side*.030,-.173,2.271),.0065,.0045),
            ((side*.066,-.167,2.278),.009,.005),((side*.113,-.133,2.271),.004,.003)],hair,'Head',9)
    base=Path(__file__).with_name('reference')/'lio-head.obj'
    face=read_obj(base,'Lio MPFB facial anatomy',skinmat,
        lambda v:(v[0]*2.03, (v[1]+.030)*1.83+.018, 1.923+(v[2]-1.3444258)*.56/.2540483))
    def complexion(v):
        cheek=exp(-((abs(v.x)-.103)/.052)**2-((v.z-2.172)/.050)**2)*soft(.094,.16,-v.y)
        mouth=exp(-(v.x/.070)**4-((v.z-2.107)/.017)**2)*soft(.156,.184,-v.y)
        lipcolor = blend(skinmat.diffuse_color[:3],(.55,.128,.109),mouth*.55)
        return blend(lipcolor,(.66,.238,.137),cheek*.28)
    pigment(face,skinmat,complexion)
    fix(face,'Head')
    ell('Scalp hair mass',(-.010,.005,2.382),(.172,.191,.156),hair,'Head',-.08)
    for j in range(11):
        x=-.130+j*.024
        tilt=abs(x)*.25
        tube('Swept sculpted lock', [((x,.069,2.478-tilt),.036,.029),((x+.021,-.020,2.470-tilt),.042,.027),
            ((x-.040,-.142,2.387-tilt),.031,.022),((x-.068,-.166,2.308-tilt-abs(x)*.12),.006,.008)],hair,'Head',12)
    for side in (-1,1):
        tube('Temple lock', [((side*.132,.011,2.422),.045,.047),((side*.150,-.013,2.280),.046,.036),
             ((side*.135,.050,2.134),.031,.030),((side*.102,.092,2.104),.005,.009)],hair,'Head',13)
    for j in range(11):
        z=2.383-j*.049
        mid=(.088+min(.19,j*.019),.104+j*.013,z)
        a=j*math.pi*.76
        for side in (-1,1):
            r=.043 if j<7 else .030
            tube('Interlaced braid', [((mid[0]-r*side,mid[1],z+.042),r*.81,r*.72),
                ((mid[0]+math.cos(a)*r*side,mid[1]+r*.54,z+.012),r*.84,r*.75),
                ((mid[0]+r*side,mid[1]+.010,z-.019),r*.52,r*.63)],hair,'Head',9)
    for side in (-1,1):
        lapel=[((side*.142,-.112,1.955),.029,.013),((side*.199,-.168,1.845),.032,.019),
            ((side*.151,-.236,1.709),.030,.020),((side*.083,-.175,1.489),.018,.011)]
        tube('Woven collar facing',lapel,stitch,'Body',10)
        for j in range(5):
            phase=j/4
            x=side*(.183-.078*phase)
            y=-.222+.035*phase
            z=1.80-.212*phase
            tube('Hand-finished coat stitch',[((x-.013,y,z+.010),.003,.005),((x+.014,y-.005,z-.019),.003,.005)],gold,'Body',6)
    tube('Carved rowan wand', [((.57,-.09,1.08),.037,.033),((.57,-.17,1.22),.039,.037),
         ((.58,-.40,1.37),.034,.030),((.62,-.56,1.53),.020,.021)],boot,'FrontR',10)
    ell('Ember wand tip', (.62,-.56,1.53),(.054,.05,.065),gem,'FrontR')
    coat_parts = [obj for obj, _ in pinned if obj.name.startswith(('Woven field coat','Sleeve'))]
    hair_parts = [obj for obj, _ in pinned if obj.name.startswith(('Scalp hair','Swept sculpted','Temple lock','Interlaced braid'))]
    pinned = [(obj,bone) for obj,bone in pinned if obj not in coat_parts + hair_parts]
    coat = fuse(coat_parts, 'Tailored coat with joined shoulder topology', cloth,.021)
    hair_mesh = fuse(hair_parts, 'Welded sculpt of swept hair and braid', hair,.012)
    uv_project(coat,.88)
    surface_texture(coat,cloth,68,.35)
    surface_texture(cape,cloak,49,.31)
    for obj,bone in pinned:
        if obj.data.materials[0] in (cloth,cloak,boot):
            uv_project(obj,.74)
    pigment(hair_mesh,hair,lambda v: [
        c*grain(v,83,.24)*(1+.16*math.sin(v.x*185 + v.z*39 + v.y*25))
        for c in hair.diffuse_color[:3]
    ])
    rig = skeleton('Lio',2.46,.02,.0,.19,person=True)
    def coat_skin(v):
        arm = soft(.275,.485,abs(v.x))*soft(1.13,1.37,v.z)
        return [('FrontR' if v.x>0 else 'FrontL',arm),('Body',1-arm)]
    skin(coat,rig,coat_skin)
    skin(cape,rig,lambda v: [('Tail', 1-soft(.50,1.53,v.z)),('Body',soft(.50,1.53,v.z))])
    for obj,bone in [*pinned,(hair_mesh,'Head')]:
        skin(obj,rig,lambda v, bone=bone: [(bone,1)])
    animate(rig,'hero')
    export('hero',True)


def world():
    reset()
    rng = random.Random(8401)
    def uniform(a,b):
        return rng.uniform(a,b)
    bark = material('Alder bark', '897760')
    branch = material('Silver birch bark', 'c2ac8f')
    rock = material('Weathered slate', 'a8b1ad')
    moss = material('Soft lichen', 'a8ab72')
    leaves = [material('Canopy '+str(i), color) for i,color in enumerate(('264f47','346654','587453','808858','3a6766'))]
    flower = [material('Meadow bloom '+str(i),c,.8,emission=.20) for i,c in enumerate(('d9bf85','bac5d5','c5967d'))]
    soil = material('Meadow soil', 'ffffff')
    nodes = soil.node_tree.nodes
    color = nodes.new('ShaderNodeVertexColor')
    color.layer_name = 'Moss'
    soil.node_tree.links.new(color.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
    water = material('Moonstone pool','4d9094',.27,.18,.07)
    rune = material('Moon runes','a9dcce',.32,0,.42)

    def p(x,z,h):
        return (x,-z,h)

    verts, faces = [], []
    nx, nz = 98, 76
    for i in range(nz+1):
        for j in range(nx+1):
            x = (j/nx-.5)*65
            z = (i/nz-.5)*50
            detail = noise.fractal(Vector((x*.17,z*.17,.85)),1.15,2,3)
            side = min(1,max(0,(max(abs(x)-12,abs(z)-8))/10))
            verts.append(p(x,z,-.075+detail*(.06+side*1.9)+side*.29))
    for i in range(nz):
        for j in range(nx):
            k = i*(nx+1)+j
            faces.append((k,k+nx+1,k+nx+2,k+1))
    ground = mesh('Sculpted moss clearing',verts,faces,[soil])
    colors = ground.data.color_attributes.new('Moss','BYTE_COLOR','POINT')
    layout = json.loads((OUT / 'layout.json').read_text())
    locations = layout['waypoints']
    camp, glade, ruin = (locations[k] for k in ['camp','glade','ruin'])
    def track(x, z):
        def distance_to(a, b):
            dx,dz = b['x']-a['x'],b['z']-a['z']
            t = min(1,max(0,((x-a['x'])*dx+(z-a['z'])*dz)/(dx*dx+dz*dz)))
            bend = math.sin(t*math.pi)*.92
            return math.hypot(x-a['x']-t*dx,z-a['z']-t*dz-bend)
        return min(distance_to(camp,glade),distance_to(glade,ruin))

    for i,v in enumerate(verts):
        x, z = v[0], -v[1]
        broad = noise.fractal(Vector((x*.24,z*.18,.61)),.85,2,3)
        grain = noise.noise_vector(Vector((x*1.9,z*1.9,1.31)))[0]
        trail = max(0,1-(track(x,z)+grain*.17)/1.7)**.82
        f = broad*.055+grain*.026
        colors.data[i].color = (.23 + f*1.8 + trail*.245,.32 + f*1.8 + trail*.105,.175 + f*1.1 + trail*.073,1)

    def lump(name,x,z,h,sx,sz,sy,mat=rock,rows=9,sides=16):
        return ovoid(name,p(x,z,h),(sx,sz,sy),mat,uniform(-.21,.21),.29,rows,sides)

    for obstacle in layout['obstacles']:
        x,z,r,h = (obstacle[key] for key in ['x','z','radius','height'])
        def shale(px,py,pz):
            height=pz/h
            distortion=noise.noise_vector(Vector((px*1.83,py*2.01,pz*3.2)))[0]
            shelf=math.sin((height+.05*px)*30+.4*py)**5
            return (px+distortion*.084+shelf*.051,py+distortion*.062, pz+shelf*.031)
        ovoid('Weathered boulder strata',p(x,z,h*.38),(r*.94,r*.91,h*.64),rock,
              uniform(-.25,.25),.24,15,31,sculpt=shale)
        for strip in range(5):
            a=TAU*strip/5+.19
            lump('Lichen clump',x+math.cos(a)*r*.48,z+math.sin(a)*r*.51,
                 h*(.80+.065*math.sin(a)),r*.42,r*.30,h*.11,moss,8,17)
        for _ in range(5):
            angle = uniform(0,TAU)
            size = uniform(.12,.34)
            lump('Eroded fragments',x+r*.83*math.cos(angle),z+r*.83*math.sin(angle),.10,size,size,.19)

    for i in range(62):
        angle=uniform(0,TAU)
        ellipse=1+uniform(0,.83)
        x=math.cos(angle)*14.0*ellipse
        z=math.sin(angle)*12.35*ellipse
        height=uniform(3.2,7.4)
        radius=uniform(.15,.39)
        bend=uniform(-.64,.64)
        trunkmat = bark if i%9 else branch
        loft('Fluted alder trunk',[(p(x,z,-.22),radius*1.54,radius*1.33),
             (p(x+.10,z,height*.17),radius*.95,radius*.91),
             (p(x+bend*.29,z+.15,height*.40),radius*.78,radius*.68),
             (p(x+bend*.68,z+.12,height*.66),radius*.52,radius*.50),
             (p(x+bend,z+.15,height*.96),radius*.10,radius*.11)],trunkmat,14,.18)
        for j in range(4):
            a=TAU*j/4+angle
            endx=x+math.cos(a)*radius*3
            endz=z+math.sin(a)*radius*3
            loft('Exposed root',[(p(x,z,.33),radius*.57,radius*.65),
                 (p((x+endx)/2,(z+endz)/2,.10),radius*.32,radius*.26),(p(endx,endz,-.08),.017,.016)],
                 trunkmat,8,.14)
        for j in range(5):
            a=TAU*j/5+angle
            r=uniform(.75,2.10)
            bx=x+math.cos(a)*r+bend*.54
            bz=z+math.sin(a)*r
            by=height*uniform(.58,.99)
            loft('Forked branch',[(p(x+bend*.27,z,height*.42),radius*.50,radius*.40),
                 (p((x+bx)/2,(z+bz)/2,by*.89),radius*.27,radius*.26),(p(bx,bz,by),.022,.024)],trunkmat,8,.13)
            for k in range(3):
                size=uniform(.56,1.39)
                lump('Alder leaf mass',bx+uniform(-.60,.60),bz+uniform(-.6,.6),by+uniform(-.25,.55),
                     size*1.34,size,uniform(.43,.92),leaves[(i+j+k)%len(leaves)],6,9)

    for i in range(190):
        x,z=uniform(-27,27),uniform(-17,17)
        if abs(z+.30*x)<1.3 or (abs(x)<10 and abs(z)<7.5 and i%4):
            continue
        size=uniform(.13,.51)
        if i%6==0:
            lump('Meadow stones',x,z,size*.13,size,size*.72,size*.77)
            continue
        for j in range(5):
            a=uniform(0,TAU)
            r=uniform(.16,.47)*size*1.8
            tipx,tipz=x+math.cos(a)*r,z+math.sin(a)*r
            loft('Sedge blade',[(p(x,z,-.05),.021,.019),(p((tipx+x)/2,(tipz+z)/2,size*.53),.031,.014),
                 (p(tipx,tipz,size),.004,.003)],leaves[i%len(leaves)],5)
            if i%4==0 and j%2==0:
                lump('Wildflower',tipx,tipz,size,.059,.042,.039,flower[i%3])

    for _ in range(230):
        x,z=uniform(-14,14),uniform(-9,9)
        if track(x,z) < .32 and rng.random() < .68:
            continue
        size=uniform(.025,.09)
        if rng.random() < .35:
            lump('Alder litter',x,z,-.026,size,size*.49,.014,leaves[rng.randrange(len(leaves))],4,6)
        else:
            lump('Shallow slate gravel',x,z,-.034,size,size*.58,size*.47,moss,4,6)
    for i in range(36):
        x,z=uniform(-12,12),uniform(-8,8)
        if track(x,z) < 1.15:
            continue
        for j in range(6):
            a = TAU*j/6 + i
            r = uniform(.04,.23)
            height = uniform(.09,.35)
            tx,tz=x+math.cos(a)*r,z+math.sin(a)*r
            loft('Meadow grass sprig',[(p(x,z,-.09),.019,.013),
                (p((x+tx)/2,(z+tz)/2,height*.52),.019,.010),(p(tx,tz,height),.002,.001)],
                leaves[i%len(leaves)],5)

    fern_green=material('Fern leaf veins','829c63',.74)
    fern_shade=material('Fern leaf shadow','3e674b',.79)
    twig=material('Fern stem','6c6743',.72)
    def sprig(x,z,span,count):
        verts, faces = [], []
        for i in range(count):
            a=TAU*i/count+uniform(-.23,.23)
            d=Vector((math.cos(a),math.sin(a),0))
            side=Vector((-d.y,d.x,0))
            root=Vector(p(x,z,-.07))
            for j in range(2,9):
                t=j/10
                center=root+Vector((d.x,d.y,0))*span*t+Vector((0,0,span*(.10+.41*math.sin(t*2.1))))
                width=span*(1-t*.76)*.20
                for sign in (-1,1):
                    lead=center+side*sign*width*.88+d*width*.82
                    k=len(verts)
                    verts += [center-d*.018,center+d*width*.70,lead+d*.037,lead+side*sign*.035,lead-d*.031]
                    faces.append((k,k+1,k+2,k+3,k+4))
            loft('Bending fern stem',[(root,.024,.014),(root+d*span*.31+Vector((0,0,span*.33)),.013,.008),
                (root+d*span+Vector((0,0,span*.40)),.004,.003)],twig,6,steps=4)
        fern=mesh('Clump of individually modelled fern leaflets',verts,faces,[fern_green,fern_shade])
        for j,poly in enumerate(fern.data.polygons):
            poly.material_index=(j//2+j%2)%2
        for m in fern.data.materials:
            m.use_backface_culling=False

    for obs in layout['obstacles']:
        x,z,r = (obs[k] for k in ('x','z','radius'))
        for k in range(3):
            a=uniform(0,TAU)
            sprig(x+math.cos(a)*r*1.04,z+math.sin(a)*r*.94,uniform(.38,.69),4)
    for i in range(34):
        side = 1 if i%2 else -1
        x=uniform(-15,15)
        z=side*uniform(8.8,13.4)
        sprig(x,z,uniform(.46,1.12),5)
    # An eroded moon gate, individual carved voussoirs, and a low spring basin.
    ax, az = ruin['x'], ruin['z'] - 1.5
    for side in (-1,1):
        for j in range(5):
            lump('Moon gate upright',ax+side*1.34,az,.29+j*.46,.37,.49,.31,rock)
    for j in range(10):
        a=math.pi*j/9
        if j!=7:
            lump('Moon gate voussoir',ax+1.34*math.cos(a),az,2.13+1.35*math.sin(a),.33,.42,.29,rock)
    sx,sz=camp['x']-1.3,camp['z']+1.5
    for j in range(14):
        angle=TAU*j/14
        lump('Spring rim',sx+math.cos(angle)*1.27,sz+math.sin(angle)*.91,.095,.28,.25,.23,moss if j%3==0 else rock)
    lump('Still spring water',sx,sz,.026,1.22,.82,.033,water)
    for j in range(5):
        lump('Moon quartz',sx-.5+j*.22,sz+.28,.17,.089,.059,.22,rune)

    # A carved market stall and the low creek, positioned beside their map markers.
    shop = locations['market']
    creek = locations['creek']
    sx,sz=shop['x'],shop['z']+3.0
    cloth = material('Faded ochre linen','93693c')
    timber = material('Oil-rubbed rowan','604a3a')
    for dx in (-.93,.93):
        for dz in (-.45,.45):
            loft('Stall post with carved knots', [(p(sx+dx,sz+dz,-.10),.10,.105),
                (p(sx+dx+.022,sz+dz,.82),.085,.079),(p(sx+dx-.022,sz+dz,1.98),.070,.068)],timber,11,.10,steps=3)
    loft('Counter hewn from rowan', [(p(sx,sz,.63),.95,.52),(p(sx,sz,.76),.99,.54)],timber,22,.055)
    roof = [p(sx+(i/21-.5)*2.55,sz+(j/5-.5)*1.75, 1.94+math.sin(j/5*math.pi)*.36-.07*math.sin(i*.74+j*.72))
            for j in range(6) for i in range(22)]
    roof_faces = [(a,a+22,a+23,a+1) for j in range(5) for i in range(21) for a in [j*22+i]]
    roof_mesh = mesh('Linen awning with draped hem',roof,roof_faces,[cloth])
    activate(roof_mesh)
    solid = roof_mesh.modifiers.new('Woven canopy thickness','SOLIDIFY')
    solid.thickness=.024
    bpy.ops.object.modifier_apply(modifier=solid.name)
    cx,cz=creek['x']-1.6,creek['z']-4.2
    for j in range(18):
        a=TAU*j/18
        lump('Creekbank rubble',cx+2.05*math.cos(a),cz+.65*math.sin(a),.03,.31,.24,.18,moss if j%3==0 else rock)
    lump('Shallow creek water',cx,cz,.005,2.02,.61,.037,water)

    # Batch static meshes across the clearing for a single draw per material.
    groups = {}
    material_uv = {soil.name:(6.9,'ground'),rock.name:(1.8,'box'),moss.name:(1.1,'box'),
        bark.name:(1.45,'trunk'),branch.name:(1.65,'trunk'),timber.name:(1.0,'trunk'),
        cloth.name:(.72,'box'),water.name:(3.0,'ground')}
    for obj in list(bpy.context.scene.objects):
        key = obj.data.materials[0].name
        if key in material_uv:
            uv_project(obj,*material_uv[key])
        groups.setdefault(key,[]).append(obj)
    for objs in groups.values():
        if len(objs)<2:
            continue
        activate(objs[0])
        for obj in objs:
            obj.select_set(True)
        bpy.ops.object.join()
    export('world')


if __name__ == '__main__':
    import sys
    selected = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    for kind in COLORS:
        if not selected or kind in selected:
            for stage in (False, True):
                animal(kind,stage)
    if not selected or 'hero' in selected:
        person()
    if not selected or 'world' in selected:
        world()
