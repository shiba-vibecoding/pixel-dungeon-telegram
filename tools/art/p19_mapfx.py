import sys, math, colorsys; sys.path.insert(0,'/home/claude/world')
from lib import *
A='/home/claude/pdt/packages/client/public/assets/'; O='/home/claude/world/mapfx/'
def C(h,a=255): h=h.lstrip('#'); return (int(h[0:2],16),int(h[2:4],16),int(h[4:6],16),a)
# ---- призматическое отражение: силуэт героя, залитый радужными полосами; 4 фазы цвета ----
war=Image.open(A+'warrior.png').convert('RGBA').crop((0,15,252,30))
rows=[]
for ph in range(4):
    im=blank(252,15); p=im.load(); src=war.load()
    for y in range(15):
        for x in range(252):
            c=src[x,y]
            if not c[3]: continue
            fx=x%12
            h=((fx+y)*0.045 + ph*0.25)%1
            lum=sum(c[:3])/765
            if c[:3]==(0,0,0): p[x,y]=(255,255,255,255); continue
            if lum<0.16: p[x,y]=(44,30,86,240); continue
            r,g,b=colorsys.hsv_to_rgb(h, 0.42, min(1,0.40+lum*0.72))
            p[x,y]=(int(r*255),int(g*255),int(b*255),225)
    rows.append(im)
pr=blank(252,60)
for i,r in enumerate(rows): pr.alpha_composite(r,(0,15*i))
pr.save(O+'prismatic.png')
# ---- метка союзника: сердечко 9×8, 2 кадра ----
H1=['.vv.vv.','vhAvAAv','vAAAAAv','vAAAAAv','.vAAAv.','..vAv..','...v...']
H2=['.vv.vv.','vhBvBBv','vBBBBBv','.vBBBv.','..vBv..','...v...','.......']
pal={'v':V,'h':C('#e8fff8'),'A':C('#5ec8c0'),'B':C('#3a9a92')}
hs=blank(14,7); hs.alpha_composite(from_ascii(H1,pal),(0,0)); hs.alpha_composite(from_ascii(H2,pal),(7,0)); hs.save(O+'ally-heart.png')
# ---- звено эфирной цепи 6×4 (2 кадра: свет и тень) и наконечник 7×7 ----
L1=['.vvvv.','vcCCcv','vcvvcv','.vvvv.']; L2=['.vvvv.','vCccCv','vCvvCv','.vvvv.']
cp={'v':C('#1a3a5a'),'c':C('#7ad8ff'),'C':C('#c8f4ff')}
ch=blank(12,4); ch.alpha_composite(from_ascii(L1,cp),(0,0)); ch.alpha_composite(from_ascii(L2,cp),(6,0)); ch.save(O+'chain-link.png')
hook=from_ascii(['..vvv..','.vcCcv.','vcv.vcv','vC...Cv','vc...cv','.v...v.','.......'],cp); hook.save(O+'chain-hook.png')
# ---- снаряды палочек: 8×8, по 2 кадра; ряд на палочку ----
def orb(core, mid, rim, f, shape='orb'):
    im=blank(8,8); p=im.load()
    for y in range(8):
        for x in range(8):
            d=math.hypot(x-3.5,y-3.5)
            if shape=='orb':
                r=2.6 if f==0 else 3.0
                if d<1.1: p[x,y]=C(core)
                elif d<r-0.6: p[x,y]=C(mid)
                elif d<r+0.4: p[x,y]=C(rim,200)
            elif shape=='shard':
                if abs(x-y)<=1 and 1<=x<=6: p[x,y]=C(core) if abs(x-y)==0 else C(mid)
                if (x,y) in ((6,6),(7,7)) and f: p[x,y]=C(rim)
                if (x,y) in ((1,6),(6,1)) and not f: p[x,y]=C(rim)
            elif shape=='flame':
                t=(7-y)/7; half=(2.8 if f else 2.4)*(1-t**1.3)
                if abs(x-3.5-math.sin(y+f)*0.6)<=half: p[x,y]=C(core) if half-abs(x-3.5)>1.4 else C(mid) if half-abs(x-3.5)>0.6 else C(rim)
            elif shape=='leaf':
                if abs((x-3.5)*0.9)+abs((y-3.5)*1.6)<3.3: p[x,y]=C(mid) if x+y<8 else C(rim)
                if x==y and 1<x<6: p[x,y]=C(core)
            elif shape=='drop':
                dd=math.hypot(x-3.5,(y-4.5)*1.1)
                if dd<2.4 or (y<4 and abs(x-3.5)<(y-0.5)*0.75): p[x,y]=C(mid)
                if dd<1 or (x,y)==(2,4): p[x,y]=C(core)
            elif shape=='rock':
                if 1<=x<=6 and 2<=y<=6 and not (x in (1,6) and y in (2,6)): p[x,y]=C(mid) if (x+y+f)%3 else C(rim)
                if (x,y) in ((2,3),(3,3)): p[x,y]=C(core)
            elif shape=='rune':
                if d<3.4 and d>2.3: p[x,y]=C(mid)
                if (x in (3,4) and 2<=y<=5) or (y in (3,4) and 2<=x<=5 and f): p[x,y]=C(core)
            elif shape=='wisp':
                if d<(2.8 if f else 2.2): p[x,y]=C(mid) if d>1 else C(core)
                if y<2 and x==(3 if f else 4): p[x,y]=C(rim)
            elif shape=='ring':
                if abs(d-(2.2 if f==0 else 3.1))<0.6: p[x,y]=C(core if f==0 else mid)
    return outline(im,(10,8,14,200)) if shape not in ('ring',) else im
