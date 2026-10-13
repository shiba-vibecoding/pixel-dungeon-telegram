import sys, colorsys; sys.path.insert(0,'/home/claude/world')
from PIL import Image
SKIN={(0xdc,0xb4,0x97),(0xb8,0x97,0x78),(0xff,0xda,0xbf),(0x85,0x59,0x38),(0xbe,0x7f,0x59),(0xff,0xba,0x8f)}
def hsv(c): return colorsys.rgb_to_hsv(*(v/255 for v in c))
def rgb(h,s,v): return tuple(int(round(x*255)) for x in colorsys.hsv_to_rgb(h%1,max(0,min(1,s)),max(0,min(1,v))))
def hair_palette(im, cell_w, cell_h, frames, top=4, skin=SKIN):
    hp=set()
    for f in frames:
        for y in range(top):
            for x in range(cell_w):
                c=im.getpixel((f*cell_w+x,y))
                if c[3] and c[:3] not in skin and c[:3]!=(0,0,0): hp.add(c[:3])
    return hp
def recolor(im, kind, hair, skin=SKIN):
    out=im.copy(); p=out.load(); cache={}
    for y in range(im.height):
        for x in range(im.width):
            c=p[x,y]
            if not c[3]: continue
            k=c[:3]
            if k in skin or k==(0,0,0): continue
            if k not in cache:
                h,s,v=hsv(k); ishair=k in hair
                if kind=='ash':
                    n=rgb(h, s*0.08, min(1,v*1.08)) if ishair else rgb(h, s*0.32, v)
                elif kind=='royal':
                    if ishair: n=k
                    elif v<0.22: n=rgb(0.78, 0.55, v*1.1)        # контур и тени — тёмный пурпур
                    elif s<0.28: n=rgb(0.12, 0.45+0.25*v, min(1,v*1.02))   # металл и светлая ткань — золото
                    else: n=rgb(0.80, min(1,s*0.85+0.1), v*0.82)          # цветная ткань и кожа ремней — пурпур
                elif kind=='shadow':
                    n=rgb(0.0, 0.0, v*0.22) if ishair else rgb(0.74, min(1,s*0.5+0.28), v*0.52+0.03)
                cache[k]=n
            n=cache[k]; p[x,y]=(n[0],n[1],n[2],c[3])
    return out

def rule(k, kind, ishair):
    h,s,v=hsv(k)
    if kind=='ash':
        if ishair: return rgb(0.11, 0.08, 0.73 if v>=0.77 else 0.59 if v>=0.65 else 0.42)
        return rgb(h if s>0.05 else 0.11, s*0.35 if s>0.05 else 0.03, 0.80*v+0.06)
    if kind=='royal':
        if ishair: return k
        if s<0.22: return rgb(0.12, 0.70-0.3*v, 0.85*v+0.11)
        return rgb(0.74, min(0.85, s+0.14), 0.95*v)
    if kind=='shadow':
        if ishair: return rgb(0.72, 0.30, 0.35 if v>=0.65 else 0.18)
        if s<0.05: return rgb(0.82, 0.14, 0.62*v+0.06)
        if 0.25<=h<=0.82: h2=0.70+(h-0.68)*0.35
        else:
            hh=h if h<0.5 else h-1
            h2=0.85+(hh-0.07)*0.4
        return rgb(h2, min(0.5, 0.14+0.6*s), 0.62*v+0.06)
def apply(im, kind, hair, skin):
    out=im.copy(); p=out.load(); cache={}
    for y in range(im.height):
        for x in range(im.width):
            c=p[x,y]
            if not c[3]: continue
            k=c[:3]
            if k in skin or k==(0,0,0): continue
            if k not in cache: cache[k]=rule(k,kind,k in hair)
            n=cache[k]; p[x,y]=(n[0],n[1],n[2],c[3])
    return out
