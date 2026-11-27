"""Rest poses and species-specific idle beats for the Blender armatures."""
import math
from mathutils import Quaternion, Vector


CLIPS = {
    'hero': {'idle_watch': 84, 'idle_check_wand': 98},
    'dog': {'idle_wag': 70, 'idle_sit': 146, 'idle_listen': 80, 'idle_scent': 78},
    'cat': {'idle_groom': 121, 'idle_crouch': 120, 'idle_tail': 93, 'idle_stretch': 116},
    'turtle': {'idle_retreat': 157, 'idle_browse': 139},
    'dino': {'idle_sniff': 88, 'idle_alert': 100},
    'bird': {'idle_preens': 109, 'idle_wings': 71, 'idle_scan': 66},
    'mouse': {'idle_scout': 79, 'idle_groom': 98},
}

TURN_FRAMES = {'dog': 23, 'cat': 24, 'turtle': 40, 'dino': 31, 'bird': 22, 'mouse': 19, 'hero': 26}
THREAT_FRAMES = {'dog': 48, 'cat': 45, 'turtle': 48, 'dino': 53, 'bird': 43, 'mouse': 39}
TURN_ANGLE = math.tau/6
UP = Vector((0,0,1))


def smooth(lo, hi, t):
    u = min(1, max(0, (t-lo)/(hi-lo)))
    return u*u*(3-2*u)


def window(a, b, c, d, t):
    return smooth(a,b,t)*(1-smooth(c,d,t))


def bend(bone, x=0, y=0, z=0):
    bone.rotation_euler = (x,y,z)


def translate(bone, x=0, y=0, z=0):
    bone.location = bone.bone.matrix_local.to_quaternion().inverted() @ Vector((x,y,z))


def planted_leg(bones, key, body_rotation, shift, foot_shift, foot_yaw=0):
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
    foot.rotation_euler = ((parent_deform @ foot_rest).inverted() @ Quaternion(UP,foot_yaw) @ foot_rest).to_euler('XYZ')


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


def turn_pose(bones, species, sign, t, rear=False, pivot=False):
    """Counter-rotate planted feet against the animated root turn."""
    nominal = (math.pi*.77 if pivot else math.pi*.79 if rear else TURN_ANGLE)*sign
    yaw = nominal*(.48*smooth(.17,.48,t)+.52*smooth(.54,.93,t))
    untwist = Quaternion(UP,-yaw)
    head = bones['Head']
    body = bones['Body']
    anticipation = window(0,.15,.27,.55,t)
    head.rotation_euler = (0,(.53 if rear else .32)*sign*anticipation,0)
    settle = window(.19,.29,.44,.52,t)+window(.61,.70,.83,.94,t)
    plant = window(0,.16,.46,.91,t) if pivot else 0
    body_shift = Vector((sign*.036*plant,-.027*plant,-.028*settle-.030*plant))
    translate(body,*body_shift)
    if species in ('bird','dino','hero'):
        steps = ('BackL','BackR')
    else:
        steps = ('FrontL','FrontR','BackL','BackR')
    for name in steps:
        first = (name in ('FrontL','BackR')) == (sign>0)
        start,end = (.09,.51) if first else (.48,.94)
        p = smooth(start,end,t)
        toe_lift = (.15 if species in ('bird','mouse','cat') else .106)*math.sin(math.pi*p)*(1.30 if rear or pivot else 1)
        foot_angle = nominal*p-yaw
        if species in ('dog','cat'):
            anchor = bones['Paw'+name].bone.head_local
            foot_target = untwist @ (Quaternion(UP,nominal*p) @ anchor)
            foot_target.z += toe_lift
            planted_leg(bones,name,Quaternion(),body_shift,foot_target-anchor,foot_angle)
        else:
            limb = bones[name]
            anchor = limb.bone.tail_local
            rest = limb.bone.matrix_local.to_quaternion()
            foot_target = untwist @ (Quaternion(UP,nominal*p) @ anchor)
            foot_target.z += toe_lift
            direction = (foot_target-limb.bone.head_local-body_shift).normalized()
            aim = (rest @ Vector((0,1,0))).rotation_difference(direction)
            limb.rotation_euler = (rest.inverted() @ aim @ rest).to_euler('XYZ')
    if species in ('dog','cat','mouse','dino'):
        bend(bones['Tail'],z=-.23*sign*window(.22,.43,.79,1,t))
    if species=='bird':
        bend(bones['FrontL'],.12*settle,z=-.16*settle)
        bend(bones['FrontR'],.12*settle,z=.16*settle)


