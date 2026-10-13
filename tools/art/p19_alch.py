import sys, math, random; sys.path.insert(0,'/home/claude/world')
from lib import *
O='/home/claude/world/alch/'
def C(h,a=255): h=h.lstrip('#'); return (int(h[0:2],16),int(h[2:4],16),int(h[4:6],16),a)
IRON=[C('#1c1d22'),C('#2e3038'),C('#454852'),C('#626672'),C('#8a8f9c')]
LIQ={'green':[C('#1f5a2a'),C('#2f8a3a'),C('#4cc24c'),C('#9cf08a'),C('#e0ffd0')],
     'violet':[C('#3a1f6a'),C('#5a3ab0'),C('#8c6aff'),C('#c8b0ff'),C('#f0e8ff')],
     'cyan':[C('#0f4a5a'),C('#1f8fb8'),C('#5ef0ff'),C('#b8fbff'),C('#ffffff')]}
def pot(liq='green', phase=0, glow=0.0, level=0):
    im=blank(32,32); p=im.load()
    cx=15.5
    # тело котла: эллипс 26×18 с низом
    for y in range(12,29):
        for x in range(3,29):
            dx=(x-cx)/12.5; dy=(y-17)/11.5
            if dx*dx+dy*dy<=1 and y>=13:
                k=2 if x<cx-4 else 1 if x<cx+6 else 0
                if dx*dx+dy*dy>0.82: k=max(0,k-1)
                if x<cx-8 and 16<y<24: k=3
                p[x,y]=IRON[k]
    # ножки
    for (x,y) in [(7,28),(8,29),(23,28),(24,29),(15,29),(16,29)]: p[x,y]=IRON[0]
    # обод
    for x in range(4,28):
        p[x,12]=IRON[3] if x<12 else IRON[2]; p[x,13]=IRON[1]
    p[3,12]=IRON[1]; p[28,12]=IRON[0]
    # жидкость сверху: эллипс внутри обода
    L=LIQ[liq]
    for y in range(9,13):
        for x in range(6,26):
            dx=(x-cx)/10; dy=(y-11.2)/2.2
            if dx*dx+dy*dy<=1:
                wave=math.sin(x*0.8+phase*1.6)
                k=2 if wave>0.3 else 1
                if glow>0.3 and wave>0.6: k=3
                p[x,y]=L[k]
    # пузыри
    rnd=random.Random(phase*7+3)
    for i in range(2+int(glow*3)):
        bx=8+((phase*5+i*7)%16); by=10-((phase+i*2)%4)
        if 0<=by<32: p[bx,by]=L[3]; 
        if glow>0.5 and by-1>=0: p[bx,by-1]=L[4]
    # ручки
    for (x,y) in [(2,15),(2,16),(1,16),(29,15),(29,16),(30,16)]: p[x,y]=IRON[2]
    return outline(im)

def steam(im, phase, col=(200,210,220,150)):
    p=im.load()
    for i in range(3):
        t=(phase*0.25+i/3)%1
        x=int(10+i*6+math.sin((phase+i)*1.3)*2); y=int(9-t*9)
        for dx,dy in [(0,0),(1,0),(0,-1)]:
            X,Y=x+dx,y+dy
            if 0<=X<32 and 0<=Y<32 and p[X,Y][3]==0: p[X,Y]=(col[0],col[1],col[2],int(col[3]*(1-t)))
    return im

def poof(phase, liq='green'):
    """вспышка готового зелья: кольцо искр и клуб пара над котлом"""
    im=pot(liq,phase,1.0); p=im.load(); L=LIQ[liq]
    r=2+phase*2.2
    for a in range(0,360,30):
        x=int(15.5+math.cos(math.radians(a))*r); y=int(8+math.sin(math.radians(a))*r*0.7)
        if 0<=x<32 and 0<=y<32: p[x,y]=L[4] if phase<3 else L[3]
    cl=blank(32,32); q=cl.load(); rr=2+phase*1.2
    for (cx2,cy2,k) in [(12,7,1.0),(19,6,0.9),(15.5,4,1.1)]:
        for y in range(0,12):
            for x in range(4,28):
                d=math.hypot(x-cx2,(y-cy2)*1.25)
                if d<rr*k: q[x,y]=(236,242,240,255) if y<cy2 else (196,206,206,255)
    a=int(255*(1-phase/5))
    for y in range(32):
        for x in range(32):
            c=q[x,y]
            if c[3] and p[x,y][3]==0: p[x,y]=(c[0],c[1],c[2],a)
    return im

def sheet(frames): 
    s=blank(32*len(frames),32)
    for i,f in enumerate(frames): s.alpha_composite(f,(i*32,0))
    return s

