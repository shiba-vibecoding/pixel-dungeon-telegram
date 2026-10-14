import sys, math; sys.path.insert(0,'.')
from lib import *
A='./shattered/'; O='./out/'
V=(11,11,9,255)
def C(h,a=255): h=h.lstrip('#'); return (int(h[0:2],16),int(h[2:4],16),int(h[4:6],16),a)
# ---------- снаряды: 2 кадра 8×8 на ряд ----------
def orb(main,light,dark,eyes=True,f=0):
    rows=[
"..####..",
".#mmmm#.",
"#mlwlmm#",
"#mEmmEd#",
"#mmmmdd#",
"#mmmddd#",
".#dddd#.",
"..####.."] if f==0 else [
"...##...",
"..#mm#..",
".#lwlm#.",
"#mEmmEd#",
"#mmmmmd#",
".#mmdd#.",
"..#dd#..",
"...##..."]
    if not eyes: rows=[r.replace('E','m') for r in rows]
    return from_ascii(rows,{'#':V,'m':C(main),'l':C(light),'w':C('#ffffff'),'d':C(dark),'E':C('#1a0a10')})
def shadow(f):
    rows=["..####..",".#pppp#.","#pkkkpp#","#pkvkkp#","#pkkkkp#","#ppkkpp#",".#pppp#.","..####.."] if f==0 else ["........","..####..",".#pkkp#.",".#kvkk#.",".#kkkp#.","..#pp#..","...##...","........"]
    return from_ascii(rows,{'#':C('#0b0610'),'p':C('#7a2a8a'),'k':C('#1a0a20'),'v':C('#d070ff')})
RB=['#ff4040','#ffa030','#ffee40','#50e050','#40b0ff','#a060ff']
def chaos(f):
    im=blank(8,8); p=im.load()
    for y in range(8):
        for x in range(8):
            d=math.hypot(x-3.5,y-3.5)
            if d<3.6: p[x,y]=C(RB[int((math.atan2(y-3.5,x-3.5)/math.pi*3+3+f*1.5))%6])
            if d<1.6: p[x,y]=C('#ffffff')
    return outline(im,V)
R=[('shamanR',[orb('#e04040','#ff9a8a','#801a1a',f=0),orb('#e04040','#ff9a8a','#801a1a',f=1)]),
   ('shamanB',[orb('#4a80f0','#a8c8ff','#1a3c80',f=0),orb('#4a80f0','#a8c8ff','#1a3c80',f=1)]),
   ('shamanP',[orb('#b040f0','#e0a0ff','#5e1a80',f=0),orb('#b040f0','#e0a0ff','#5e1a80',f=1)]),
   ('warlock',[shadow(0),shadow(1)]),('chaos',[chaos(0),chaos(1)])]
sh=blank(16,8*len(R))
for i,(k,fr) in enumerate(R):
    for j,f in enumerate(fr): sh.alpha_composite(f,(j*8,i*8))
sh.save(O+'mob-bolts.png')
# ---------- текстуры лучей из effects.png Shattered ----------
E=Image.open(A+'effects/effects.png').convert('RGBA')
beams=blank(16,24)
beams.alpha_composite(E.crop((16,0,32,8)),(0,0))     # молния
beams.alpha_composite(E.crop((16,16,32,24)),(0,8))   # смертельный взгляд
beams.alpha_composite(E.crop((16,23,32,31)),(0,16))  # световой луч
beams.save(O+'mob-beams.png')
# ---------- состояния: уязвимость, порча, деградация, слабость + 6 чемпионов ----------
small=Image.open(A+'interfaces/buffs.png').convert('RGBA'); large=Image.open(A+'interfaces/large_buffs.png').convert('RGBA')
def cell(im,i,sz): cols=im.width//sz; return im.crop(((i%cols)*sz,(i//cols)*sz,(i%cols)*sz+sz,(i//cols)*sz+sz))
def hard(im,col):
    out=im.copy(); p=out.load(); c0=C(col)
    for y in range(out.height):
        for x in range(out.width):
            c=p[x,y]
            if c[3]: p[x,y]=tuple(min(255,c[i]*c0[i]//255) for i in range(3))+(c[3],)
    return out
CH=[('blazing','#ff8800'),('projecting','#8800ff'),('antimagic','#00ff00'),('giant','#0088ff'),('blessed','#ffff00'),('growing','#ff2222')]
S=[('vulnerable',46,None),('hex',47,None),('degrade',48,None),('weakness',14,None)]+[('champ-'+k,36,c) for k,c in CH]
ss=blank(7*len(S),7); ls=blank(16*len(S),16)
for i,(k,ix,col) in enumerate(S):
    a=cell(small,ix,7); b=cell(large,ix,16)
    if col: a=hard(a,col); b=hard(b,col)
    ss.alpha_composite(a,(7*i,0)); ls.alpha_composite(b,(16*i,0))
ss.save(O+'mob-buffs.png'); ls.save(O+'mob-buffs-l.png')
# ---------- гуль: стоит, падает, лежит, мёртв ----------
G=Image.open(A+'sprites/ghoul.png').convert('RGBA')
gf=blank(12*5,14)
for j,i in enumerate([0,10,11,12,13]): gf.alpha_composite(G.crop((i*12,0,i*12+12,14)),(j*12,0))
gf.save(O+'ghoul-fall.png')
# ---------- эбеновый мимик: контур (тусклый, вспышка), сундук ----------
M=Image.open(A+'sprites/mimic.png').convert('RGBA'); ch=M.crop((0,48,16,64)); idle=M.crop((3*16,48,4*16,64))
def contour(im,col,inner=None):
    out=blank(16,16); p=out.load(); q=im.load()
    for y in range(16):
        for x in range(16):
            if not q[x,y][3]: continue
            edge=any(not (0<=x+dx<16 and 0<=y+dy<16 and q[x+dx,y+dy][3]) for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)))
            if edge: p[x,y]=col
            elif inner and q[x,y][:3]==(255,255,255)[:3]: p[x,y]=inner
    return out
def ghost(im,a,edge,ea):
    out=blank(16,16); p=out.load(); q=im.load(); c2=contour(im,(0,0,0,255)).load()
    for y in range(16):
        for x in range(16):
            c=q[x,y]
            if not c[3]: continue
            if c2[x,y][3]: p[x,y]=C(edge,ea)
            else: l=(c[0]+c[1]+c[2])//3; p[x,y]=(l,l,min(255,l+12),int(a*255))
    return out
eb=blank(16*4,16)
eb.alpha_composite(ghost(ch,.16,'#8a9aa8',120),(0,0))
eb.alpha_composite(ghost(ch,.34,'#d8e8f0',220),(16,0))
eb.alpha_composite(ch,(32,0)); eb.alpha_composite(idle,(48,0))
eb.save(O+'ebony-hidden.png')
# превью
items=[('mob-bolts.png',8),('mob-beams.png',8),('mob-buffs.png',8),('mob-buffs-l.png',4),('ghoul-fall.png',6),('ebony-hidden.png',6)]
W=max(Image.open(O+f).width*k for f,k in items); Hh=sum(Image.open(O+f).height*k+10 for f,k in items)
o=Image.new('RGBA',(W,Hh),(40,42,36,255)); y=0
for f,k in items:
    im=Image.open(O+f); o.alpha_composite(im.resize((im.width*k,im.height*k),0),(0,y)); y+=im.height*k+10
o.save('./out/fx21.png'); print('ok')
