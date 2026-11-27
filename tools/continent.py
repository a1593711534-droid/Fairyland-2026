"""Build the continent terrain, roads, and visual landmarks from the atlas data."""
import json
import math
import random
from array import array

from mathutils import Vector, noise


TAU = math.tau
COAST = [(-48,-14),(-55,-25),(-51,-31),(-44,-31),(-43,-38),(-36,-43),(-21,-42),(-12,-38),
    (-5,-34),(0,-38),(8,-38),(14,-34),(21,-38),(28,-41),(37,-38),(45,-34),(46,-29),
    (51,-23),(48,-15),(53,-9),(54,0),(49,3),(54,9),(50,15),(44,20),(37,20),(34,26),
    (30,30),(25,33),(19,32),(15,29),(12,33),(4,31),(0,35),(-3,42),(-6,47),(-9,46),(-10,40),
    (-13,38),(-10,33),(-16,30),(-21,32),(-25,29),(-29,31),(-35,27),(-38,25),(-40,28),(-44,23),
    (-48,22),(-51,15),(-46,12),(-49,8),(-51,2),(-54,-2),(-49,-8),(-53,-13),(-49,-17),(-51,-20)]
COAST_EDGES = list(zip(COAST,COAST[1:]+COAST[:1]))
ISLANDS = [(-56,-13,3,2),(-54,-35,3.7,1.8),(-46,-43,2.5,2.4),(-58,-22,1.8,3.2),
           (49,-36,3.1,1.7),(55,-22,2.1,1.2),(56,16,3,1.4),(38,28,2.8,2.3),
           (29,36,3.3,1.5),(20,37,2.5,2.0),(-15,40,2.2,1.4),(-49,28,2,1.6)]
RIVER = [(-3,-33),(-7,-26),(-3,-20),(1,-17),(5,-13),(2,-9),(5,-5),(4,-1),
         (2,2),(4,6),(7,10),(4,14),(2,18),(5,21),(1,27),(3,35)]
STREAM = [(-39,-19),(-31,-12),(-28,-8),(-28,-3),(-32,0),(-31,4),(-29,8),(-30,13),(-27,18)]
CIVIC_ROADS = [[(-17.4,-5.4),(-10,-7),(-4,-9),(1,-5),(4,1),(9.4,1.6),(20,2),(32,4)],
               [(-4,-9),(-11,-16),(-20,-25)],[(9.4,1.6),(12,10),(15,16),(15,23)],
               [(12,10),(5,17),(-2,25),(-6,34)],[(20,2),(23,-10),(26,-25)]]
PALETTES = [(.17,.216,.222),(.175,.059,.031),(.039,.102,.036),
            (.165,.231,.059),(.48,.239,.072),(.058,.175,.095)]
SEEDS = [(-30,-29),(25,-29),(-33,9),(3,-3),(42,1),(22,24)]


def smooth(a,b,v):
    t=max(0,min(1,(v-a)/(b-a)))
    return t*t*(3-2*t)


def mix(a,b,t):
    return tuple(u+t*(v-u) for u,v in zip(a,b))


def distance(p,a,b):
    dx,dz=b[0]-a[0],b[1]-a[1]
    sq=dx*dx+dz*dz
    t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/sq)) if sq else 0
    return math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz)


def gap(x,z,shape):
    return min(distance((x,z),a,b) for a,b in zip(shape,shape[1:]))


def river_curve(points):
    """Round the river bends without shifting the bridges and river towns."""
    result=[]
    for i in range(len(points)-1):
        p,a,b,q=(points[max(0,i-1)],points[i],points[i+1],points[min(i+2,len(points)-1)])
        for j in range(4):
            t=j/4
            result.append(tuple(.5*(2*u+(-w+v)*t+(2*w-5*u+4*v-s)*t*t+(-w+3*u-3*v+s)*t*t*t)
                                for w,u,v,s in zip(p,a,b,q)))
    return result+[points[-1]]


RIVER=river_curve(RIVER)


