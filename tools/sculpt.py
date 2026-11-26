"""Author and export the original Fairyland meshes and authored action curves in Blender."""
import json
import math
import os
import subprocess
import random
import sys
from pathlib import Path
from math import exp

import bpy
from mathutils import Vector, noise
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from idle_behaviors import CLIPS, pose as idle_pose

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
    obj = mesh(name, verts, faces, [mat])
    obj.data.validate(clean_customdata=False)
    return obj


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
    subprocess.run([binary,'-t','2','-d','-D','-f',str(6550 if evolved else 5350),
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


def face_surface(obj):
    return BVHTree.FromPolygons([v.co for v in obj.data.vertices],
                               [tuple(p.vertices) for p in obj.data.polygons])


def carve_sockets(obj, frames, depth):
    surface = face_surface(obj)
    for x,z,width,height,slant in frames:
        front, _, _, _ = surface.ray_cast((x,-4,z),(0,1,0))
        if front is None:
            continue
        for vert in obj.data.vertices:
            v = vert.co
            if abs(v.x-x) > width*1.8 or abs(v.z-z) > height*2.4 or v.y > front.y+width*.9:
                continue
            radius = math.hypot((v.x-x)/width, (v.z-z-(v.x-x)*slant)/height)
            v.y += depth * exp(-1.7*radius**2)
    obj.data.update()


EYE_STYLES = {
    'turtle': (.236,.106,.035,.18,1.34,2.94,3.0,.45,(.20,.53,.37),(.108,.138,.115)),
    'dino':   (.231,.133,.36,.43,4.45,1.03,1.24,.85,(.88,.30,.047),(.18,.093,.059)),
    'cat':    (.265,.139,.30,.63,5.88,.97,1.14,.83,(.55,.67,.111),(.22,.23,.115)),
    'bird':   (.182,.189,.08,.07,1.60,1.59,1.43,.64,(.60,.244,.705),(.172,.084,.241)),
    'mouse':  (.210,.194,.11,.06,.93,1.01,1.45,.16,(.295,.147,.080),(.169,.094,.087)),
    'dog':    (.244,.135,.02,.27,1.65,1.37,1.64,.83,(.19,.53,.88),(.52,.60,.66)),
    'hero':   (.0,.0,.0,.31,2.16,1.74,2.0,.82,(.34,.19,.068),(.61,.57,.50)),
}


def inset_eye(surface, frame, shell, skin_color, species):
    """Contour each cornea against the final sculpt, with pigment on a single surface."""
    cx, cz, width, height, slant = frame
    _,_,_,almond,pupil_x,pupil_y,iris_x,iris_gain,iris,white = EYE_STYLES[species]
    count, rings = 40, 15
    verts, faces, colors = [], [], []
    for i in range(rings+1):
        r = max(.001,i/rings)
        for j in range(count):
            angle = TAU*j/count
            u, v = r*math.cos(angle),r*math.sin(angle)
            x = cx+width*u
            z = cz+height*v*(1-almond+almond*abs(math.sin(angle)))+width*u*slant
            z -= height*.12*u*u*(1 if species=='turtle' else 0)
            hit, _, _, _ = surface.ray_cast((x,-4,z),(0,1,0))
            if hit is None:
                raise ValueError('Eye contour lies outside the sculpt')
            depth = .002 + width*.13*(1-r*r)
            verts.append((x,hit.y-depth,z))
            iris_r = math.hypot((u+.065)*iris_x,(v+.015)*1.04)
            pupil_r = math.hypot((u+.065)*pupil_x,(v+.015)*pupil_y)
            rim = soft(.54,.82,iris_r)
            color = blend((.025,.020,.024),iris,iris_gain)
            color = blend(color,(.012,.017,.023),rim*.82)
            rays = .50+.50*math.sin(math.atan2(v+.015,u+.065)*19)
            color = blend(color,(.62,.48,.27),rays*.17*(1-rim))
            color = blend((.006,.009,.014),color,soft(.51,.69,pupil_r))
            color = blend(color,white,soft(.80,.99,iris_r))
            shade = .74 if species=='turtle' else .45
            color = [c*(1-soft(.19,.94,v)*shade) for c in color]
            gloss = .17 if species=='mouse' else .096
            shine = exp(-((u+.30)/gloss)**2-((v-.38)/(gloss*1.2))**2)
            pin = exp(-((u-.32)/.061)**2-((v+.28)/.104)**2)
            color = blend(color,(.87,.96,1),max(shine,pin*.45))
            skin = skin_color(hit)
            liner = blend(skin,(.021,.013,.019),.80 if v>0 else .54)
            color = blend(color,liner,soft(.81,.94,r))
            colors.append(blend(color,skin,soft(.94,1,r)))
    for i in range(rings):
        for j in range(count):
            a, b = i*count+j, i*count+(j+1)%count
            faces.append((a,a+count,b+count,b))
    eye = mesh('Cornea seated in sculpted eyelid',verts,faces,[shell])
    layer = eye.data.color_attributes.new('Eye pigments','BYTE_COLOR','POINT')
    nodes = shell.node_tree.nodes
    if not any(n.type == 'VERTEX_COLOR' for n in nodes):
        paint = nodes.new('ShaderNodeVertexColor')
        paint.layer_name = layer.name
        shell.node_tree.links.new(paint.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
    for i, color in enumerate(colors):
        layer.data[i].color = (*(min(1,max(0,c)) for c in color),1)
    return eye


def grain(v, scale, amount):
    return 1 + noise.noise_vector(v * scale + Vector((.197, .819, 1.421)))[0] * amount


def surface_texture(obj, mat, scale, strength):
    pigment(obj, mat, lambda v: [c*grain(v, scale, strength) for c in mat.diffuse_color[:3]])


def feather(name, root, tip, width, mat, roll=.05):
    start, end = Vector(root), Vector(tip)
    line = end - start
    lateral = Vector((-line.y,line.x,.07)).normalized()
    verts, faces = [], []
    for i in range(11):
        t = i/10
        breadth = width*max(.035,math.sin(math.pi*t)**.64)*(1-.24*t)
        center = start+line*t + Vector((0,0,roll*math.sin(t*math.pi)))
        for side in (-1,0,1):
            verts.append(center+lateral*(breadth*side)-Vector((0,0,abs(side)*breadth*.38)))
        if i:
            k = (i-1)*3
            faces.extend([(k,k+3,k+4,k+1),(k+1,k+4,k+5,k+2)])
    vane = mesh(name,verts,faces,[mat])
    activate(vane)
    thickness = vane.modifiers.new('Folded feather vanes','SOLIDIFY')
    thickness.thickness=.008
    bpy.ops.object.modifier_apply(modifier=thickness.name)
    uv_project(vane,.45)
    return vane


def shell_layers(height, evolved, frame_mat, plastron_mat):
    width, depth = .66+.21*evolved,.78+.17*evolved
    edge = []
    for i in range(89):
        a = i*TAU/88
        edge.append(((width*.99*math.cos(a),.13+depth*.99*math.sin(a),
                      height+.026+.023*math.cos(a*7)),.075,.052))
    rim = loft('Continuous carapace lip',edge,frame_mat,10,.018)
    uv_project(rim,.76)
    lower = ovoid('Warm curved plastron beneath shell',(0,.13,height*.83),
                  (width*.92,depth*.92,.235+.08*evolved),plastron_mat, .0,.042,19,40)
    uv_project(lower,.73)
    return rim,lower


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
    uv_project(shell,.87)
    def scute_color(p):
        u,v = p.x/width,(p.y-.13)/depth
        radius = math.hypot(u,v)
        t = relief(u,v)
        paint = blend(dark.diffuse_color[:3], base.diffuse_color[:3], t*.72)
        paint = blend(paint, accent.diffuse_color[:3], .45*soft(.62,.98,radius))
        streak = .91 + math.sin(91*radius+math.cos(u*8))*t*.065
        return [c*grain(p, 57, .17)*streak for c in paint]
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
    if name in ('dog','cat'):
        bone('TailTip',(.11,.91,chest+.16),(.11,1.35,chest+.55),'Tail')
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
            leg = key+side
            if name in ('dog','cat'):
                knee = (sign*span, y+(.154 if key=='Front' else -.149), chest*.56)
                ankle = (sign*span, y-.114, .107)
                bone(leg,p,knee,'Body')
                bone('Shin'+leg,knee,ankle,leg)
                bone('Paw'+leg,ankle,(sign*span,y-.232,.044),'Shin'+leg)
            else:
                bone(leg, p, tip, 'Body')
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig


def animate(rig, style):
    gait, lift, strike_gain, walk_time = {
        'hero': (.54,.072,1.0,27), 'turtle': (.32,.035,.76,39), 'dino': (.55,.080,1.27,31),
        'cat': (.61,.087,1.12,23), 'bird': (.36,.163,.86,25), 'mouse': (.71,.142,.69,20),
        'dog': (.58,.094,1.12,26),
    }[style]
    specs = {
        'idle': (147, True), 'walk': (walk_time, True), 'attack': (27, False), 'skill': (38, False),
        'hit': (19, False), 'death': (36, False), 'summon': (42, False),
        'capture': (43, False), 'appear': (32, False), 'caught': (34, False), 'evolve': (63, False),
    }
    specs.update({name: (frames, False) for name, frames in CLIPS[style].items()})
    scene = bpy.context.scene
    scene.render.fps = 30
    bird = style == 'bird'
    person = style == 'hero'
    data = rig.animation_data_create()
    for clip, (duration, _) in specs.items():
        action = bpy.data.actions.new(clip)
        data.action = action
        resting = clip.startswith('idle')
        samples = 36 if resting and clip != 'idle' else 8
        for step in range(samples+1):
            t = step / samples
            frame = 1 + round(t * duration)
            if resting:
                idle_pose(rig,style,clip,t)
                for bone in rig.pose.bones:
                    for prop in ('location', 'rotation_euler', 'scale'):
                        bone.keyframe_insert(prop, frame=frame, group=bone.name)
                continue
            wave = math.sin(t * TAU)
            beat = math.sin(t * math.pi)
            for bone in rig.pose.bones:
                name = bone.name
                side = -1 if name.endswith('L') else 1
                bone.rotation_mode = 'XYZ'
                rotation = [0, 0, 0]
                position = [0, 0, 0]
                scale = [1, 1, 1]
                if clip == 'walk':
                    if name.startswith(('Front', 'Back')):
                        rotation[0] = gait*wave*side*(-1 if name.startswith('Back') else 1)
                        if bird and name.startswith('Front'):
                            rotation[2] = .46*wave*side
                    if name.startswith('Shin'):
                        swing = wave*side*(-1 if name.startswith('ShinBack') else 1)
                        rotation[0] = max(0,swing)*(.65 if name.startswith('ShinBack') else -.46)
                    if name.startswith('Paw'):
                        rotation[0] = -.27*wave*side
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


def export(name, animations=False, selected=False):
    out = OUT / (name + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=str(out), export_format='GLB', export_animations=animations,
        export_animation_mode='NLA_TRACKS', use_selection=selected,
    )


def animal(kind, evolved):
    reset()
    base, dark, accent = COLORS[kind]
    surface_type = 'scales' if kind in ('dino','turtle') else 'plume' if kind=='bird' else 'fur'
    skinmat = material('Coat '+surface_type, base, {'scales': .55, 'plume': .63, 'fur': .72}[surface_type])
    darkmat = material('Markings', dark)
    lightmat = material('Crest', accent, .53)
    broadbill = material('Horn beak upper', 'd4ab6f', .48) if kind=='bird' else None
    cornea = material('Inset cornea', 'ffffff', .26)
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
    parts.extend([loft('Chest, barrel and haunch line', [((0,-bodylength*.77,chest*.98),width*.55,chest*.33),
                    ((0,-bodylength*.35,chest*.99),width*.97,chest*.56),
                    ((0,bodylength*.22,chest*.94),width*.86,chest*.49),
                    ((0,bodylength*.67,chest*1.04),width*.89,chest*.50),
                    ((0,bodylength*1.02,chest*1.02),width*.25,chest*.19)],skinmat,24,.012,steps=5),
                  ell('Cranium', (0,heady,headz), (headw,headw*.98,headw*.94)),
                  ell('Neck', (0,heady*.68,(chest+headz)*.53), (width*.68, width*.82, abs(headz-chest)*.53+.17))])
    muzzle_depth = {'turtle':.185,'dino':.247,'cat':.130,'mouse':.136,'dog':.201,'bird':.18}[kind]
    muzzle_y = heady-headw*.71
    muzzle_z = headz-headw*.29
    if kind != 'bird':
        parts.append(loft('Continuous muzzle and jaw', [((0,heady-headw*.38,muzzle_z+.026),headw*.74,headw*.52),
            ((0,muzzle_y-muzzle_depth*.48,muzzle_z),headw*.59,headw*.39),
            ((0,muzzle_y-muzzle_depth*.88,muzzle_z+.017),headw*.38,headw*.25),
            ((0,muzzle_y-muzzle_depth,muzzle_z+.024),headw*.16,headw*.15)],
            skinmat,22,.022,steps=5))
    else:
        trim('Upper keratin bill', [((0,heady-.223,headz-.022),.147,.087),
            ((0,heady-.367,headz-.037),.106,.053),((0,heady-.51,headz-.090),.048,.029),
            ((0,heady-.557,headz-.127),.009,.011)],broadbill,'Head',22)
        jaw = material('Horn beak lower', '9d6f49', .63)
        trim('Lower keratin bill', [((0,heady-.226,headz-.102),.138,.035),
            ((0,heady-.355,headz-.108),.088,.032),((0,heady-.492,headz-.128),.033,.017),
            ((0,heady-.525,headz-.137),.009,.008)],jaw,'Head',20)
    frames = []
    for side in (-1,1):
        for key,y in [('Front',front_y),('Back',hind_y)]:
            if kind == 'bird' and key == 'Front':
                continue
            s = (span if kind != 'bird' else .17)*side
            if kind == 'dino' and key == 'Front':
                parts.append(loft('Grasping forelimb', [((s*.74,-.30,chest+.18),.15,.14),
                    ((s,-.52,chest-.03),.087,.095),((s*.83,-.67,chest-.07),.063,.060),
                    ((s*.83,-.75,chest-.11),.028,.030)],skinmat,16,.038,steps=4))
                continue
            leg = .145 if kind != 'turtle' else .185
            haunch = 1.34 if key=='Back' and kind in ('cat','dog','dino','mouse') else 1
            parts.append(loft('Tapered limb and paw', [((s*.60,y-.005,chest*1.10),leg*1.27*haunch,leg*1.22*haunch),
                ((s*.91,y+.084,chest*.63),leg*.80,leg*.88),((s*1.07,y-.034,.20),leg*.65,leg*.73),
                ((s*1.10,y-.118,.095),leg*.93,leg*1.22),((s*1.09,y-.114,.031),leg*.76,leg*.96)],
                skinmat,16,.034,steps=4))
            if kind in ('bird','turtle','dino','dog'):
                for toe in (-1,0,1):
                    parts.append(ell('Webbed toe', (s*1.1+toe*leg*.41,y-.235,.064),(.038,.087,.043)))
        width, aperture, rise, *_ = EYE_STYLES[kind]
        offset = .58 if kind in ('bird','turtle') else .54
        frames.append((side*headw*offset,headz+headw*.16,headw*width,
                       headw*aperture,side*rise))
        if kind in ('cat','dog','mouse'):
            ear = .29 if kind == 'cat' else .43 if kind == 'dog' else .23
            if kind == 'mouse':
                ear += .10*E
                parts.append(ell('Round ear', (side*(headw*.91),heady+.005,headz+headw*.72),
                                 (.185,.107,.212),skinmat,side*.24))
            else:
                tipx = side * (headw + .10 + .17*E)
                tipz = headz+headw*.65 + ear + .09*E
                parts.append(loft('Swept ear', [((side*headw*.58,heady+.03,headz+headw*.54),.154,.124),
                    ((side*headw*.87,heady+.085,headz+headw*.70+ear*.43),.127,.081),
                    ((tipx,heady+.14,tipz),.012,.017)],skinmat))
    if kind == 'turtle':
        carapace = material('Carapace scutes', '234847' if not E else '244458', .57)
        rim_mat = material('Carapace lip', '728565' if not E else '5da4a1', .60)
        lower_mat = material('Carapace plastron', 'ae945e' if not E else '788f85', .68)
        fix(carve_shell(chest,E,carapace,skinmat,lightmat), 'Body')
        for layer in shell_layers(chest,E,rim_mat,lower_mat):
            fix(layer,'Body')
        if E:
            for j in range(7):
                x = (j-3)*.143
                trim('Coral shell ridge', [((x,.19,chest+.56),.089,.086),((x*.99,.26,chest+.95-abs(x)*.6),.050,.055),
                    ((x*1.13,.31,chest+1.07-abs(x)*.6),.012,.011)],lightmat,'Body',8)
    if kind == 'dino':
        sail = material('Horn ember spines', 'be6234' if not E else 'd35c39', .52)
        for j in range(5+3*E):
            y = -.64 + j*(.184 if E else .27)
            z = headz+.155 if j<2 else chest*(1.34 if j<4 else 1.18)
            fin = (1+.41*math.sin(j*.74))*(.28+.135*E)
            spine = loft('Overlapping dorsal spine', [((0,y,z+.011),.095,.134),
                ((.011,y+.051,z+fin*.42),.086,.092),((.018,y+.113,z+fin*.82),.042,.061),
                ((.031,y+.172,z+fin),.014,.023)],sail,16,.026,steps=4)
            surface_texture(spine,sail,38,.15)
            fix(spine,'Head' if j<2 else 'Body')
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
        coverts = material('Feather coverts','417e79' if not E else '566194', .69)
        primaries = material('Feather primaries','235a68' if not E else '463e78', .60)
        pale_feathers = material('Feather tipped vanes','94a985' if not E else '91c6bd', .67)
        for side, suffix in ((-1,'L'),(1,'R')):
            wing = 'Front'+suffix
            wing_root = loft('Wing envelope with anatomical shoulder root', [((side*.22,-.089,chest+.112),.21,.129),
                ((side*.34,-.076,chest+.117),.253,.145),((side*.55,.046,chest+.096),.231,.093),
                ((side*(.76+.13*E),.219,chest+.091),.148,.047),((side*(.90+.17*E),.34,chest+.140),.018,.014)],
                coverts,23,.026,steps=4)
            uv_project(wing_root,.59)
            fix(wing_root,wing)
            for j in range(8+2*E):
                w = .41+j*.049
                spread = .13+j*.028
                fin = feather('Overlapping flight vane',(side*w,-.02+j*.031,chest+.15+j*.004),
                    (side*(w+spread+.21*E),.55+j*.064,chest+.046+j*.018),.084+.011*j,
                    pale_feathers if j%3==2 else primaries,.035+.004*j)
                fix(fin,wing)
            for j in range(5+E):
                w=.31+j*.105
                fix(feather('Layered wing covert',(side*w,-.111+j*.045,chest+.239-j*.012),
                    (side*(w+.19+.09*E),.30+j*.051,chest+.143+j*.016),.083,
                    coverts,.049),wing)
            trim('Head plume', [((side*.13,heady+.13,headz+.17),.076,.075),((side*.13,heady+.28,headz+.40+E*.13),.068,.047),
                 ((side*.17,heady+.51+E*.19,headz+.48+E*.26),.008,.008)],darkmat,'Head',9)
    tailwidth = {'turtle':.12,'dino':.26,'cat':.15,'bird':.18,'mouse':.084,'dog':.24}[kind] + .05*E
    tailend = {'turtle':.96,'dino':1.52,'cat':1.23,'bird':1.31,'mouse':1.37,'dog':1.26}[kind]+.22*E
    tall = kind in ('cat','dog','mouse')
    parts.append(loft('Continuous tapered tail', [((0,bodylength*.67,chest*.93),tailwidth*1.08,tailwidth),
         ((.08,bodylength*.76+tailend*.16,chest*.95),tailwidth*.94,tailwidth*.80),
         ((.16,tailend*.84,chest + (.29+.24*E if tall else -.10)),tailwidth*.65,tailwidth*.56),
         ((.04,tailend,chest + (.55+.39*E if tall else -.18)),.021,.024)],skinmat,18,.036,steps=5))
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
    body = fuse(parts, 'Sculpted continuous anatomy', skinmat, .024)
    body = retopology(body, kind, evolved, skinmat)
    carve_sockets(body,frames,.030 if kind=='turtle' else .039)
    uv_project(body,1.02 if surface_type=='fur' else .89)

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
            stripe = (.5+.5*math.sin(v.y*25+abs(v.x)*7+v.z*8+2*dapple))**4
            back += stripe*soft(.09,.25,abs(v.x))*soft(chest*.56,chest*.91,v.z)*.70
        elif kind in ('mouse','dino'):
            back += soft(.18,.55,dapple)*.22
        style = blend(base, shade, back*.62)
        style = blend(style, accent, fringe)
        ridge = max(0, math.sin(v.y*19 + v.z*25 + v.x*11 + dapple*1.8))**7
        texture = .12 if kind in ('turtle','dino') else .06
        style = blend(style, accent, ridge*texture*(.35+back*.55))
        style = blend(style,shade,.64*soft(.58,.98,v.y)*soft(chest*.68,chest*.91,v.z))
        front = soft(-heady+headw*.36,-heady+headw*.68,-v.y)
        if kind=='dino':
            ridge_height = (headz+.19 if v.y<-.29 else chest*1.50)
            fin = soft(ridge_height,ridge_height+.091,v.z)*(1-soft(.072,.125,abs(v.x)))
            style = blend(style,accent,fin*.88)
            nostril = exp(-((abs(v.x)-.086)/.037)**2-((v.z-muzzle_z-.045)/.026)**2)
            style = blend(style,(.074,.013,.010),nostril*soft(-muzzle_y+.13,-muzzle_y+.20,-v.y)*.79)
        if kind in ('cat','dog','mouse'):
            ear_panel = soft(headz+headw*.50,headz+headw*.88,v.z)*soft(headw*.36,headw*.80,abs(v.x))
            ear_panel *= soft(-heady-.14,-heady+.04,-v.y)
            style = blend(style,(.58,.22,.21),ear_panel*.53)
            nose = exp(-(v.x/(headw*.25))**4-((v.z-muzzle_z-.041)/.050)**2)
            style = blend(style,(.029,.014,.019),nose*soft(-muzzle_y+muzzle_depth*.69,-muzzle_y+muzzle_depth*.94,-v.y))
        elif kind=='bird':
            style = blend(style,accent,soft(-heady+.275,-heady+.47,-v.y)*.95)
        seam_z = muzzle_z-.040+abs(v.x)*.07
        if kind=='bird':
            seam_z = headz-.067 + (v.y-heady+.31)*.21
        seam = exp(-((v.z-seam_z)/.018)**2)*(1-soft(headw*.27,headw*.64,abs(v.x)))
        style = blend(style,shade,front*seam*.86)
        return [value*grain(v, 38, .062)*(1+scale*dapple*.035) for value in style]

    pigment(body, skinmat, coat)
    surface = face_surface(body)
    for frame in frames:
        fix(inset_eye(surface,frame,cornea,coat,kind),'Head')
    if kind in ('cat','dog','mouse'):
        nose_mat = material('Moist nose', '3b272f' if kind=='dog' else '76454b', .38)
        origin = (0,-3,muzzle_z+.042)
        landing,_,_,_ = surface.ray_cast(origin,(0,1,0))
        if landing is not None:
            nose = ovoid('Fitted nasal pad',(0,landing.y+.02,landing.z),
                         (headw*.223,.044,headw*.122),nose_mat,.002,.033,11,21)
            fix(nose,'Head')
    if kind in ('cat','mouse'):
        whisker = material('Tapered whiskers', 'bac49b' if kind=='cat' else 'b8a67c', .84)
        for side in (-1,1):
            for i in range(3):
                z = muzzle_z+(i-1)*.047
                x = side*headw*(.42+.06*i)
                landing,_,_,_ = surface.ray_cast((x,-3,z),(0,1,0))
                if landing is None:
                    continue
                trim('Natural whisker',[(landing,.005,.005),
                    ((x+side*.111,landing.y-.022,z+.005),.0038,.0038),
                    ((x+side*(.206+.039*i),landing.y+.017,z+(i-1)*.056),.001,.001)],
                    whisker,'Head',6)
    rig = skeleton(kind, height, hind_y, front_y, span, bird=kind=='bird')
    def body_weights(v):
        bone = 'Body'
        strength = 0
        if v.y > bodylength*.68 and v.z > chest*.74:
            bone = 'Tail'
            strength = soft(bodylength*.71,tailend*.82,v.y)
            if kind in ('dog','cat'):
                tip = soft(bodylength*.96,tailend*.88,v.y)
                return [('Tail',strength*(1-tip)),('TailTip',strength*tip),('Body',1-strength)]
        elif kind=='turtle' and v.y<heady+.28 and v.z>headz-headw*.70:
            bone = 'Head'
            strength = 1-soft(heady-.095,heady+.26,v.y)
        elif v.y < heady+.16 and v.z > headz-headw*.5:
            bone = 'Head'
            strength = min(1, max(0,(heady+.16-v.y)*4+(v.z-headz)*2.3+.3))
        elif kind == 'bird' and v.z>chest*.64 and abs(v.x)>.22:
            bone = 'FrontR' if v.x>0 else 'FrontL'
            strength = soft(.24,.53,abs(v.x))
        elif v.z < chest*.78 and abs(v.x) > span*.46:
            side = 'R' if v.x > 0 else 'L'
            bone = ('Back' if v.y > .07 else 'Front') + side
            strength = min(1, max(0,(chest*.78-v.z)*4))
            if kind in ('dog','cat'):
                shin = 1-soft(chest*.47,chest*.66,v.z)
                paw = 1-soft(.092,.171,v.z)
                return [(bone,strength*(1-shin)),('Shin'+bone,strength*shin*(1-paw)),
                        ('Paw'+bone,strength*paw),('Body',1-strength)]
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
    cornea = material('Inset cornea', 'ffffff', .24)
    stitch = material('Woven bronze thread', 'ab8056')
    lining = material('Russet velvet lining','432923',.81)
    fasteners = material('Struck brass detail','d59c58',.44,.4)
    pinned = []
    def fix(obj, bone='Body'):
        pinned.append((obj,bone))
        return obj
    def ell(name, at, size, mat, bone='Body', twist=0):
        return fix(ovoid(name,at,size,mat,twist,.028),bone)
    def tube(name, sections, mat, bone='Body', sides=16):
        return fix(loft(name,sections,mat,sides,.036,steps=3),bone)
    tube('Woven field coat', [((0,.043,.98),.356,.246),((0,.040,1.08),.349,.241),
         ((0,.028,1.28),.286,.206),((0,.010,1.47),.271,.174),((0,.004,1.68),.331,.210),
         ((0,.037,1.803),.365,.207),((0,.044,1.916),.28,.159),((0,.042,1.983),.195,.132)],
         cloth,sides=42)
    tube('Turned wool neck binding', [((0,.042,1.901),.203,.150),
         ((0,.044,1.965),.190,.141),((0,.046,2.010),.183,.128)],cloak,sides=36)
    tube('Antique gold collar edge', [((0,.044,1.967),.193,.144),
         ((0,.045,1.997),.185,.133),((0,.046,2.010),.181,.128)],gold,sides=36)
    tube('Waist belt', [((0,.02,1.365),.282,.20),((0,.02,1.43),.28,.194)],boot,sides=28)
    ell('Cloak clasp', (0,-.213,1.74),(.087,.028,.084),gold)
    ell('Cloak clasp inset', (0,-.247,1.74),(.036,.013,.040),gem)
    ell('Buckle', (.027,-.18,1.395),(.074,.026,.048),gold)
    ell('Pouch', (-.277,-.049,1.20),(.12,.11,.16),boot,twist=.18)
    cape_v, cape_f = [], []
    row_count, width_count = 25, 23
    for i in range(row_count):
        v=i/(row_count-1)
        for j in range(width_count):
            u=(j/(width_count-1)-.5)*2
            width=.286+.20*v+.094*math.sin(v*math.pi)
            x=u*width+.066*v*v
            y=.153+.285*v+(.025+.065*v)*math.sin(u*13+v*2)-.087*u*u
            z=1.902-1.40*v-.14*math.cos(u*math.pi*.72)*v-.085*u*u+.047*math.sin(u*15)*v**5
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
        tube('Sleeve', [((s*.261,.028,1.804),.152,.133),((s*.376,.016,1.729),.133,.111),
              ((s*.465,-.005,1.573),.105,.099),((s*.503,-.048,1.44),.086,.079),
              ((s*.538,-.108,1.281),.073,.070)], cloth, arm)
        tube('Leather bracer', [((s*.498,-.042,1.433),.093,.081),((s*.54,-.10,1.31),.079,.074),
              ((s*.55,-.12,1.27),.078,.073)], boot, arm)
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
        tube('Trousers', [((s*.150,.026,1.132),.164,.155),((s*.173,.052,.899),.146,.128),((s*.194,-.010,.685),.108,.106),
              ((s*.193,.021,.51),.096,.088),((s*.206,.01,.29),.084,.078)],cloth,leg)
        tube('Soft riding boot', [((s*.19,.025,.52),.113,.11),((s*.21,-.005,.30),.105,.095),
              ((s*.216,-.06,.16),.112,.102),((s*.22,-.19,.10),.118,.083),((s*.22,-.27,.083),.091,.047)],boot,leg)
        ell('Boot stud', (s*.21,-.079,.44),(.042,.022,.025),gold,leg)
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
    base=Path(__file__).with_name('reference')/'lio-head.obj'
    face=read_obj(base,'Lio MPFB facial anatomy',skinmat,
        lambda v:(v[0]*2.03, (v[1]+.030)*1.83+.018, 1.923+(v[2]-1.3444258)*.56/.2540483))
    frames = [(side*.067,2.231,.041,.023,side*.115) for side in (-1,1)]
    carve_sockets(face,frames,.016)
    def complexion(v):
        cheek=exp(-((abs(v.x)-.100)/.052)**2-((v.z-2.168)/.057)**2)*soft(.095,.159,-v.y)
        lip=exp(-(v.x/.057)**4-((v.z-2.107)/.017)**2)*soft(.140,.183,-v.y)
        lip_seam=exp(-(v.x/.045)**4-((v.z-2.106)/.006)**2)*soft(.146,.179,-v.y)
        brow_shape = 2.278-.051*abs(abs(v.x)-.069)
        brow = exp(-((abs(v.x)-.069)/.046)**6-((v.z-brow_shape)/.008)**2)
        brow *= soft(.079,.132,-v.y)
        warmth = blend(skinmat.diffuse_color[:3],(.55,.132,.115),lip*.56)
        warmth = blend(warmth,(.19,.058,.044),lip_seam*.55)
        warmth = blend(warmth,(.65,.266,.175),cheek*.32)
        return blend(warmth,(.095,.040,.033),brow*.84)
    pigment(face,skinmat,complexion)
    fix(face,'Head')
    surface = face_surface(face)
    for frame in frames:
        fix(inset_eye(surface,frame,cornea,complexion,'hero'),'Head')
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
    def tailored_dye(v):
        band = 1 - .23*exp(-((v.z-1.413)/.045)**2)
        fold = .96 + .045*math.cos(v.x*48 + v.z*4)
        return [c*grain(v,74,.11)*fold*band for c in cloth.diffuse_color[:3]]
    pigment(coat,cloth,tailored_dye)
    coat_surface = face_surface(coat)
    for side in (-1,1):
        drape, panels = [], []
        columns, rows = 22, 15
        for i in range(rows):
            t = i/(rows-1)
            for j in range(columns):
                s = j/(columns-1)
                a = side*(.16 + s*1.42 + t*.05)
                z = 1.968 - t*(.376+.172*s) + .018*math.sin(s*math.tau*1.33)*t
                normal = Vector((math.sin(a),-math.cos(a),0))
                pos,_,_,_ = coat_surface.ray_cast(normal*2+Vector((0,.033,z)),-normal)
                if pos is None:
                    pos = normal*.187+Vector((0,.033,z))
                fold = .022+.027*math.sin(s*12+t*2.6)**2+.024*t**3
                drape.append(pos+normal*fold+Vector((0,0,.007)))
                if i and j:
                    k = i*columns+j
                    panel = (k,k-columns,k-columns-1,k-1)
                    panels.append(panel if side==1 else panel[::-1])
        mantle = mesh('Draped velvet sewn over the wool',drape,panels,[cloak,lining])
        activate(mantle)
        thickness = mantle.modifiers.new('Velvet fold and back lining','SOLIDIFY')
        thickness.thickness = .017
        thickness.material_offset = 1
        thickness.material_offset_rim = 1
        bpy.ops.object.modifier_apply(modifier=thickness.name)
        uv_project(mantle,.75)
        fix(mantle)
        hem_points = [drape[(rows-1)*columns+j] for j in range(0,columns,2)]+[drape[-1]]
        tube('Narrow braided mantle piping',[(p,.009,.008) for p in hem_points],stitch,'Body',7)
        for i in range(3):
            p = drape[(4+i*3)*columns+1]
            ell('Inset brass mantle stud', (p.x,p.y-.012,p.z),(.015,.009,.014),fasteners)
    surface_texture(cape,cloak,49,.21)
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
    strata = material('Weathered slate with lichens','ffffff',.81)
    canopy = material('Alder foliage atlas','ffffff',.84)

    def paint_mesh(mat, attribute):
        node = mat.node_tree.nodes.new('ShaderNodeVertexColor')
        node.layer_name = attribute
        mat.node_tree.links.new(node.outputs['Color'],
                                mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    paint_mesh(strata,'Rock and moss')
    paint_mesh(canopy,'Leaf pigment')

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
        seam = noise.noise_vector(Vector((x*.34,z*.31,2.4)))[0]
        f = broad*.034+grain*.018
        shade = max((exp(-((x-b['x']-.18)**2+(z-b['z']+.18)**2)/(b['radius']*.78)**2)
                     for b in layout['obstacles']), default=0)
        light = 1 - .41*shade
        soil_blend = soft(.25,.64,trail+.39*seam)
        green = (.235+f*1.5,.342+f*1.7,.185+f*1.1)
        path = (.409+f*1.7,.332+f*1.3,.206+f*.98)
        colors.data[i].color = (*(v*light for v in blend(green,path,soil_blend)),1)

    def lump(name,x,z,h,sx,sz,sy,mat=rock,rows=9,sides=16):
        return ovoid(name,p(x,z,h),(sx,sz,sy),mat,uniform(-.21,.21),.29,rows,sides)

    for obstacle in layout['obstacles']:
        x,z,r,h = (obstacle[key] for key in ['x','z','radius','height'])
        def shale(px,py,pz):
            height=pz/h
            distortion=noise.noise_vector(Vector((px*1.83,py*2.01,pz*3.2)))[0]
            shelf=math.sin((height+.05*px)*30+.4*py)**5
            return (px+distortion*.084+shelf*.051,py+distortion*.062, pz+shelf*.031)
        angle = uniform(0,TAU)
        def broken_rock(px,py,pz):
            u,v,w = shale(px,py,pz)
            twist = math.atan2(py+z,px-x)
            facet = .94+.056*math.cos(twist*5+angle)+.068*math.cos(twist*3-angle)
            u,v = x+(u-x)*facet,-z+(v+z)*facet
            v += .043*math.sin(w*20.+angle)
            w = min(w,h*1.005 + .07*math.sin(u*4.6 + v*1.55 + angle))
            return u,v,w
        boulder = ovoid('Single glacial boulder',p(x,z,h*.38),(r*1.02,r*.94,h*.67),strata,
                        uniform(-.25,.25),.38,26,43,sculpt=broken_rock)
        stain = boulder.data.color_attributes.new('Rock and moss','BYTE_COLOR','POINT')
        for vert in boulder.data.vertices:
            v = vert.co
            crevice = noise.fractal(v*3.6+Vector((.4,.89,.33)),1.22,2,3)
            stain_border = .74 + .14*math.cos((v.x-x)*4.1+angle) + .21*crevice
            moss_edge = soft(stain_border-.045,stain_border+.11,v.z/h)
            damp = soft(.01,.39,v.z) * (.93+.20*crevice)
            material_color = blend((.28,.33,.36),(.91,.86,.67),damp)
            material_color = blend(material_color,(.34,.49,.114),moss_edge*.87)
            stain.data[vert.index].color = (*(min(1,max(0,t)) for t in material_color),1)
        for _ in range(5):
            angle = uniform(0,TAU)
            size = uniform(.12,.34)
            lump('Eroded fragments',x+r*.83*math.cos(angle),z+r*.83*math.sin(angle),.10,size,size,.19)

    leaf_verts, leaf_faces, leaf_colors, leaf_uv = [], [], [], []

    def leaf_spray(x,z,y,spread,layer):
        center = Vector(p(x,z,y))
        base_angle = layer*2.399963
        green = uniform(.81,1.0)
        for k in range(3):
            angle = base_angle+k*math.pi/3
            forward = Vector((math.cos(angle),math.sin(angle),.09*k))
            tilt = (.22,.54,.87)[k]
            across = Vector((-math.sin(angle)*tilt,math.cos(angle)*tilt,1-tilt*.68))
            width,height = spread*uniform(1.19,1.45),spread*uniform(.92,1.31)
            base = len(leaf_verts)
            offset = uniform(-.16,.16)
            for u,v in ((-1,-1),(1,-1),(1,1),(-1,1)):
                leaf_verts.append(center+forward*width*u+across*height*v+Vector((0,0,offset)))
                leaf_uv.append(((u+1)*.5,(v+1)*.5))
                light = .72+.14*(v+1)
                leaf_colors.append((min(1,green*light*.87),min(1,green*light),min(1,green*light*.91)))
            leaf_faces.append(tuple(base+i for i in range(4)))

    for i in range(57):
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
            for k in range(2):
                leaf_spray(bx+uniform(-.57,.57),bz+uniform(-.57,.57),by+uniform(-.28,.48),
                           uniform(.83,1.41),i+j+k)
    foliage = mesh('Leaf atlas across wind-oriented branches',leaf_verts,leaf_faces,[canopy])
    mapping = foliage.data.uv_layers.new(name='Alder leaf atlas')
    for link in foliage.data.loops:
        mapping.data[link.index].uv=leaf_uv[link.vertex_index]
    pigments = foliage.data.color_attributes.new('Leaf pigment','BYTE_COLOR','POINT')
    for i, color in enumerate(leaf_colors):
        pigments.data[i].color = (*color,1)

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
    # The monolithic moon gate and a basin worn into the surrounding rock.
    ax, az = ruin['x'], ruin['z'] - 1.5
    for side in (-1,1):
        loft('Eroded moon gate pier',[(p(ax+side*1.39,az,-.11),.52,.54),
            (p(ax+side*1.36,az,.31),.44,.50),(p(ax+side*1.40,az+.03,.80),.37,.45),
            (p(ax+side*1.365,az+.03,1.61),.35,.39),(p(ax+side*1.34,az,2.16),.31,.35)],
            rock,21,.17,steps=4)
    arc = []
    for i in range(31):
        a = i/30*math.pi
        x = ax+1.35*math.cos(a)
        h = 2.10+1.29*math.sin(a)
        wear = .027*math.sin(i*2.43)+.032*math.cos(i*.91)
        arc.append((p(x,az+.026*math.sin(i*.75),h),.33+wear,.34+wear))
    loft('Fractured sandstone moon arch',arc,rock,18,.12,steps=2)
    sx,sz=camp['x']-1.3,camp['z']+1.5
    basin = []
    for j in range(49):
        a = TAU*j/48
        edge = .011*math.sin(a*7)+.025*math.cos(a*4)
        radial = 1 + .045*math.sin(a*5)
        basin.append((p(sx+math.cos(a)*1.27*radial,sz+math.sin(a)*.91*radial,.11+edge),
                      .255+edge,.16+edge))
    loft('Continuous eroded spring basin',basin,rock,14,.16)
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
    material_uv = {soil.name:(6.9,'ground'),rock.name:(1.8,'box'),strata.name:(1.8,'box'),moss.name:(1.1,'box'),
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
    bpy.ops.object.select_all(action='SELECT')
    foliage.select_set(False)
    export('world', selected=True)
    activate(foliage)
    export('canopy', selected=True)


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
