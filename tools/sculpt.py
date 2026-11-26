"""Author and export the original Fairyland meshes and authored action curves in Blender."""
import json
import math
import random
from pathlib import Path

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


def ovoid(name, at, scale, mat, twist=0, rough=0, rows=13, sides=24):
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
            verts.append((at[0] + x * growth, at[1] + v.y * growth, at[2] + z * growth))
    faces = []
    for i in range(rows):
        for j in range(sides):
            a, b = i*sides + j, i*sides + (j+1)%sides
            faces.append((a, a+sides, b+sides, b))
    return mesh(name, verts, faces, [mat])


def loft(name, sections, mat, sides=12, ripple=0):
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
            wobble = 1 + ripple * (math.cos(angle*5 + index*.37) + .4*math.sin(angle*3-index))
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
    specs = {
        'idle': (60, True), 'walk': (26, True), 'attack': (27, False), 'skill': (38, False),
        'hit': (19, False), 'death': (36, False), 'summon': (42, False),
        'capture': (43, False), 'appear': (32, False), 'caught': (34, False),
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
                        rotation[0] = (.54 if not bird else .38)*wave*side*(-1 if name.startswith('Back') else 1)
                        if bird and name.startswith('Front'):
                            rotation[2] = .46*wave*side
                    if name == 'Body':
                        position[1] = .09*abs(wave)
                        rotation[2] = .045*wave
                    if name == 'Head':
                        rotation[0] = .11*wave
                    if name == 'Tail':
                        rotation[2] = .30*wave
                if clip in ('attack', 'skill', 'summon', 'capture'):
                    strike = math.sin(t*TAU - .55) + math.sin(.55)
                    if name == 'Body':
                        rotation[0] = (.25 if clip == 'attack' else -.16)*strike
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
    eye = material('Obsidian eyes', '14282b', .21)
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
        return fix(loft(name, sections, mat, sides, .032), bone)

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
            for side in (-1,1):
                detail('Cream muzzle', (side*headw*.29,heady-headw*.70-muzzle_depth*.74,headz-headw*.33),
                       (headw*.42,.10,.104),lightmat,'Head')
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
        detail('Eye socket', (eyex,eyey,eyez),(.095,.064,.101),darkmat,'Head',side*.19)
        detail('Glossy eye', (eyex,eyey-.033,eyez+.002),(.064,.043,.073),eye,'Head',side*.19)
        detail('Glint', (eyex-.018,eyey-.067,eyez+.025),(.018,.011,.018),glint,'Head')
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
            detail('Cream chest', (side*.10,heady*.73-.15,chest+.07), (.18,.16,.27+E*.09),lightmat,'Body',side*.13)
    if kind == 'turtle':
        detail('Shell dome', (0,.13,chest+.16),(.64+.20*E,.76+.14*E,.50+.12*E),darkmat,'Body')
        for j in range(9 if E else 7):
            angle = TAU*j/(9 if E else 7)
            x, y = math.cos(angle), math.sin(angle)
            detail('Shell scute', (x*(.38+.07*E),.13+y*(.43+.06*E),chest+.52+.10*E),
                   (.17+.03*E,.18,.11),skinmat,'Body',x*.42)
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

    body = fuse(parts, 'Sculpted continuous anatomy', skinmat, .060)
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
    cloth = material('Midnight wool', '2f4d52')
    cloak = material('Russet velvet', '944534')
    gold = material('Antique brass', 'e5ac66', .47, .28)
    skinmat = material('Porcelain complexion', 'eac2a4')
    hair = material('Chestnut hair', '552e2c')
    boot = material('Oiled leather', '402f30')
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
        return fix(loft(name,sections,mat,sides,.024),bone)
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
    tail = [((0,.16,1.80),.28,.075),((0,.28,1.58),.35,.060),((0,.36,1.19),.41,.055),
            ((0,.46,.79),.39,.039),((.04,.51,.63),.34,.027)]
    tube('Trailing cloak with curved hem',tail,cloak,sides=27)
    for s, suffix in ((-1,'L'),(1,'R')):
        arm = 'Front'+suffix
        leg = 'Back'+suffix
        tube('Sleeve', [((s*.325,.02,1.82),.145,.123),((s*.43,.005,1.66),.123,.101),
              ((s*.52,-.044,1.43),.10,.080),((s*.54,-.11,1.27),.074,.073)], cloth, arm)
        tube('Leather bracer', [((s*.50,-.035,1.45),.103,.087),((s*.54,-.10,1.31),.085,.078),
              ((s*.55,-.12,1.27),.085,.080)], boot, arm)
        ell('Hand', (s*.56,-.14,1.19),(.069,.074,.10),skinmat,arm,.12*s)
        tube('Trousers', [((s*.155,.02,1.13),.145,.137),((s*.185,.046,.81),.121,.112),
              ((s*.19,.02,.51),.101,.094),((s*.206,.01,.29),.084,.078)],cloth,leg)
        tube('Soft riding boot', [((s*.19,.025,.52),.113,.11),((s*.21,-.005,.30),.105,.095),
              ((s*.216,-.06,.16),.112,.102),((s*.22,-.19,.10),.118,.083),((s*.22,-.27,.083),.091,.047)],boot,leg)
        ell('Boot stud', (s*.21,-.079,.44),(.042,.022,.025),gold,leg)
        ell('Ear', (s*.217,-.058,2.135),(.055,.049,.089),skinmat,'Head',s*.19)
        ell('Study of hair', (s*.19,.034,2.24),(.103,.19,.25),hair,'Head',s*.22)
        ell('Eye', (s*.088,-.268,2.165),(.042,.019,.034),ink,'Head')
        ell('Eye gleam', (s*.088-.009,-.285,2.174),(.012,.007,.012),white,'Head')
    for side, suffix in ((-1,'L'),(1,'R')):
        arm, leg = 'Front'+suffix, 'Back'+suffix
        tube('Bound cuff seam', [((side*.519,-.078,1.361),.089,.079),
            ((side*.522,-.085,1.348),.088,.079)],stitch,arm,12)
        tube('Leather boot piping', [((side*.19,.025,.499),.116,.113),
            ((side*.192,.021,.481),.117,.111)],stitch,leg,12)
        tube('Velvet seam', [((side*.387,-.084,1.58),.012,.013),
            ((side*.315,-.175,1.56),.012,.013),((side*.19,-.218,1.55),.012,.013),
            ((side*.05,-.241,1.55),.008,.008)],stitch,sides=8)
        tube('Brow', [((side*.036,-.268,2.225),.008,.007),
            ((side*.089,-.261,2.232),.012,.011),((side*.128,-.238,2.221),.005,.005)],hair,'Head',8)
    ell('Mouth contour', (0,-.255,2.059),(.044,.013,.009),lip,'Head')
    ell('Face planes', (0,-.055,2.15),(.222,.217,.264),skinmat,'Head')
    ell('Nose bridge', (0,-.268,2.114),(.055,.066,.052),skinmat,'Head')
    ell('Hair cap', (-.029,.028,2.30),(.244,.217,.21),hair,'Head',-.24)
    for j in range(5):
        x = -.146+j*.060
        tube('Swept fringe', [((x,.008,2.41),.069,.064),((x+.019,-.157,2.36),.073,.068),
              ((x-.021,-.225,2.28-abs(x)*.16),.046,.056),((x-.065,-.217,2.22-abs(x)*.45),.009,.012)],hair,'Head',11)
    for j in range(3):
        y = .131+j*.033
        tube('Loose braid', [((.11,y,2.30),.108,.087),((.20,y+.02,2.075),.082,.077),
             ((.26,y+.038,1.99),.063,.056),((.25,y+.023,1.87),.031,.036)],hair,'Head',12)
    tube('Carved rowan wand', [((.57,-.09,1.08),.037,.033),((.57,-.17,1.22),.039,.037),
         ((.58,-.40,1.37),.034,.030),((.62,-.56,1.53),.020,.021)],boot,'FrontR',10)
    ell('Ember wand tip', (.62,-.56,1.53),(.054,.05,.065),gem,'FrontR')
    rig = skeleton('Lio',2.46,.02,.0,.19,person=True)
    for obj,bone in pinned:
        skin(obj,rig,lambda v, bone=bone: [(bone,1)])
    animate(rig,'hero')
    export('hero',True)


def world():
    reset()
    rng = random.Random(8401)
    def uniform(a,b):
        return rng.uniform(a,b)
    bark = material('Alder bark', '384944')
    branch = material('Silver birch bark', '51625e')
    rock = material('Weathered slate', '536466')
    moss = material('Soft lichen', '657857')
    leaves = [material('Canopy '+str(i), color) for i,color in enumerate(('1f3e3b','2c4e44','3c5e4b','526b4d','24444a'))]
    flower = [material('Meadow bloom '+str(i),c,.8,emission=.20) for i,c in enumerate(('d9bf85','bac5d5','c5967d'))]
    soil = material('Meadow soil', 'ffffff')
    nodes = soil.node_tree.nodes
    color = nodes.new('ShaderNodeVertexColor')
    color.layer_name = 'Moss'
    soil.node_tree.links.new(color.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
    water = material('Moonstone pool','427f87',.33,.18,.20)
    rune = material('Moon runes','a9dcce',.32,0,.42)

    def p(x,z,h):
        return (x,-z,h)

    verts, faces = [], []
    nx, nz = 78, 60
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
        colors.data[i].color = (.046 + f*.95 + trail*.105,.095 + f + trail*.052,.063 + f*.56 + trail*.013,1)

    def lump(name,x,z,h,sx,sz,sy,mat=rock,rows=9,sides=16):
        return ovoid(name,p(x,z,h),(sx,sz,sy),mat,uniform(-.21,.21),.29,rows,sides)

    for obstacle in layout['obstacles']:
        x,z,r,h = (obstacle[key] for key in ['x','z','radius','height'])
        lump('Sculpted cover boulder',x,z,h*.36,r*.91,r*.91,h*.68)
        lump('Moss saddle',x-r*.15,z+.10,h*.79,r*.78,r*.72,h*.28,moss)
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

    # Batch static meshes across the clearing for a single draw per material.
    groups = {}
    for obj in list(bpy.context.scene.objects):
        groups.setdefault(obj.data.materials[0].name,[]).append(obj)
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
