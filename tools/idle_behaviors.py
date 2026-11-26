"""Rest poses and species-specific idle beats for the Blender armatures."""
import math
from mathutils import Quaternion, Vector


CLIPS = {
    'hero': {'idle_watch': 134, 'idle_check_wand': 147},
    'dog': {'idle_wag': 104, 'idle_sit': 283, 'idle_listen': 139},
    'cat': {'idle_groom': 188, 'idle_crouch': 208, 'idle_tail': 154},
    'turtle': {'idle_retreat': 252, 'idle_browse': 206},
    'dino': {'idle_sniff': 138, 'idle_alert': 169},
    'bird': {'idle_preens': 173, 'idle_wings': 122, 'idle_scan': 127},
    'mouse': {'idle_scout': 154, 'idle_groom': 174},
}


def smooth(lo, hi, t):
    u = min(1, max(0, (t-lo)/(hi-lo)))
    return u*u*(3-2*u)


def window(a, b, c, d, t):
    return smooth(a,b,t)*(1-smooth(c,d,t))


def bend(bone, x=0, y=0, z=0):
    bone.rotation_euler = (x,y,z)


def translate(bone, x=0, y=0, z=0):
    bone.location = bone.bone.matrix_local.to_quaternion().inverted() @ Vector((x,y,z))


def planted_leg(bones, key, body_rotation, shift, foot_shift):
    upper, lower, foot = (bones[key], bones['Shin'+key], bones['Paw'+key])
    hips = bones['Body'].bone.head_local
    root = hips + body_rotation @ (upper.bone.head_local-hips) + shift
    goal = foot.bone.head_local+foot_shift
    leg = goal-root
    direction = leg.normalized()
    upper_length, lower_length = upper.bone.length, lower.bone.length
    length = min(leg.length,upper_length+lower_length-.0004)
    length = max(length,abs(upper_length-lower_length)+.0004)
    along = (upper_length**2-lower_length**2+length**2)/(2*length)
    knee_hint = Vector((0,1 if key.startswith('Front') else -1,0))
    outward = (knee_hint - direction*knee_hint.dot(direction)).normalized()
    knee = root + direction*along + outward*math.sqrt(max(0,upper_length**2-along**2))
    ankle = root+direction*length
    parent_deform = body_rotation
    for bone,target in ((upper,knee-root),(lower,ankle-knee)):
        rest = bone.bone.matrix_local.to_quaternion()
        initial = parent_deform @ rest
        goal_rotation = (initial @ Vector((0,1,0))).rotation_difference(target.normalized()) @ initial
        bend_local = initial.inverted() @ goal_rotation
        bone.rotation_euler = bend_local.to_euler('XYZ')
        parent_deform = goal_rotation @ rest.inverted()
    foot_rest = foot.bone.matrix_local.to_quaternion()
    foot.rotation_euler = ((parent_deform @ foot_rest).inverted() @ foot_rest).to_euler('XYZ')


def grounding(bones, posture, tilt, drop, shift=0, rear_step=0, front_step=0, paw_lift=0):
    if posture < .0001:
        return
    body = bones['Body']
    rotation = Quaternion(Vector((1,0,0)),tilt*posture)
    displacement = Vector((0,shift*posture,-drop*posture))
    translate(body,*displacement)
    rest = body.bone.matrix_local.to_quaternion()
    body.rotation_euler = (rest.inverted() @ rotation @ rest).to_euler('XYZ')
    for name in ('FrontL','FrontR','BackL','BackR'):
        back = name.startswith('Back')
        step = rear_step if back else front_step
        lift = paw_lift if name == 'FrontR' else 0
        planted_leg(bones,name,rotation,displacement,Vector((0,step*posture,lift)))


