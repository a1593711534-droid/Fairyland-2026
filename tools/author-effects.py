"""Author and compile the Fairyland effects with Effekseer 1.80.8."""
import math
import os
from pathlib import Path
import subprocess
import sys
from xml.etree import ElementTree as X

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parents[1] / 'public' / 'art' / 'fx'
SOURCE = OUT.parents[2] / '.art-cache' / 'effects'
EDITOR = Path(sys.argv[1]).resolve()
PALETTES = {
    'water': ((105,205,255), (187,249,255), 'wave'),
    'fire': ((255,104,46), (255,214,113), 'flame'),
    'earth': ((234,151,75), (255,217,149), 'chip'),
    'thunder': ((212,151,255), (253,235,255), 'bolt'),
    'ice': ((127,221,255), (234,251,255), 'flake'),
    'wind': ((127,244,179), (225,255,219), 'leaf'),
}


def grid(mask):
    size = 168
    im = Image.new('L',(size,size))
    d = ImageDraw.Draw(im)
    center = size/2
    if mask in ('seal','halo','aura','wave'):
        # Radiant gradients and filigree, drawn at twice the runtime resolution.
        for y in range(size):
            for x in range(size):
                u,v = (x-center)/center,(y-center)/center
                angle, r = math.atan2(v,u),math.hypot(u,v)
                if mask == 'seal':
                    edge = max(math.exp(-((r-.79)/.011)**2), math.exp(-((r-.59)/.010)**2))
                    marks = math.exp(-((r-.70)/.055)**4) * max(0, math.cos(angle*24))**9
                    petals = math.exp(-((r-(.49+.075*math.cos(angle*6)))/.007)**2)
                    value = max(edge*.85, marks*.72, petals*.54)
                elif mask == 'halo':
                    value = math.exp(-((r-.74)/.066)**2)*(.62+.26*math.cos(angle*3 + r*6))
                elif mask == 'wave':
                    value = math.exp(-((r-.57-.067*math.cos(angle*5))/ .023)**2)*(.68+.28*math.cos(angle*3))
                else:
                    value = max(0,math.exp(-r*r*5.6)-.06) ** 1.9
                im.putpixel((x,y),min(255,int(max(0,value)*255)))
    elif mask == 'bolt':
        branches = [[(80,12),(72,38),(104,54),(67,83),(89,107),(57,139),(66,160)],
            [(104,54),(124,72),(111,91),(143,104)],[(67,83),(39,90),(23,118),(12,119)],
            [(89,107),(103,130),(119,139)]]
        for i,line in enumerate(branches):
            d.line(line, fill=240 if not i else 170, width=4 if not i else 2)
    elif mask == 'flake':
        for branch in range(6):
            a=branch*math.tau/6
            def point(rad, angle):
                return (center+math.cos(angle)*rad,center+math.sin(angle)*rad)
            d.line((point(0,a),point(70,a)),fill=250,width=3)
            for r in (29,50):
                for s in (-1,1):
                    d.line((point(r,a),point(r+16,a+s*.28)),fill=211,width=3)
    elif mask == 'flame':
        d.polygon([(37,130),(29,104),(53,81),(45,65),(73,42),(79,12),(99,45),(105,67),
                   (122,51),(128,90),(142,113),(124,149),(96,158),(67,151)],fill=203)
        d.polygon([(68,145),(52,121),(74,94),(81,66),(94,89),(95,105),(112,90),(116,124),(106,148)],fill=250)
    elif mask == 'leaf':
        d.polygon([(16,103),(61,66),(157,69),(129,92),(103,110),(62,120)],fill=198)
        d.line([(24,105),(79,93),(137,76)],fill=255,width=3)
    else:
        d.polygon([(64,11),(117,28),(143,81),(105,152),(43,135),(23,72)],fill=173)
        d.line([(64,11),(83,64),(105,152)],fill=248,width=3)
        d.line([(23,72),(83,64),(143,81)],fill=220,width=2)
    if mask not in ('seal','halo','aura','wave'):
        blur=im.filter(ImageFilter.GaussianBlur(7)).point(lambda p: int(p*.42))
        blur.paste(im,mask=im)
        im=blur
    rgba = Image.new('RGBA',(size,size),(255,255,255))
    rgba.putalpha(im)
    rgba.save(OUT / (mask+'.png'), optimize=True)


def put(parent, key, value=None):
    child=X.SubElement(parent,key)
    if value is not None:
        child.text=str(value)
    return child


def vec(parent, key, xyz, spread=None):
    n=put(parent,key)
    for axis,num,j in zip('XYZ', xyz, spread or (0,0,0)):
        if spread is None:
            put(n,axis,num)
        else:
            dimension=put(n,axis)
            put(dimension,'Center',num)
            put(dimension,'Min',round(num-j,5))
            put(dimension,'Max',round(num+j,5))
            put(dimension,'DrawnAs',1)
    if spread is not None:
        put(n,'DrawnAs',1)
    return n


