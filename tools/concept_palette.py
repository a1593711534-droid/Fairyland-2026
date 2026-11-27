"""Sample color bands from the orthographic front and side concept views."""
from array import array
from bisect import bisect_right
from pathlib import Path

import bpy


ART = Path(__file__).resolve().parents[1] / 'docs' / 'concept-art'

# Marks along the profile run from nose through shoulder, hip and tail tip.
# The vertical marks are the floor, lower legs, chest, eye line and head.
VIEWS = {
    'turtle': ('moon-turtle-ember-drake', ((-1.21,47),(-.91,108),(-.47,198),(.11,374),(.67,605),(1.15,740)),
               ((0,342),(.20,304),(.51,235),(.70,177),(1.28,61)), 1021, 293, 1.37),
    'dino': ('moon-turtle-ember-drake', ((-1.32,35),(-.91,112),(-.46,211),(.04,302),(.47,391),(2.28,798)),
             ((0,820),(.32,774),(.68,692),(1.08,579),(1.54,461),(1.97,392)), 983, 183, 1.99),
    'cat': ('moss-cat-wind-bird', ((-1.10,47),(-.79,91),(-.46,167),(.05,279),(.54,407),(1.68,724)),
            ((0,466),(.36,400),(.92,287),(1.34,225),(1.63,142),(2.17,34)), 861, 217, 2.0),
    'bird': ('moss-cat-wind-bird', ((-.96,62),(-.57,132),(-.23,212),(.12,307),(.49,414),(1.51,645)),
             ((0,970),(.34,909),(.78,826),(1.25,747),(1.59,632),(2.17,542)), 856, 253, 1.73),
    'mouse': ('storm-mouse-frost-hound', ((-.86,73),(-.59,124),(-.30,208),(.12,327),(.48,439),(1.51,685)),
              ((0,278),(.16,249),(.43,226),(.69,158),(.98,94),(1.20,37)), 947, 365, 1.66),
    'dog': ('storm-mouse-frost-hound', ((-1.23,58),(-.87,133),(-.47,222),(.09,348),(.63,483),(1.53,646)),
            ((0,839),(.36,770),(.88,661),(1.26,563),(1.68,443),(2.19,336)), 946, 222, 1.86),
}

# Coordinates are in each published evolution sheet. Each profile uses its
# own shoulder, eye and ground marks rather than a scaled starting form.
EVOLVED_VIEWS = {
    'turtle': ('tideback-magma-drake', ((-1.59,32),(-1.24,94),(-.73,217),(.04,346),(.72,557),(1.28,726)),
               ((0,345),(.23,290),(.61,222),(1.18,131),(1.87,32)), 1015, 202, 1.52),
    'dino': ('tideback-magma-drake', ((-1.45,34),(-1.11,110),(-.61,183),(-.10,304),(.49,425),(2.49,783)),
             ((0,823),(.42,770),(.90,679),(1.37,568),(2.06,453),(2.78,385)), 982, 174, 1.65),
    'cat': ('grove-lynx-gale-bird', ((-1.21,40),(-.83,102),(-.49,166),(.13,290),(.62,449),(1.96,720)),
            ((0,471),(.39,420),(.93,335),(1.47,244),(1.92,132),(2.68,24)), 844, 162, 1.82),
    'bird': ('grove-lynx-gale-bird', ((-1.04,47),(-.68,113),(-.34,164),(.09,256),(.67,393),(1.93,674)),
             ((0,978),(.38,923),(.85,842),(1.24,753),(1.92,623),(2.52,533)), 843, 218, 1.62),
    'mouse': ('thunder-mouse-glacier-hound', ((-.91,66),(-.60,120),(-.35,201),(.07,315),(.50,421),(1.77,673)),
              ((0,289),(.15,269),(.42,226),(.78,157),(1.16,91),(1.62,35)), 927, 229, 1.74),
    'dog': ('thunder-mouse-glacier-hound', ((-1.28,56),(-.98,131),(-.63,208),(-.13,314),(.54,471),(1.75,685)),
            ((0,843),(.38,783),(.83,689),(1.35,591),(1.94,455),(2.74,324)), 933, 211, 1.70),
}


def line(marks, value):
    index = max(0, min(len(marks)-2, bisect_right(marks, (value,float('inf')))-1))
    x0,y0 = marks[index]
    x1,y1 = marks[index+1]
    return y0 + (y1-y0)*(value-x0)/(x1-x0)


def linear(value):
    return value/12.92 if value <= .04045 else ((value+.055)/1.055)**2.4


class OrthographicPalette:
    def __init__(self, kind, evolved):
        views = EVOLVED_VIEWS if evolved else VIEWS
        sheet,self.profile,self.height,self.center,self.horizontal,self.strength = views[kind]
        image = bpy.data.images.load(str(ART / (sheet+'.webp')), check_existing=True)
        self.width,self.rows = image.size
        self.colors = array('f',[0]) * (self.width*self.rows*4)
        image.pixels.foreach_get(self.colors)

    def read(self, x, y):
        if x < 4 or x >= self.width-4 or y < 3 or y >= self.rows-3:
            return None
        row = self.rows-1-int(y)
        i = (row*self.width+int(x))*4
        # The turnaround backdrop is nearly uniform within each scanline.
        bg = (row*self.width+self.width-3)*4
        contrast = sum(abs(self.colors[i+k]-self.colors[bg+k]) for k in range(3))
        if contrast < .23:
            return None
        tone = self.colors[i:i+3]
        return tuple(min(1,linear(c)*1.10) for c in tone)

    def paint(self, tint, point, normal):
        vertical = line(self.height,point.z)
        edge = line(self.profile,point.y)
        front = self.read(self.center+point.x*self.horizontal,vertical)
        side = self.read(edge,vertical)
        front_weight = max(0,-normal.y)**1.3 if front else 0
        side_weight = abs(normal.x)**1.2 if side else 0
        total = front_weight+side_weight
        if total < .14:
            return tint
        amount = min(.54, .265*self.strength*total)
        return tuple(tint[i]*(1-amount)+amount*((front[i]*front_weight if front else 0) +
            (side[i]*side_weight if side else 0))/total for i in range(3))