def signed_coast(x,z):
    inside=False
    for (a,b),(c,d) in COAST_EDGES:
        if (b>z)!=(d>z) and x<(c-a)*(z-b)/(d-b)+a:
            inside=not inside
    coast=min(distance((x,z),a,b) for a,b in COAST_EDGES)*(1 if inside else -1)
    for a,b,rx,rz in ISLANDS:
        coast=max(coast,(1-math.hypot((x-a)/rx,(z-b)/rz))*min(rx,rz))
    return coast


def value(x,z,scale,offset):
    return noise.fractal(Vector((x*scale,z*scale,offset)),1.02,2.1,4)


def proximity(x,z,a,b,rx,rz):
    return math.exp(-((x-a)/rx)**2-((z-b)/rz)**2)


def ground(x,z):
    rough=value(x,z,.27,1.71)
    broad=value(x,z,.11,5.11)
    coast=signed_coast(x,z)+rough*1.65+broad*1.52+value(x,z,.84,3.5)*.63
    weights=[math.exp(-((x-a)/19.5)**2-((z-b)/16.5)**2) for a,b in SEEDS]
    total=sum(weights) or 1
    weights=[w/total for w in weights]
    frost,ember,forest,river,sand,delta=weights
    mainwater=gap(x,z,RIVER)
    creek=gap(x,z,STREAM)
    lake=math.hypot((x+35.3)/4.8,(z-17.2)/3.15)
    river_width=.75+smooth(-19,33,z)*1.1
    flood=proximity(x,z,22,27,13,7)
    flood_channels=.47+.30*math.sin(x*.51+z*.65)+.24*math.sin(z*1.11-x*.64)+.11*rough
    maincut=max((1-smooth(river_width*.51,river_width*1.55,mainwater))*smooth(-32,-19,z),
                1-smooth(.35,1,creek),1-smooth(.79,1.09,lake),
                flood*smooth(.44,.87,flood_channels)*1.08)
    shore=smooth(-.40,2.02,coast)
    crease=value(x*.74+z*.44,z*1.28,.43,8.11)
    ridge=(1-min(1,abs(.57*broad+.79*crease)))**2.65
    spine=(1-min(1,abs(value(x*.70+z*.5,z*1.4,.27,2.51))))**5
    north=(7.0*proximity(x,z,-34,-30,14,15)+4.7*proximity(x,z,-20,-24,12,17))*(.39+.80*ridge+.39*spine)
    volcanic=(8.5*proximity(x,z,24,-30,18,15))*(.46+.79*ridge+.30*spine)
    q=math.hypot((x-31)/4,(z+31)/3.1)
    rim=math.exp(-((q-1)/.20)**2)*3.55-4.2*math.exp(-(q/.67)**2)
    dune_phase=x*.66+z*.35+1.8*math.sin(z*.21)+.4*rough
    dunes=(.52+.48*math.sin(dune_phase))**2.25*sand*1.91
    mesa = smooth(.22,.35,broad+.44*rough) * sand * 3.6
    rolling=(.56+.73*broad+.60*rough)*(.56+forest*2.35+river*.48+delta*.17)
    h=-.85+shore*(1.25+rolling + north + volcanic+rim+dunes+mesa)+min(0,coast)*.18
    h=h*(1-maincut*.79)-maincut*.78
    color=tuple(sum(weights[i]*c[j] for i,c in enumerate(PALETTES)) for j in range(3))
    if frost>.21:
        snow=smooth(5.15,8.65,h+1.27*rough)*smooth(.19,.56,frost)
        color=mix(color,(.72,.80,.82),snow)
    if ember>.33:
        clinker=smooth(.05,.63,rough+.50*math.sin(x*.64-z*.83))
        color=mix(color,(.084,.072,.070),clinker*ember*.85)
        color=mix(color,(.43,.107,.041), smooth(.5,.93,1-clinker)*ember*.62)
    if sand>.38:
        color=mix(color,(.82,.53,.228),sand*(.37+.32*math.sin(dune_phase+.20)))
    color=mix(color,(.43,.34,.192),(1-smooth(.12,1.91,coast))*smooth(-.1,.28,h)*.59)
    crags=value(x,z,.77,2.31)
    color=tuple(max(.010,v*(.83+rough*.25+broad*.38+crags*.17)) for v in color)
    return h,color,coast,weights