idle=[steam(pot('green',f,0.0),f) for f in range(6)]
brew=[steam(pot('green',f,min(1,f/4)),f,(190,240,190,170)) for f in range(6)]+[poof(f) for f in range(4)]
cata=[steam(pot('violet',f,min(1,f/4)),f,(210,190,255,170)) for f in range(6)]+[poof(f,'violet') for f in range(4)]
sheet(idle).save(O+'pot-idle.png'); sheet(brew).save(O+'pot-brew.png'); sheet(cata).save(O+'pot-catalyst.png')

# катализатор 16×16: латунная оправа, лиловое ядро; 6 кадров пульса
def catalyst(f):
    im=blank(16,16); p=im.load()
    br=[C('#5a3c18'),C('#8a6028'),C('#c8a050'),C('#ffe0a0')]
    core=[C('#3a1f6a'),C('#6a3ad0'),C('#a07cff'),C('#e0d0ff'),C('#ffffff')]
    puls=0.5+0.5*math.sin(f/6*2*math.pi)
    for y in range(16):
        for x in range(16):
            d=math.hypot(x-7.5,y-8)
            if d<=4.2:
                k=4 if d<1.2+puls else 3 if d<2.2+puls*0.6 else 2 if d<3.4 else 1
                p[x,y]=core[k]
            elif d<=5.6:
                a=math.atan2(y-8,x-7.5)
                p[x,y]=br[3] if -2.6<a<-1.6 else br[2] if a<0 else br[1]
    for (x,y) in [(7,1),(8,1),(7,2),(8,2),(6,2),(9,2)]: p[x,y]=br[2] if y==2 else br[3]
    for (x,y) in [(7,14),(8,14),(6,13),(9,13)]: p[x,y]=br[1]
    # искорка
    sx=[(12,3),(3,4),(13,11),(2,12),(11,1),(4,14)][f]
    p[sx]=core[4]
    return outline(im)
cf=[catalyst(f) for f in range(6)]
s=blank(96,16)
for i,f in enumerate(cf): s.alpha_composite(f,(i*16,0))
s.save(O+'catalyst.png')

# осколок энергии 7×7, 4 кадра вращения, и вспышка
def shard(f):
    rows=[['...w...','..wcw..','.wcCcw.','wcCCCcw','.wcCcw.','..wcw..','...w...'],
          ['.......','...w...','..wcw..','.wcCcw.','..wcw..','...w...','.......'],
          ['...w...','...c...','..cCc..','.cCCCc.','..cCc..','...c...','...w...'],
          ['.......','..www..','.wcccw.','.wcCcw.','.wcccw.','..www..','.......']][f]
    return from_ascii(rows,{'w':C('#e8ffff'),'c':C('#5ef0ff'),'C':C('#1f8fb8')})
s=blank(28,7)
for i in range(4): s.alpha_composite(shard(i),(i*7,0))
s.save(O+'energy-shard.png')

# кучка кристаллов энергии на полу 16×16, 4 кадра блика
def pile(f):
    im=blank(16,16); p=im.load()
    CY=[C('#0f4a5a'),C('#1f8fb8'),C('#5ef0ff'),C('#c8fbff')]
    shapes=[(5,13,5),(9,13,7),(12,14,4),(7,14,3),(3,14,3)]
    for (x,y,h) in shapes:
        for k in range(h):
            w=1 if k<h-1 else 0
            for dx in range(-w,w+1):
                X,Y=x+dx,y-k
                p[X,Y]=CY[2] if dx<0 else CY[1] if dx==0 else CY[0]
        p[x,y-h]=CY[3] if (f+x)%4==0 else CY[2]
    for x in range(2,15): 
        if p[x,15][3]==0: p[x,15]=(0,0,0,90)
    tw=[(9,6),(5,8),(12,10),(7,11)][f]
    p[tw]=C('#ffffff')
    return outline(im)
s=blank(64,16)
for i in range(4): s.alpha_composite(pile(i),(i*16,0))
s.save(O+'energy-pile.png')

# страница, которой ещё нет: рваный пергамент 32×32 с замком
def lostpage():
    im=blank(32,32); p=im.load()
    pa=[C('#6a5f45'),C('#a89c78'),C('#d8cfa8'),C('#f2edd0')]
    rnd=random.Random(3)
    for y in range(3,30):
        for x in range(6,26):
            edge=(x==6 or x==25 or y==3 or y==29)
            torn = (y>20 and x>14 and (x-14)+(y-20)*1.3>rnd.randint(9,12))
            if torn: continue
            p[x,y]=pa[1] if edge else pa[2] if (x+y)%7 else pa[1]
    for y in range(8,20,3):
        for x in range(9,23):
            if (x*3+y)%5: p[x,y]=pa[0] if x<20 else pa[1]
    # замок
    lock=['..vvv..','.v...v.','.v...v.','vvvvvvv','vgggggv','vggvggv','vggvggv','vgggggv','vvvvvvv']
    L=from_ascii(lock,{'v':V,'g':C('#ffcc66')}); im.alpha_composite(L,(18,19))
    return outline(im)
lostpage().save(O+'page-lost.png')
print('ok')
