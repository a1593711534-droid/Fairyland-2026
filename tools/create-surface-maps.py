"""Prepare WebP PBR surfaces from ambientCG Rock030 and original procedural maps."""
from pathlib import Path
import math
import sys

import numpy as np
from PIL import Image, ImageEnhance, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'art' / 'surfaces'
SIZE = 512


def image(data):
    return Image.fromarray(np.uint8(np.clip(data, 0, 255)))


def write(value, surface, layer, quality=82):
    target = OUT / (surface + '-' + layer + '.webp')
    value.save(target, quality=quality, method=6)


def normals(height, gain):
    dx = (np.roll(height,-1,axis=1)-np.roll(height,1,axis=1))*gain
    dy = (np.roll(height,-1,axis=0)-np.roll(height,1,axis=0))*gain
    v=np.stack((-dx,dy,np.ones_like(height)),axis=-1)
    return image(127.5 + 127.5*v/np.linalg.norm(v,axis=-1,keepdims=True))


def field(rng, resolution):
    a = rng.uniform(-1,1,(resolution,resolution))
    tiled = np.tile(a,(3,3))
    tex = image((tiled+1)*127.5).resize((SIZE*3,SIZE*3), Image.Resampling.BICUBIC)
    return np.asarray(tex.crop((SIZE,SIZE,SIZE*2,SIZE*2)),dtype=np.float32)/127.5-1


def paint(surface,height,low,high,strength):
    t=np.clip(height*.57+.5,0,1)
    blend=np.array(low)[None,None,:]*(1-t[...,None])+np.array(high)[None,None,:]*t[...,None]
    write(image(blend),surface,'color',82)
    write(normals(height,strength),surface,'normal',87)


if __name__=='__main__':
    src=Path(sys.argv[1]).resolve()
    OUT.mkdir(exist_ok=True)
    def load(suffix):
        return Image.open(next(src.glob('*_'+suffix+'.jpg'))).convert('RGB').resize((SIZE,SIZE),Image.Resampling.LANCZOS)
    rock=load('Color')
    write(ImageEnhance.Color(rock).enhance(.66),'stone','color',83)
    write(load('NormalGL'),'stone','normal',88)
    write(load('Roughness'),'stone','rough',78)
    detail=np.asarray(ImageOps.grayscale(rock),dtype=np.float32)/127.5-1
    rng=np.random.default_rng(52915)
    coarse, mid, fine=(field(rng,f) for f in (9,26,76))
    ground=.57*coarse+.31*mid+.21*fine+.18*detail
    paint('soil',ground,(78,75,44),(189,175,121),4.9)
    x,y=np.meshgrid(np.linspace(0,math.tau,SIZE,endpoint=False), np.linspace(0,math.tau,SIZE,endpoint=False))
    ribs=.345*np.sin(x*35+2.8*coarse+.5*np.sin(y*4))+.19*np.sin(x*59+2.7*mid)
    bark=ribs+.24*coarse+.27*mid+.23*detail
    paint('bark',bark,(62,54,42),(160,145,104),8.0)
    woven=.18*np.cos(x*94+.38*np.sin(y*31))+.18*np.cos(y*100+.4*np.sin(x*31))+.32*mid+.19*fine
    paint('cloth',woven,(161,156,147),(250,244,226),2.0)
    grained=.38*mid+.33*fine+.26*detail
    paint('hide',grained,(122,101,82),(236,222,184),2.65)

    column, row = x/math.tau, y/math.tau
    rows = np.floor(row*16)
    scale_x = (column*12 + .5*(rows%2))%1 - .5
    scale_y = (row*16)%1
    keel = np.sin(math.pi*scale_y)**.72 * np.cos(math.pi*scale_x)**1.7
    rim = np.exp(-((scale_y-.22-.77*scale_x**2)/.065)**2)
    write(normals(keel*.28-rim*.096 + fine*.038,3.4),'scales','normal',85)
    nap = np.cos(x*94+.95*np.sin(y*7)+2.6*mid)
    fine_nap = np.cos(x*143+np.sin(y*11)+1.6*fine)
    write(normals(nap*.115+fine_nap*.039 + .07*mid,1.8),'fur','normal',84)
    rachis = np.cos(x*22+.61*np.sin(y*5))
    barbs = np.cos(y*66 + 2.6*abs(np.sin(x*22)) + .3*mid)
    write(normals(rachis*.085 + barbs*.071 + .021*fine,1.86),'plume','normal',83)