def add_layer(group,label,texture,rgb,*, delay=0, life=36, count=1, period=1, center=(0,0,0),
              spread=(0,0,0), velocity=(0,0,0), jitter=(0,0,0), gravity=0, size=1, growth=0,
              ground=False, opacity=220, rotate=0):
    n=put(group,'Node')
    put(n,'IsRendered','True')
    put(n,'Name',label)
    common=put(n,'CommonValues')
    put(put(common,'MaxGeneration'),'Value',count)
    timer=put(common,'Life')
    for key in ('Center','Min','Max'):
        put(timer,key,life)
    put(common,'GenerationTime',period)
    put(common,'GenerationTimeOffset',delay)
    loc=put(n,'LocationValues')
    put(loc,'Type',1)
    pva=put(loc,'PVA')
    vec(pva,'Location',center,spread)
    vec(pva,'Velocity',velocity,jitter)
    vec(pva,'Acceleration',(0,gravity,0),(0,0,0))
    rot=put(n,'RotationValues')
    put(rot,'Type',1)
    pva=put(rot,'PVA')
    vec(pva,'Rotation',(-90 if ground else 0,0,0),(0,0,8 if ground else 24))
    vec(pva,'Velocity',(0,0,rotate),(0,0,.12))
    scale=put(n,'ScalingValues')
    put(scale,'Type',1)
    pva=put(scale,'PVA')
    vec(pva,'Scale',(size,size,size),(size*.055,)*3)
    vec(pva,'Velocity',(growth,)*3,(0,0,0))
    rc=put(n,'RendererCommonValues')
    put(rc,'ColorTexture',texture+'.png')
    put(rc,'AlphaBlend',2)
    put(rc,'FadeInType',1)
    put(put(rc,'FadeIn'),'Frame',max(1,min(8, life//5)))
    put(rc,'FadeOutType',1)
    put(put(rc,'FadeOut'),'Frame',max(1,int(life*.55)))
    draw=put(n,'DrawingValues')
    put(draw,'Type',2)
    sprite=put(draw,'Sprite')
    put(sprite,'Billboard',0 if ground else 1)
    put(sprite,'ColorAll',0)
    tint=put(sprite,'ColorAll_Fixed')
    for key,value in zip('RGBA',(*rgb,opacity)):
        put(tint,key,value)


def write_effect(element, kind, primary, light, shape):
    doc=X.Element('EffekseerProject')
    root=put(doc,'Root')
    put(root,'IsRendered','True')
    put(root,'Name','Fairyland')
    children=put(root,'Children')
    put(doc,'Version',3)
    put(doc,'StartFrame',0)
    put(doc,'EndFrame',105)
    put(doc,'IsLoop','False')
    layer=lambda *args,**kwargs: add_layer(children,*args,**kwargs)
    if kind=='cast':
        layer('Core spell flare','aura',light,life=28,size=1.15,opacity=202)
        layer('Moving shaped spark',shape,primary,life=21,count=7,period=2,
              spread=(.19,.15,.19), velocity=(0,.008,0), jitter=(.017,.014,.017),size=.52,growth=.012)
    elif kind=='impact':
        layer('Impact flash','aura',light,life=24,size=.7,growth=.108,opacity=190)
        layer('Ground shock','halo',primary,life=38,center=(0,.13,0),ground=True,size=.4,growth=.115)
        layer('Fragments',shape,primary,life=30,count=17,period=1,center=(0,.35,0),
              spread=(.22,.15,.22),velocity=(0,.067,0),jitter=(.103,.082,.103),
              gravity=-.004,size=.68,growth=-.0075,opacity=226)
    else:
        inward=kind=='capture'
        evolution=kind=='evolve'
        glyph='wave' if element=='water' else 'seal'
        introduction=2 if inward else 13
        layer('Ground inscription',glyph,primary,life=70,ground=True,center=(0,.14,0),
              size=3.25 if inward else 1.05,growth=-.026 if inward else .036,rotate=.66,opacity=213)
        layer('Sigil reverberation','halo',light,delay=introduction,life=45,ground=True,center=(0,.21,0),
              size=3.82 if inward else .65,growth=-.06 if inward else .087,opacity=202)
        layer('Light well','aura',primary,delay=introduction,life=49,center=(0,.70,0),size=2.35,growth=.018,opacity=138)
        for i in range(5):
            angle=i*math.tau/5 + (.35 if inward else .1)
            x,z=math.cos(angle),math.sin(angle)
            scatter={
                'fire':(.057,.071,-.0004), 'water':(.088,.037,-.0023), 'earth':(.054,.048,-.0038),
                'thunder':(.026,-.077,.0018), 'ice':(.080,.039,-.0011), 'wind':(.094,.058,-.0001),
            }[element]
            horizontal,vertical,gravity=scatter
            layer('Element filament '+str(i+1),shape,light if i%2 else primary,delay=introduction+i*3,
                  life=44, count=3 if not evolution else 5,period=3,
                  center=(x*(1.65 if inward else .56),2.6 if element=='thunder' else .38,z*(1.65 if inward else .56)),
                  spread=(.19,.21,.19), velocity=(x*(-.065 if inward else horizontal),vertical,z*(-.065 if inward else horizontal)),
                  jitter=(.025,.033,.025), gravity=gravity,size=.75 if element!='thunder' else 1.30,
                  growth=.019 if evolution else -.006,rotate=1.6,opacity=218)
        if evolution:
            layer('Transformation crown','seal',(255,238,183),delay=26,life=66,center=(0,1.6,0),
                  size=1.5,growth=.05,rotate=1.8,opacity=244)
    X.indent(doc)
    path=SOURCE / f'{kind}-{element}.efkproj'
    X.ElementTree(doc).write(path,encoding='utf-8',xml_declaration=True)
    # Effekseer resolves texture names relative to the editable project.
    subprocess.run([EDITOR,'-cui','-in',path,'-e',OUT / f'{kind}-{element}.efk'], check=True)


if __name__=='__main__':
    SOURCE.mkdir(parents=True,exist_ok=True)
    for name in ('seal','halo','aura','wave','bolt','flake','flame','leaf','chip'):
        grid(name)
        (SOURCE/(name+'.png')).write_bytes((OUT/(name+'.png')).read_bytes())
    for element,(a,b,shape) in PALETTES.items():
        for kind in ('cast','impact','summon','capture','evolve'):
            write_effect(element,kind,a,b,shape)