class ReferenceColors:
    def __init__(self, path):
        import bpy
        image=bpy.data.images.load(str(path),check_existing=True)
        self.width,self.height=image.size
        self.pixels=array('f',[0])*(self.width*self.height*4)
        image.pixels.foreach_get(self.pixels)

    def at(self,x,z):
        col=int(self.width*(.50 + x/121))
        row=int(self.height*(.53 + (z*.86)/88))
        if not (8<=col<self.width-8 and 8<=row<self.height-8):
            return None
        samples=[]
        for dx,dz in ((0,0),(-7,3),(7,-3),(-4,-7),(5,7)):
            i=((self.height-row-dz-1)*self.width+col+dx)*4
            r,g,b=self.pixels[i:i+3]
            if b>r*1.45 and g>r*1.28:
                continue
            samples.append(tuple(c/12.92 if c<.04045 else ((c+.055)/1.055)**2.4 for c in (r,g,b)))
        if not samples:
            return None
        return tuple(sum(row[i] for row in samples)/len(samples) for i in range(3))


def build(root, reset, material, mesh, pigment, export):
    reset()
    atlas=json.loads((root/'src/game/continent.json').read_text())
    rng=random.Random(522139)
    reference=ReferenceColors(root/'docs/concept-art/aelwen-continent.webp')
    nx,nz=269,219
    min_x,min_z,step=-64,-51, .48
    points,colors=[],[]
    for iz in range(nz):
        z=min_z+iz*step
        for ix in range(nx):
            x=min_x+ix*step
            height,color,coast,_=ground(x,z)
            painted=reference.at(x,z) if coast>.25 else None
            if painted is not None:
                # Keep the regional palettes distinct when reference perspective shifts.
                similar=max(0,1-sum(abs(a-b) for a,b in zip(color,painted))*1.32)
                color=mix(color,painted,.30*similar)
            points.append((x,-z,height))
            colors.append(color)
    heights={'minX':min_x,'minZ':min_z,'step':step,'width':nx,'rows':nz,
             'values':[round(p[2]*100) for p in points]}
    (root/'src/game/continent-heights.json').write_text(json.dumps(heights,separators=(',',':'))+'\n')
    faces=[(i,i+nx,i+nx+1,i+1) for z in range(nz-1) for x in range(nx-1) for i in [z*nx+x]]
    earth=material('Atlas relief','ffffff',.92)
    field=mesh('Sculpted continental relief',points,faces,[earth])
    layer=field.data.color_attributes.new('Regional albedo','BYTE_COLOR','POINT')
    import bpy
    tint=earth.node_tree.nodes.new('ShaderNodeVertexColor')
    tint.layer_name=layer.name
    earth.node_tree.links.new(tint.outputs['Color'],earth.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    for i,c in enumerate(colors):
        row,col=divmod(i,nx)
        here=points[i][2]
        east=points[i+1][2] if col+1<nx else here
        north=points[i-nx][2] if row else here
        shade=.67+.33*smooth(-.65,.22,.65*(here-east)+.75*(north-here))
        layer.data[i].color=(*(t*shade for t in c),1)
    def surface(x,z):
        col=(x-min_x)/step
        row=(z-min_z)/step
        c=max(0,min(nx-2,int(col)));r=max(0,min(nz-2,int(row)))
        a=max(0,min(1,col-c));b=max(0,min(1,row-r))
        return mix(mix(points[r*nx+c],points[r*nx+c+1],a),
                   mix(points[(r+1)*nx+c],points[(r+1)*nx+c+1],a),b)[2]

    mats={name:material(name,color,rough,metal) for name,color,rough,metal in [
          ('Slate','646a62',.87,0),('Ivory stone','dcc18f',.86,0),('Basalt','433837',.91,0),
          ('Old mortar','938873',.90,0),('Wood','735139',.94,0),('Blue slate roofs','3b6474',.77,0),
          ('Terracotta','a85132',.84,0),('Straw','aa8b55',.96,0),('Golden copper','d4a151',.61,.16),
          ('Window shade','251f1c',.95,0),('Cave depth','142027',1.0,0),('Glacial ice','84cddd',.51,.03),
          ('Spring water','327b74',.46,0),('Border ink','dbc08a',.92,0),('Trade roads','aa8857',.96,0),
          ('Footpaths','bf9b65',.95,0),('Conifer','35582c',.95,0),('Deciduous','637936',.95,0),
          ('Mangrove','315833',.92,0),('Bark','4f4434',.94,0),('Dry fields','928042',.97,0),
          ('Pasture rows','6d792c',.91,0),('Coastal rock','6c6254',.91,0)]}
    buffers={}
    def add(mat,verts,faces):
        vertices,polys=buffers.setdefault(mat,([],[]))
        offset=len(vertices)
        vertices.extend((x,-z,y) for x,z,y in verts)
        polys.extend(tuple(offset+i for i in reversed(f)) for f in faces)
    decks=[]
    def path(rows,width,mat,dashed=False,bridge=0):
        walked=0
        for a,b in zip(rows,rows[1:]):
            dx,dz=b[0]-a[0],b[1]-a[1]
            length=math.hypot(dx,dz)
            if not length:continue
            steps=max(1,math.ceil(length*5))
            ox,oz=-dz/length*width,dx/length*width
            for k in range(steps):
                t1,t2=k/steps,(k+1)/steps
                loc=walked+t1*length
                x,z=a[0]+dx*t1,a[1]+dz*t1
                if dashed and loc%1.45>.82:continue
                if surface(x,z)<.12 and not bridge:continue
                xx,zz=a[0]+dx*t2,a[1]+dz*t2
                row=[(x+ox,z+oz),(xx+ox,zz+oz),(xx-ox,zz-oz),(x-ox,z-oz)]
                add('Wood' if bridge and surface(x,z)<bridge else mat,
                    [(i,j,max(surface(i,j)+.05,bridge)) for i,j in row],[(0,1,2,3)])
                if bridge and k%3==0 and surface(x,z)<bridge-.13:
                    decks.append((x,z,bridge,math.atan2(dz,dx)))
            walked+=length

    for a,b,bends,*bridge in atlas['roads']:
        start,finish=(atlas['sites'][k] for k in (a,b))
        path([(start['x'],start['z']),*bends,(finish['x'],finish['z'])],.16 if bridge else .12,
             'Footpaths',False,bridge[0] if bridge else 0)
    for section in atlas['borders']:
        path(section,.052,'Border ink',True)
    for section in CIVIC_ROADS:
        path(section,.081,'Trade roads')

    def box(x,z,h,rx,rz,y,mat,angle=0):
        c,s=math.cos(angle),math.sin(angle)
        v=[(x+a*c-b*s,z+a*s+b*c,i) for i in (y,y+h) for a,b in [(-rx,-rz),(rx,-rz),(rx,rz),(-rx,rz)]]
        add(mat,v,[(3,2,1,0),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)])

    def ring(x,z,y,r,h,mat,tip=None,n=9):
        if tip is None:tip=r
        v=[(x+math.cos(TAU*i/n)*rad,z+math.sin(TAU*i/n)*rad,j) for rad,j in ((r,y),(tip,y+h)) for i in range(n)]
        add(mat,v,[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]+[tuple(range(n,2*n))])

    for x,z,y,a in decks:
        box(x,z,.13,.35,.23,y-.13,'Wood',a)
        for side in (-1,1):
            ring(x+side*math.sin(a)*.19,z-side*math.cos(a)*.19,-.10,.053,y+.19,'Wood')

    # Rock shoulders and the lighter coastal bed pick out the fjords.
    for i in range(460):
        a,b=COAST_EDGES[i%len(COAST_EDGES)]
        t=rng.random()
        x=a[0]+(b[0]-a[0])*t+rng.uniform(-1.1,1.1)
        z=a[1]+(b[1]-a[1])*t+rng.uniform(-1.1,1.1)
        y=surface(x,z)
        if .11<y<1.5 and (z<-15 or x<-39 or z>34 or x>43):
            r=rng.uniform(.13,.47)
            ring(x,z,y-.09,r,rng.uniform(.16,.49),'Coastal rock',r*rng.uniform(.23,.62),5)

    def roof(x,z,y,w,d,h,mat,angle=0):
        c,s=math.cos(angle),math.sin(angle)
        v=[(-w,-d,0),(w,-d,0),(w,d,0),(-w,d,0),(0,-d,h),(0,d,h)]
        add(mat,[(x+a*c-b*s,z+a*s+b*c,y+i) for a,b,i in v],
            [(0,1,4),(0,4,5,3),(1,2,5,4),(2,3,5)])

    def house(x,z,w,d,wall,top,y=None,angle=0):
        y=surface(x,z) if y is None else y
        h=w*.93
        box(x,z,h,w,d,y-.11,wall,angle)
        roof(x,z,y+h-.065,w*1.13,d*1.12,w*.91,top,angle)
        c,s=math.cos(angle),math.sin(angle)
        box(x-s*(d+.01),z+c*(d+.01),.34*w,.21*w,.035,y+.26*h,'Window shade',angle)
        for side in (-1,1):
            box(x+w*side*.57-s*d,z+c*d,.19*w,.11*w,.03,y+.60*h,'Window shade',angle)
        box(x+w*.48,z-d*.40,w*.73,w*.13,w*.14,y+h*.90,wall)
        if top in ('Blue slate roofs','Straw'):
            box(x,z,.069,w+.03,d+.03,y+.06*h,'Wood',angle)

    def rampart(x,z,r,y,stone,top,n=10):
        edge=[(x+r*math.cos(TAU*i/n),z+r*math.sin(TAU*i/n)) for i in range(n)]
        for i,(a,b) in enumerate(edge):
            c,d=edge[(i+1)%n]
            base=max(.34,(surface(a,b)+surface(c,d))/2)
            box((a+c)/2,(b+d)/2,.84,math.hypot(c-a,d-b)*.53,.145,base-.26,stone,math.atan2(d-b,c-a))
            ring(a,b,base-.3,.28,1.29,stone)
            ring(a,b,base+.97,.33,.49,top,.034)
            for j in range(1,5):
                t=j/5
                box(a+(c-a)*t,b+(d-b)*t,.20,.105,.15,base+.53,stone)

    def arch(x,z,y,w,h,stone,angle=0):
        c,s=math.cos(angle),math.sin(angle)
        for lr in (-1,1):
            box(x+c*w*lr,z+s*w*lr,h*.60,w*.22,w*.32,y,stone,angle)
        for i in range(9):
            t=i*math.pi/8
            a=math.cos(t)*w
            box(x+c*a,z+s*a,.27+h*.053,.23*w,.29*w,y+.55*h+math.sin(t)*.45*h,stone,angle+.3*math.cos(t))

    def cave(x,z,r,stone):
        y=surface(x,z)
        angle=.19
        arch(x,z,y-.04,r*.62,r*1.0,stone,angle)
        v=[(x+r*.62*math.cos(t*math.pi/12),z+.37,y+r*.75*math.sin(t*math.pi/12)) for t in range(13)]
        add('Cave depth',v,[tuple(range(13))])
        for i in range(6):
            jitter=(i-2.5)*r*.27
            ring(x+jitter,z-.31-abs(jitter)*.21,y-.19,r*.33,.53+r*.27*(i%3),stone,.16)
        for side in (-1,1):
            box(x+side*r*.52,z+.45,.47,.13,.31,y-.16,'Coastal rock',side*.36)

    for place in atlas['landmarks']:
        x,z,r,kind=(place[i] for i in ('x','z','radius','kind'))
        y=surface(x,z)
        if kind in ('capital','oasis','fort'):
            stone,top=('Ivory stone','Terracotta') if kind=='capital' else ('Golden copper','Straw') if kind=='oasis' else ('Slate','Blue slate roofs')
            rampart(x,z,r,y,stone,top,10 if kind=='capital' else 8)
            for j in range(31 if kind=='capital' else 13):
                angle=j*2.39996
                dist=r*(.29+.53*(j/31 if kind=='capital' else j/13))
                house(x+math.cos(angle)*dist,z+math.sin(angle)*dist,.33+rng.random()*.16,.38,stone,top,
                      angle=(j%4)*.36)
            keep=2.74 if kind=='capital' else 2.12
            box(x,z,keep,.86,.69,y-.15,stone)
            for side in (-1,1):
                ring(x+side*.72,z-.40,y,.29,keep+.40,stone)
                ring(x+side*.72,z-.40,y+keep+.37,.36,.71,top,.045)
            if kind=='oasis':
                ring(x,z,y+1.85,.76,.36,'Golden copper',.62)
                ring(x,z,y+2.20,.62,.48,'Golden copper',.039)
                ring(x+3.78,z+1.15,surface(x+3.78,z+1.15)+.019,.82,.035,'Spring water',n=20)
            else:roof(x,z,y+keep-.13,.93,.75,.84,top)
        elif kind in ('wood','harbor'):
            for j in range(7):
                angle=j*TAU/7
                a,b=x+math.cos(angle)*r*.61,z+math.sin(angle)*r*.54
                house(a,b,.30+rng.random()*.14,.40,'Ivory stone' if j%3==0 else 'Wood','Straw' if j%3==0 else 'Terracotta',
                      y=max(surface(a,b),.28) if kind=='harbor' else None,angle=angle)
            if kind=='harbor':
                for j in range(4):
                    a=x+(j-1)*.82
                    box(a,z+1.63,.14,.26,1.63,.31,'Wood')
                    for b in (z+2.90,z+2.12,z+1.28):
                        ring(a-.20,b,-.11,.067,.74,'Wood')
                        ring(a+.20,b,-.11,.067,.74,'Wood')
                for a,b in [(x+.63,z+2.47),(x-1.3,z+3.0)]:
                    ring(a,b,.06,.175,.14,'Wood',.27,7)
                    ring(a,b,.17,.028,.56,'Wood',.018)
        elif kind in ('ruin','temple','sunken'):
            stone='Basalt' if kind=='temple' else 'Old mortar'
            arch(x,z,max(y,.18),r*.50,r*.97,stone)
            for j in range(7):
                angle=j*TAU/7
                a,b=x+math.cos(angle)*r,z+math.sin(angle)*r*.63
                box(a,b,.38+(j%4)*.25,.18,.22,max(surface(a,b),.04),stone,angle)
            if kind=='sunken':
                for a,b in [(-.67,.65),(.68,.74),(.48,-.60)]:
                    y0=max(.055,surface(x+a,z+b)+.017)
                    for s in (-1,1):
                        box(x+a+s*.38,z+b,.105,.056,.46,y0,stone)
                        box(x+a,z+b+s*.42,.105,.40,.056,y0,stone)
            for j in range(3):
                box(x,z+.55+j*.32,.12,.82-j*.08,.25,max(y,.11)-j*.02,stone)
        elif kind=='camp':
            for a,b in [(-.8,.3),(.45,.34),(-.25,1.0)]:
                roof(x+a,z+b,surface(x+a,z+b),.42,.37,.52,'Straw')
            ring(x-1.13,z-.3,surface(x-1.13,z-.3)+.013,.38,.028,'Spring water',n=14)
        elif kind=='tower':
            ring(x,z,y-.2,.49,1.6,'Ivory stone',.36,12)
            ring(x,z,y+1.27,.47,.20,'Slate')
            ring(x,z,y+1.43,.37,.30,'Golden copper',.14)
        elif kind in ('ice-cave','sand-cave','lava-cave'):
            cave(x,z,r,{'ice-cave':'Glacial ice','sand-cave':'Old mortar','lava-cave':'Basalt'}[kind])

    # A bridge between the capital road and the west bank.
    for x in [1.6,2.3,3.0,3.7,4.4]:
        y=max(.81,surface(x,1.5))
        box(x,1.5,.16,.38,.29,y,'Ivory stone')
        ring(x,1.48,.02,.12,y,'Old mortar',.09,6)
    for x,z,w,d in [(-8,-6,2.8,1.8),(-3,-1,2.1,2.1),(8,8,2.5,2.3),(9,13,2.4,1.7),
                     (-3,7,2.1,1.5),(12,-6,2.7,1.7),(14,5,2.7,1.4),(-3,-19,2.2,1.7)]:
        for j in range(12):
            xx,zz=x+j*w/12,z+math.sin(j*.28)*.38
            if surface(xx,zz)>.24:
                path([(xx,zz),(xx+.44,zz+d)],.063,'Dry fields' if j%3 else 'Pasture rows')
    for x,z in [(0,-15),(12,-4),(-5,6),(8,13),(13,16)]:
        for j in range(3):
            a,b=x+.71*j,z+math.sin(j*2.12)*.41
            if surface(a,b)>.27:
                house(a,b,.27+.04*j,.29,'Ivory stone','Terracotta',angle=.21*j)

    # Clearings remain open around the six playable routes and all landmarks.
    clear=[(p['x'],p['z'],p['radius']+.95) for p in atlas['landmarks']]
    local=[[(atlas['sites'][a]['x'],atlas['sites'][a]['z']),*bend,(atlas['sites'][b]['x'],atlas['sites'][b]['z'])]
           for a,b,bend,*_ in atlas['roads']]
    for _ in range(22600):
        x,z=rng.uniform(-57,54),rng.uniform(-43,37)
        y=surface(x,z)
        if y<.19 or y>6.3:continue
        if any(math.hypot(x-a,z-b)<r for a,b,r in clear):continue
        if gap(x,z,RIVER)<1.65 or min(gap(x,z,route) for route in local+CIVIC_ROADS)<.33:continue
        coverage=proximity(x,z,-32,5,19,25)*1.37+proximity(x,z,24,22,14,12)*1.02+proximity(x,z,-8,-12,15,15)*.39
        stand=smooth(-.36,.35,value(x,z,.20,3.2)+.12*value(x,z,.42,3.63))
        if rng.random()>coverage*(.13+.77*stand):continue
        h=.37+rng.random()*.69
        rad=h*(.32+rng.random()*.19)
        typ='Mangrove' if x>8 and z>14 else 'Deciduous' if rng.random()<.33 else 'Conifer'
        ring(x,z,y-.05,rad*.20,h*.64,'Bark',rad*.14,4)
        for j in range(2):
            ring(x,z,y+h*(.27+.25*j),rad*(1-.30*j),h*(.50 if typ=='Conifer' else .39),
                 typ,rad*.055 if typ=='Conifer' else rad*.30,5)

    for name,(vertices,polys) in buffers.items():
        mesh('Atlas '+name,vertices,polys,[mats[name]],smooth=False)

    # Two overlapping spans reduce ocean geometry far from the shoreline.
    ocean=material('Atlas sea','ffffff',.84,0)
    sea_points, sea_colors=[],[]
    width,rows=148,122
    for j in range(rows):
        z=-53+j*.89
        for i in range(width):
            x=-65+i*.89
            edge=max(0.,-signed_coast(x,z))
            h=surface(x,z)
            ripple=value(x,z,.52,6.64)
            bank=smooth(-1.07,-.12,h+.088*ripple)
            coastal=smooth(7,0,edge)
            bounded=smooth(0,5,min(x+65,65-x,z+53,54-z))
            pigment_color=mix((.010,.064,.077),(.031,.192,.161),bounded*(bank*.65+coastal*.35))
            pigment_color=mix(pigment_color,(.129,.29,.228),.48*bank**3*bounded)
            sea_colors.append(tuple(c*(1+ripple*.14) for c in pigment_color))
            sea_points.append((x,-z,.035))
    water=mesh('Sea and coastal shallows',sea_points,
               [(i,i+width,i+width+1,i+1) for j in range(rows-1) for k in range(width-1) for i in [j*width+k]],[ocean])
    mesh('Open ocean',[(-255,-255,.01),(255,-255,.01),(255,255,.01),(-255,255,.01)],[(0,1,2,3)],[ocean])
    pigment(water,ocean,lambda p:sea_colors[round((-p.y+53)/.89)*width+round((p.x+65)/.89)])
    floor=bpy.data.objects['Open ocean']
    pigment(floor,ocean,lambda p:(.010,.064,.077))
    export('continent')