def pose(rig, species, clip, t):
    bones = rig.pose.bones
    for bone in bones:
        bone.rotation_mode = 'XYZ'
        bone.location = (0,0,0)
        bend(bone)
        bone.scale = (1,1,1)

    body, head, tail = (bones[key] for key in ('Body','Head','Tail'))
    if clip == 'idle':
        # A chest expansion, with feet and head position held at rest.
        breath = (1-math.cos(t*math.tau))*.5
        gain = {'hero':.012,'dog':.018,'cat':.015,'mouse':.021,'bird':.023,'dino':.014,'turtle':.007}[species]
        body.scale = (1+gain*breath,1,1)
        return

    if species == 'dog':
        if clip == 'idle_sit':
            sit = window(.06,.24,.76,.96,t)
            height = bones['Body'].bone.head_local.z
            grounding(bones,sit,-.53,height*.29,.105,-.31,-.036)
            look = window(.31,.40,.61,.70,t)
            bend(head, .44*sit+.12*look, .07*look, .27*look)
            bend(tail,-.11*sit,z=.23*window(.29,.38,.63,.70,t)*math.sin(t*math.tau*5))
        elif clip == 'idle_wag':
            wag = window(.11,.25,.77,.95,t)
            bend(tail,.14*wag,z=.51*wag*math.sin(t*math.tau*4.5))
            bend(bones['TailTip'],.09*wag,z=.24*wag*math.sin(t*math.tau*4.5-.74))
            bend(head,-.09*wag,z=.16*window(.26,.38,.75,.90,t))
        elif clip == 'idle_listen':
            first = window(.10,.22,.38,.47,t)
            second = window(.49,.61,.77,.92,t)
            bend(head,.13*first-.055*second,.16*first,-.42*first+.48*second)
    elif species == 'cat':
        if clip == 'idle_crouch':
            low = window(.06,.26,.77,.95,t)
            grounding(bones,low,.15,.24,.05,-.068,-.092)
            bend(head,.16*low,z=-.30*window(.32,.42,.66,.76,t))
            bend(tail,-.24*low,z=.33*low*math.sin(t*math.tau*1.25))
        elif clip == 'idle_groom':
            prep = window(.06,.22,.69,.94,t)
            groom = window(.26,.36,.61,.70,t)
            grounding(bones,prep,-.29,.17,.038,-.14,-.18,.69*prep)
            bend(head,.45*prep+.085*groom*math.sin(t*math.tau*6),-.20*prep,-.21*prep)
            bend(tail,.12*prep,z=.16*groom)
        elif clip == 'idle_tail':
            curl = window(.10,.29,.72,.94,t)
            bend(tail,.28*curl,z=-.54*curl+.19*curl*math.sin(t*math.tau*2))
            bend(bones['TailTip'],.13*curl,z=.37*curl+.14*curl*math.sin(t*math.tau*2-.81))
            bend(head,.06*curl,z=.29*window(.32,.45,.66,.88,t))
    elif species == 'turtle':
        if clip == 'idle_retreat':
            tuck = window(.09,.26,.64,.97,t)
            translate(head,y=.225*tuck,z=-.043*tuck)
            bend(head,.082*tuck)
            bend(tail,.24*tuck)
        elif clip == 'idle_browse':
            sniff = window(.07,.31,.70,.94,t)
            translate(head,y=-.094*sniff,z=-.099*sniff)
            bend(head,.27*sniff,z=.24*window(.39,.48,.68,.83,t))
    elif species == 'bird':
        if clip == 'idle_preens':
            preen = window(.10,.29,.67,.93,t)
            peck = window(.31,.39,.61,.69,t)*math.sin(t*math.tau*7)
            bend(head,.43*preen+.055*peck,-.17*preen,.78*preen)
            bend(bones['FrontR'],.17*preen,z=.14*preen)
        elif clip == 'idle_wings':
            wing = window(.12,.32,.68,.93,t)
            flutter = window(.22,.36,.61,.74,t)*math.sin(t*math.tau*4.75)
            for side, sign in (('L',-1),('R',1)):
                bend(bones['Front'+side],.40*wing+.21*flutter,z=sign*(.24*wing+.15*flutter))
            bend(tail,.20*wing)
            bend(head,-.17*wing)
        elif clip == 'idle_scan':
            bend(head,.07*window(.24,.32,.60,.85,t),z=.56*window(.10,.18,.33,.43,t)-.65*window(.49,.57,.79,.92,t))
    elif species == 'mouse':
        investigate = window(.11,.28,.71,.93,t)
        if clip == 'idle_scout':
            twist = window(.28,.39,.65,.79,t)
            bend(head,-.31*investigate+.044*twist*math.sin(t*math.tau*7),z=.47*twist)
            bend(tail,.20*investigate,z=-.31*investigate)
        elif clip == 'idle_groom':
            paws = window(.21,.35,.62,.76,t)
            for side, sign in (('L',-1),('R',1)):
                bend(bones['Front'+side],-.67*investigate+.13*paws*math.sin(t*math.tau*7+sign*.7),z=.23*sign*investigate)
            bend(head,.36*investigate)
    elif species == 'dino':
        if clip == 'idle_sniff':
            sniff = window(.12,.26,.69,.91,t)
            bend(head,-.16*sniff + .088*sniff*math.sin(t*math.tau*3),z=-.29*sniff)
            bend(tail,.17*sniff,z=.18*sniff)
        elif clip == 'idle_alert':
            listen = window(.08,.28,.68,.94,t)
            bend(head,-.34*listen,.13*listen,.37*listen)
            bend(tail,-.09*listen,z=-.38*listen)
            bend(bones['FrontR'],-.19*listen)
    elif species == 'hero':
        if clip == 'idle_watch':
            bend(head,-.08*window(.16,.29,.74,.91,t),z=-.39*window(.10,.23,.42,.53,t)+.40*window(.55,.66,.80,.94,t))
        elif clip == 'idle_check_wand':
            lift = window(.09,.30,.69,.94,t)
            bend(bones['FrontR'],-.58*lift,.19*lift,-.19*lift)
            bend(head,.33*lift,-.08*lift,-.16*lift)
