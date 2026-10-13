import sys, math, random; sys.path.insert(0,'/home/claude/world')
import camp
from camp import *
from PIL import ImageOps
SPR='/home/claude/ds/work/spr/'
HEROES=Image.open(SPR+'camp-heroes.png').convert('RGBA'); FIREF=Image.open(SPR+'fire.png').convert('RGBA')
def light(im, cx, cy, r, col, k=1.0):
    p=im.load(); c=hexrgb(col)
    for y in range(max(0,cy-r),min(im.height,cy+r+1)):
        for x in range(max(0,cx-r),min(im.width,cx+r+1)):
            d=math.sqrt((x-cx)**2+((y-cy)**2)*1.25)/r; th=(BAYER[y%4][x%4]+.5)/16
            a=.26 if d<.34 else (.26 if th<.5 else .15) if d<.40 else .15 if d<.62 else (.15 if th<.5 else .07) if d<.70 else .07 if d<.94 else (.07 if th<.4 else 0) if d<1 else 0
            if a:
                q=p[x,y]; a*=k; p[x,y]=(min(255,int(q[0]+c[0]*a)),min(255,int(q[1]+c[1]*a)),min(255,int(q[2]+c[2]*a)),q[3])
def hexrgb(h): h=h.lstrip('#'); return (int(h[0:2],16),int(h[2:4],16),int(h[4:6],16))
def scene(w, h, seed=7, heroes=(0,1,2,3,4,5), skins=None, fire_frame=2, cxf=0.5):
    camp.W, camp.H = w, h
    im=Image.new('RGBA',(w,h),V)
    gy=int(h*0.64)
    sky(im, y0=0, y1=gy, seed=seed)
    moon(im, int(w*(0.94 if cxf>0.6 else 0.80)), max(8,int(h*0.16)), 5 if h>60 else 4)
    ridge(im, int(gy-h*0.30), 2, '#191730', 11, step=4)
    ridge(im, int(gy-h*0.24), 2, '#14132a', 12, step=3)
    cx=int(w*cxf)
    top=[int(gy-h*0.42 + (abs(x-cx)/(w/2))**1.6*h*0.16) for x in range(w)]
    rock(im, top, gy+1, seed=21)
    ah=min(48, int(h*0.52)); R=min(17, int(ah*0.5)); ty=gy-int(ah*0.5); tx0=R-3
    arch(im, cx-R, cx+R, gy+1, gy+1-ah, tex(0,16))
    sconce(im, cx-tx0, ty); sconce(im, cx+tx0, ty)
    ground(im, gy, ['#2f4f2a','#36592f','#4f7a3c','#5f9047'], 31)
    grass_tufts(im, [(int(w*f), gy+int(h*g)) for f,g in [(.05,.08),(.18,.14),(.92,.1),(.78,.2),(.3,.3),(.66,.32),(.1,.3),(.88,.3)] if gy+int(h*g)<h], '#5f9047','#3f6a35')
    fy=min(h-6, gy+int(h*0.22))
    campfire(im, cx, fy)
    night(im, (0.62,0.66,0.86), keep=lambda x,y: y<gy and y<top[x])
    # огонь факелов и костра
    tf=Image.open(SPR+'torch.png').convert('RGBA')
    for tx in (cx-tx0,cx+tx0): im.alpha_composite(tf.crop((5,0,10,7)),(tx-2,ty-7))
    im.alpha_composite(FIREF.crop((fire_frame*13,0,fire_frame*13+13,17)),(cx-6,fy-17))
    # герои вокруг костра: левые смотрят вправо, правые — влево
    pos=[(-12,-3),(-23,0),(-34,-5),(12,-3),(23,0),(34,-5)]
    for i,hc in enumerate(heroes):
        dx,dy=pos[i]; row=hc if not skins else skins[i]
        fr=HEROES.crop((0,row*15,12,15*row+15))
        if dx>0: fr=ImageOps.mirror(fr)
        x=cx+dx-6; y=fy+dy-14
        p=im.load()
        for k in range(2,10): 
            if 0<=x+k<w and 0<=y+14<h: q=p[x+k,y+14]; p[x+k,y+14]=(q[0]//2,q[1]//2,q[2]//2,255)
        im.alpha_composite(fr,(x,y))
    light(im, cx, fy-6, min(34, int(h*0.62)), '#ff9a3a')
    for tx in (cx-tx0,cx+tx0): light(im, tx, ty-3, 9, '#ffb050')
    return im
if __name__=='__main__':
    O='/home/claude/world/v20/'
    scene(104,56).save(O+'banner-whatsnew.png')
    scene(160,80,seed=3,cxf=0.73).save(O+'github-social.png')
    scene(150,50,seed=5,cxf=0.74).save(O+'github-header.png')
    for n,s in [('banner-whatsnew',3),('github-social',8),('github-header',8)]:
        im=Image.open(O+n+'.png'); im.resize((im.width*s,im.height*s),Image.NEAREST).save(O+n+'@x.png')
    print('ok')