def defensive_pose(bones, species, clip, t):
    body,head,tail = (bones[k] for k in ('Body','Head','Tail'))
    guard = clip.startswith('guard')
    wide = clip in ('guard_alert','threat_display_wide')
    inhale = .5-.5*math.cos(t*math.tau)
    ready = 1 if guard else window(.01,.17,.76,1,t)
    warning = 0 if guard else window(.18,.29,.53,.81,t)
    pulse = warning * (1 + .12*math.sin(t*math.tau*6)) * (1.25 if wide else 1)
    if species=='dog':
        grounding(bones,ready,.10,.115,-.021,.028,-.092)
        translate(head,y=-.085*pulse,z=.052*pulse)
        bend(head,.10*ready-.19*pulse,y=-.04*inhale)
        bend(tail,.07*ready-.21*pulse)
        bend(bones['TailTip'],-.10*ready+.31*pulse)
    elif species=='cat':
        grounding(bones,ready,.18,.146,.065,.044,-.029,.23*pulse)
        translate(head,y=-.058*pulse,z=-.068*pulse)
        bend(head,.29*ready-.19*pulse)
        bend(tail,.36*ready,z=.31*pulse-.08*inhale)
        bend(bones['TailTip'],.26*ready,z=-.22*pulse)
    elif species=='bird':
        translate(body,z=-.041*ready+.11*pulse)
        translate(head,y=-.074*ready-.19*pulse,z=.021*inhale)
        bend(head,-.12*ready-.22*pulse)
        for side,sign in (('L',-1),('R',1)):
            bend(bones['Front'+side],.08*ready+.43*pulse,z=sign*(.16*ready+.68*pulse))
        bend(tail,.25*ready+.31*pulse)
    elif species=='turtle':
        translate(head,y=.135*ready-.34*pulse,z=.04*pulse)
        bend(head,.12*ready-.30*pulse)
        for side,sign in (('L',-1),('R',1)):
            bend(bones['Front'+side],-.12*pulse,z=.11*sign*ready)
        bend(tail,.08*ready)
    elif species=='dino':
        translate(body,z=-.037*ready+.072*pulse)
        translate(head,y=-.041*ready-.17*pulse,z=.12*pulse)
        bend(head,.09*ready-.43*pulse)
        for side,sign in (('L',-1),('R',1)):
            bend(bones['Front'+side],-.15*ready-.45*pulse,z=.37*sign*pulse)
        bend(tail,-.12*ready,z=.13*inhale+.25*pulse)
    elif species=='mouse':
        translate(body,z=.046*ready+.11*pulse)
        bend(head,-.24*ready-.16*pulse)
        for side,sign in (('L',-1),('R',1)):
            paw = .23 * warning * math.sin(t*math.tau*5+sign)
            bend(bones['Front'+side],-.24*ready-.31*pulse+paw,z=.24*sign*pulse)
        bend(tail,.34*ready,z=-.20*pulse)
    if 'Jaw' in bones:
        bend(bones['Jaw'],.44*pulse)
    if wide:
        breath=.45+.55*inhale
        if species not in ('dog','cat'):
            body.location += body.bone.matrix_local.to_3x3().inverted() @ Vector((0,0,-.024*breath*ready))
        head.rotation_euler.x += .07*breath*ready-.11*pulse
        tail.rotation_euler.z += .13*math.sin(t*math.tau)*ready


def alert_reaction(bones, species, clip, t):
    defensive_pose(bones,species,'guard',.13)
    head,body,tail=(bones[k] for k in ('Head','Body','Tail'))
    listen=window(0,.19,.36,.94,t)
    brace=window(0,.15,.47,.92,t)
    hold=window(.12,.41,.68,1,t)
    if clip.endswith('listen'):
        gain={'dog':.27,'cat':.20,'turtle':.16,'bird':.38,'mouse':.32,'dino':.23}[species]
        head.rotation_euler.x -= gain*listen
        head.rotation_euler.z += gain*.64*listen
        tail.rotation_euler.z -= gain*.48*listen
        if species == 'bird':
            translate(head,z=.077*listen)
        elif species in ('mouse','turtle'):
            translate(head,y=-.095*listen)
    elif clip.endswith('brace'):
        if species in ('dog','cat'):
            grounding(bones,brace,.13 if species=='dog' else .30,.13,-.025,.09,-.085)
            tail.rotation_euler.x += .36*brace
        elif species=='bird':
            for side,sign in (('L',-1),('R',1)):
                bend(bones['Front'+side],.12*brace,z=sign*.49*brace)
        elif species=='turtle':
            translate(head,y=.220*brace,z=-.083*brace)
        elif species=='mouse':
            translate(body,z=.063*brace)
            bend(bones['FrontL'],-.52*brace)
            bend(bones['FrontR'],-.42*brace)
        elif species=='dino':
            translate(body,y=-.076*brace)
            bend(bones['Jaw'],.21*brace)
        head.rotation_euler.x += .18*brace
    else:
        head.rotation_euler.x += .16*hold
        tail.rotation_euler.y += .19*hold
        if species=='bird':
            translate(head,y=-.079*hold)


def pose(rig, species, clip, t):
    bones = rig.pose.bones
    for bone in bones:
        bone.rotation_mode = 'XYZ'
        bone.location = (0,0,0)
        bend(bone)
        bone.scale = (1,1,1)

    body, head, tail = (bones[key] for key in ('Body','Head','Tail'))
    if clip.startswith('turn_'):
        turn_pose(bones,species,1 if clip.endswith('_right') else -1,t,
                  clip.startswith('turn_rear'),clip.startswith('turn_pivot'))
        return
    if clip.startswith('guard_react_'):
        alert_reaction(bones,species,clip,t)
        return
    if clip.startswith(('guard','threat_display')):
        defensive_pose(bones,species,clip,t)
        return
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
        elif clip == 'idle_scent':
            reach=window(.05,.24,.71,.92,t)
            grounding(bones,reach,.20,.065,-.091,-.02,-.105)
            translate(head,y=-.11*reach,z=-.094*reach+.021*reach*math.sin(t*math.tau*5))
            bend(head,.30*reach)
            bend(tail,.18*reach,z=.28*reach*math.sin(t*math.tau*2))
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
        elif clip == 'idle_stretch':
            stretch=window(.07,.27,.67,.93,t)
            grounding(bones,stretch,.44,.119,-.027,.13,-.24)
            bend(head,.16*stretch)
            bend(tail,.31*stretch,z=.07*stretch)
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