W=[('magicMissile','#ffffff','#d8c8ff','#8a6aff','orb'),('fireblast','#fff3a0','#ff9a2e','#c0301a','flame'),('frost','#ffffff','#9ae8ff','#3a8ad8','shard'),
   ('lightning','#ffffff','#fff6a0','#7ac8ff','orb'),('corrosion','#e8ffb0','#8ad83a','#3a7a1a','orb'),('blastWave','#ffffff','#e8e2c8','#9fa896','ring'),
   ('livingEarth','#c8a878','#8a6a3a','#5a3c22','rock'),('warding','#ffffff','#b8a0ff','#6a4ad0','rune'),('regrowth','#e0ffd0','#5ac83a','#2f7a2a','leaf'),
   ('transfusion','#ffd8d8','#e0303a','#8a1020','drop'),('corruption','#e0c8ff','#5a2a8a','#2a1040','wisp'),('prismatic','#ffffff','#ffe0f0','#a0e8ff','orb')]
s=blank(16,8*len(W))
for i,w in enumerate(W):
    for f in range(2): s.alpha_composite(orb(w[1],w[2],w[3],f,w[4]),(f*8,i*8))
s.save(O+'wand-bolts.png')
import json; json.dump([w[0] for w in W],open(O+'wand-bolts.json','w'))
# ---- светящийся призрак-спутник: тонировка ghost.png ----
g=Image.open(A+'ghost.png').convert('RGBA'); print('ghost', g.size)
# ---- опасность: череп 9×9 с бордовым фоном ----
dz=from_ascii(['..vvvvv..','.vwwwwwv.','vwwwwwwwv','vwvvwvvwv','vwvvwvvwv','vwwwvwwwv','.vwwwwwv.','..vwvwv..','...vvv...'],{'v':V,'w':C('#f2edd0')})
dz.save(O+'danger-skull.png')
# ---- кража: рука с монетой 16×16 ----
steal=from_ascii(['................','..........vvv...','.........vgggv..','.........vgGgv..','..vv.....vgggv..','.vssv.....vvv...','.vssvvv.........','.vsssssvv.......','vssssssssv......','vsssssSssv......','vssssssssv......','.vssssssv.......','..vvssssv.......','....vssv........','.....vv.........','................'],{'v':V,'s':C('#dcb497'),'S':C('#b89778'),'g':C('#ffcc66'),'G':C('#c8902e')})
steal.save(O+'icon-steal.png')
# ---- силуэт пустой ячейки «разное»: кольцо и амулет 16×16 ----
misc=from_ascii(['................','.....ssss.......','....s....s......','...s......s.....','...s......s.....','...s......s.....','....s....s......','.....ssss.......','.......s........','......sss.......','.....sssss......','....sssssss.....','.....sssss......','......sss.......','.......s........','................'],{'s':C('#7a8173')})
misc.save(O+'slot-misc.png')
print('ok')
