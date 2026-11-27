"""Paint leaf clusters with translucent edges, veins and diffuse shadow."""
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parents[1] / 'public/art/surfaces'
SIZE = 512


def atlas():
    rng = random.Random(331983)
    frame = Image.new('RGBA',(SIZE,SIZE))
    sprigs = [(a,rng.uniform(63,211)) for a in [i*2.399963 for i in range(17)]]
    for a, length in sprigs:
        x0,y0 = (257+24*math.cos(a*.49),258+17*math.sin(a))
        x1,y1 = x0+length*math.cos(a),y0+length*.82*math.sin(a)
        d = ImageDraw.Draw(frame)
        d.line([(x0,y0),((x0+x1)/2,(y0+y1)/2+13),(x1,y1)], fill=(92,89,50,235), width=2)
    leaves = []
    for a,length in sprigs:
        for i in range(2,11):
            t = i/11
            x = 257+24*math.cos(a*.49)+length*t*math.cos(a)
            y = 258+17*math.sin(a)+length*.82*t*math.sin(a)+9*math.sin(math.pi*t)
            phase = a + (1 if i%2 else -1)*rng.uniform(.56,1.38)
            leaves.append((rng.random(),x,y,phase,rng.uniform(29,65)*(1-.31*t),rng.uniform(.25,.44)))
    for height,x,y,a,length,ratio in sorted(leaves):
        layer = Image.new('RGBA',(SIZE,SIZE))
        d = ImageDraw.Draw(layer)
        xvec,yvec = (math.cos(a),math.sin(a)),(-math.sin(a),math.cos(a))
        w = length*ratio
        def point(t,s):
            return (x+xvec[0]*t*length+yvec[0]*s*w,y+xvec[1]*t*length+yvec[1]*s*w)
        edges = [point(i/20,(math.sin(math.pi*i/20)**.83)*(1-.37*i/20)*
                       (1+.075*math.sin(i*2.9))) for i in range(21)]
        other = [point(i/20,-.79*(math.sin(math.pi*i/20)**.85)*(1-.25*i/20)*
                       (1+.09*math.cos(i*2.81))) for i in range(20,-1,-1)]
        shade = .67+.40*height
        dark = tuple(int(c*shade) for c in (48,84,36))
        light = tuple(int(c*shade) for c in (103,136,55))
        d.polygon(edges+other,fill=dark+(255,))
        d.polygon(edges+[point(.61,.06),point(.13,.07)],fill=light+(255,))
        vein = tuple(int(c*shade) for c in (141,146,74))
        d.line([point(.04,.01),point(.37,.09),point(.80,.05),point(.98,0)],fill=vein+(255,),width=1)
        for j in range(2,10):
            u = j*.086
            span = math.sin(math.pi*u)*.61
            for direction in (-1,1):
                target = min(.97,u+.15)
                d.line([point(u,.06),point(u+.075,direction*span*.45),point(target,direction*span)],
                       fill=vein+(90,),width=1)
        blade = layer.getbbox()
        if blade:
            part = layer.crop(blade)
            frame.alpha_composite(part,(blade[0],blade[1]))
    transparent = frame.getchannel('A')
    frame = frame.filter(ImageFilter.GaussianBlur(.24))
    frame.putalpha(transparent)
    OUT.mkdir(exist_ok=True)
    frame.save(OUT/'alder-canopy.webp',quality=89,method=6)


if __name__ == '__main__':
    atlas()
