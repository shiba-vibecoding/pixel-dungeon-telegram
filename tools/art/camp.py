import sys, math, random; sys.path.insert(0,'/home/claude/world')
from lib import *
A='/home/claude/pdt/packages/client/public/assets/'; O='/home/claude/world/camp/'
W,H=94,203
def C(h,a=255):
    h=h.lstrip('#'); return (int(h[0:2],16),int(h[2:4],16),int(h[4:6],16),a)
def T(r): return Image.open(A+f'tiles{r}.png').convert('RGBA')
def tex(r,n): return tile(T(r),n)
def fill_tex(im, t, mask, ox=0, oy=0, k=None):
    p=im.load(); tp=t.load(); w,h=t.size
    for y in range(H):
        for x in range(W):
            if mask(x,y):
                c=tp[(x+ox)%w,(y+oy)%h]
                if c[3]==0: continue
                if k: c=k(c,x,y)
                p[x,y]=c
def tint(c,m):
    return (min(255,int(c[0]*m[0])),min(255,int(c[1]*m[1])),min(255,int(c[2]*m[2])),c[3])
NIGHT=(0.58,0.62,0.82)
BAYER=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]]
def dith(x,y,t): return (BAYER[y%4][x%4]+0.5)/16 < t
def lerp(a,b,t): return tuple(int(a[i]+(b[i]-a[i])*t) for i in range(3))+(255,)

def sky(im, top='#07081a', mid='#141433', low='#2b2752', y0=0, y1=60, seed=1):
    p=im.load(); cols=[C(top),C(mid),C(low)]
    for y in range(y0,y1):
        t=(y-y0)/(y1-y0)*2
        for x in range(W):
            i=min(1,int(t)); f=t-i
            p[x,y]=cols[i+1] if dith(x,y,f) else cols[i]
    rnd=random.Random(seed)
    stars=[]
    for _ in range(46):
        x=rnd.randrange(W); y=rnd.randrange(y0,int(y0+(y1-y0)*0.8))
        b=rnd.random()
        p[x,y]=C('#e8e2c8') if b>.8 else C('#9aa4d8') if b>.4 else C('#5c628f')
        if b>.8: stars.append((x,y))
    return stars

def moon(im,cx,cy,r=5):
    p=im.load()
    for y in range(cy-r-1,cy+r+2):
        for x in range(cx-r-1,cx+r+2):
            d=math.hypot(x-cx,y-cy)
            if d<=r:
                dx=math.hypot(x-cx+2,y-cy+1)
                p[x,y]=C('#f2edd0') if dx<r-1 else C('#cfc9a6')
    for (x,y) in [(cx-1,cy-1),(cx+2,cy+1),(cx,cy+2)]: p[x,y]=C('#c7c19e')

def ridge(im, base, amp, col, seed, step=3):
    rnd=random.Random(seed); p=im.load(); hs=[]
    h=base
    for x in range(W):
        if x%step==0: h=base+rnd.randint(-amp,amp)
        hs.append(h)
    for x in range(W):
        for y in range(hs[x],H): p[x,y]=C(col)
    return hs

def rock(im, top, bottom, seed, dark='#23262c', mid='#30343b', hi='#41464f', crack='#17191d'):
    """скальная стена из неровных блоков"""
    rnd=random.Random(seed); p=im.load()
    for x in range(W):
        for y in range(top[x],bottom):
            p[x,y]=C(mid)
    # блоки
    for _ in range(170):
        bx=rnd.randrange(W); by=rnd.randrange(min(top),bottom); bw=rnd.randint(4,10); bh=rnd.randint(3,6)
        for y in range(by,by+bh):
            for x in range(bx,bx+bw):
                if 0<=x<W and top[x]<=y<bottom:
                    p[x,y]=C(hi) if y==by and x<bx+bw-1 else C(dark) if (y==by+bh-1 or x==bx+bw-1) else p[x,y]
    for _ in range(26):
        x=rnd.randrange(W); y=rnd.randrange(min(top)+2,bottom)
        for k in range(rnd.randint(2,5)):
            if 0<=x<W and top[x]<y<bottom: p[x,y]=C(crack)
            x+=rnd.choice((-1,0,1)); y+=1
    # кромка сверху
    for x in range(W):
        if top[x]<bottom: p[x,top[x]]=C(hi)
        if top[x]-1>=0: p[x,top[x]-1]=V

def arch(im, x0, x1, ybase, ytop, bricks, inner=(0,0), stairs=True, keyc='#8a8f96'):
    """каменная арка: столбы и полукруглый верх из текстуры кирпича, внутри темнота с лестницей вниз"""
    p=im.load(); bp=bricks.load(); bw,bh=bricks.size
    cx=(x0+x1)/2; R=(x1-x0)/2; ri=R-7
    def inside_outer(x,y):
        if y>=ytop+R: return x0<=x<=x1 and y<ybase
        return math.hypot(x-cx,(y-(ytop+R))*1.0)<=R+0.3 and y<ybase
    def inside_hole(x,y):
        if y>=ytop+R: return x0+7<=x<=x1-7 and y<ybase
        return math.hypot(x-cx,(y-(ytop+R)))<=ri and y<ybase
    for y in range(ytop-1,ybase):
        for x in range(x0-1,x1+2):
            if inside_outer(x,y) and not inside_hole(x,y):
                c=bp[x%bw,(y+3)%bh]; p[x,y]=c
            elif inside_hole(x,y):
                # темнота и ступени вниз
                d=(y-(ytop+R-ri))/(ybase-(ytop+R-ri))
                p[x,y]=C('#030303')
                if stairs and y>ybase-16:
                    k=ybase-y
                    if k%4==0:
                        w=int((x1-x0-14)/2*(1-k/22))
                        if abs(x-cx)<=w: p[x,y]=C('#3a3936') if k<6 else C('#2a2927') if k<10 else C('#1a1a19')
                    elif k%4==1:
                        w=int((x1-x0-14)/2*(1-k/22))
                        if abs(x-cx)<=w: p[x,y]=C('#1e1d1b') if k<10 else C('#111110')
    # обводка
    out=blank(W,H); op=out.load()
    for y in range(H):
        for x in range(W):
            o=inside_outer(x,y)
            if o and not inside_outer(x,y-1) or (o and (not inside_outer(x-1,y) or not inside_outer(x+1,y))):
                op[x,y]=V
            if inside_hole(x,y) and (not inside_hole(x,y-1) or not inside_hole(x-1,y) or not inside_hole(x+1,y)):
                op[x,y]=C('#141414')
    im.alpha_composite(out)
    # замковый камень
    for y in range(ytop-1,ytop+5):
        for x in range(int(cx)-2,int(cx)+3):
            p[x,y]=C(keyc) if y>ytop-1 else V
    for x in range(int(cx)-3,int(cx)+4):
        p[x,ytop-2]=V
    return cx

def sconce(im,x,y):
    p=im.load()
    for (dx,dy,c) in [(-1,0,'#2a2018'),(0,0,'#6b4a2a'),(1,0,'#2a2018'),(0,1,'#5a3c22'),(0,2,'#4a3018'),(-1,3,'#1c1c1c'),(0,3,'#8a8f96'),(1,3,'#1c1c1c')]:
        p[x+dx,y+dy]=C(c)

def ground(im, y0, cols, seed, path=None, pathcols=None):
    rnd=random.Random(seed); p=im.load()
    for y in range(y0,H):
        for x in range(W):
            t=(y-y0)/(H-y0)
            c=cols[0] if dith(x,y,0.5+0.5*math.sin(x*0.7+y*0.3)) else cols[1]
            if path and path(x,y): c=pathcols[0] if dith(x,y,.6) else pathcols[1]
            p[x,y]=C(c)
    for _ in range(140):
        x=rnd.randrange(W); y=rnd.randrange(y0+1,H)
        if path and path(x,y):
            if rnd.random()<.5: p[x,y]=C(pathcols[2])
        else:
            p[x,y]=C(cols[2]);
            if y-1>y0 and rnd.random()<.6: p[x,y-1]=C(cols[3])
    for x in range(W): p[x,y0]=C(cols[3])

def stones(im, pts, cs=('#5b5f66','#7a7f88','#3b3e44')):
    p=im.load()
    for (x,y,w) in pts:
        for dx in range(w):
            p[x+dx,y]=C(cs[1]) if dx<w-1 else C(cs[0])
            p[x+dx,y+1]=C(cs[0]) if dx<w-1 else C(cs[2])
        p[x-1,y+1]=V; p[x+w,y+1]=V
        for dx in range(w): p[x+dx,y-1]=V; p[x+dx,y+2]=V

def campfire(im, cx, by):
    """кольцо камней и поленья; пламя рисует рантайм (лист fire)"""
    p=im.load()
    ring=[(-6,0),(-5,-1),(-3,-2),(-1,-2),(1,-2),(3,-2),(5,-1),(6,0),(-5,1),(-3,2),(-1,2),(1,2),(3,2),(5,1)]
    for (dx,dy) in ring:
        x,y=cx+dx,by+dy
        p[x,y]=C('#7a7f88'); p[x+1,y]=C('#5b5f66'); p[x,y+1]=C('#3b3e44')
    for y in range(by-1,by+2):
        for x in range(cx-4,cx+5):
            if p[x,y][:3] not in ((122,127,136),(91,95,102),(59,62,68)): p[x,y]=C('#120c08')
    # поленья крест-накрест
    for i in range(-4,5):
        p[cx+i,by-1+ (1 if i>0 else 0)]=C('#6b4a2a'); p[cx+i,by+(1 if i>0 else 0)]=C('#3a2716')
        p[cx-i,by-1+(1 if i>0 else 0)]=C('#7a5532')
    for (dx,dy,c) in [(-1,-1,'#ff8a2a'),(1,0,'#e0401a'),(0,0,'#ffcc44'),(2,-1,'#8a1a10'),(-2,0,'#8a1a10')]:
        p[cx+dx,by+dy]=C(c)

def bedroll(im,x,y,c1='#3a5a8a',c2='#26406a',c3='#6a86b0'):
    p=im.load()
    for dx in range(14):
        for dy in range(3):
            p[x+dx,y+dy]=C(c3) if dy==0 else C(c1) if dy==1 else C(c2)
    for dy in range(-1,4): p[x-1,y+dy]=V; p[x+14,y+dy]=V
    for dx in range(-1,15): p[x+dx,y-1]=V; p[x+dx,y+3]=V
    for dy in range(3): p[x+11,y+dy]=C('#c8b48a') if dy<2 else C('#8a7a5a')

def pack(im,x,y):
    rows=['.vvvv.','vbbbbv','vbBBbv','vbbbbv','vbbbbv','.vvvv.']
    sp=from_ascii(rows,{'v':V,'b':C('#7a5532'),'B':C('#c8a060')})
    im.alpha_composite(sp,(x,y))

def grass_tufts(im, pts, c1, c2):
    p=im.load()
    for (x,y) in pts:
        for (dx,dy,c) in [(0,0,c1),(0,-1,c1),(-1,-1,c2),(1,-2,c2),(1,-1,c1),(2,0,c1),(-1,0,c1)]:
            if 0<=x+dx<W: p[x+dx,y+dy]=C(c)

def snowcap(im, maskfn, c='#dfe7f0', c2='#a8b8cc'):
    p=im.load(); src=im.copy().load()
    for x in range(W):
        for y in range(1,H-1):
            if maskfn(x,y) and not maskfn(x,y-1):
                p[x,y]=C(c); 
                if maskfn(x,y+1): p[x,y+1]=C(c2) if (x+y)%3 else C(c)

def night(im, m=NIGHT, keep=None):
    p=im.load()
    for y in range(H):
        for x in range(W):
            c=p[x,y]
            if c[3] and not (keep and keep(x,y)): p[x,y]=tint(c,m)

# ---------- пламя ----------
FIRE=[C('#fff6c8'),C('#ffe066'),C('#ffb02e'),C('#f06a1e'),C('#c0301a'),C('#6a1410')]
def fire_frames(n=6, w=13, h=17, seed=3, scale=1.0, palette=FIRE):
    rnd=random.Random(seed); frames=[]
    for f in range(n):
        im=blank(w,h); p=im.load(); cx=(w-1)/2
        ph=f/n*2*math.pi
        for y in range(h):
            t=y/(h-1)                         # 0 низ, 1 верх
            half=(w/2-0.5)*scale*(1-t**1.25)*(0.92+0.12*math.sin(ph*2+y*0.9))
            off=math.sin(ph+y*0.45)*1.4*t + math.sin(ph*3+y*1.3)*0.5*t
            for x in range(w):
                d=abs(x-cx-off)
                if d<=half:
                    r=d/max(half,0.6); core=(1-t)*(1-r)
                    k=0 if core>.55 else 1 if core>.36 else 2 if core>.2 else 3 if r<.85 or t<.5 else 4
                    if t>.78 and r>.4: k=min(5,k+1)
                    p[x,h-1-y]=palette[k]
        # отрывающиеся язычки
        for _ in range(2):
            yy=rnd.randint(int(h*.62),h-2); xx=int(cx+rnd.choice((-2,-1,1,2))+math.sin(ph+yy)*1.2)
            if 0<=xx<w: p[xx,h-1-yy]=palette[3]; 
            if 0<=xx<w and h-yy<h: p[xx,h-yy]=palette[4]
        frames.append(outline(im, (40,10,6,255)) if False else im)
    return frames
def strip(frames):
    w,h=frames[0].size; s=blank(w*len(frames),h)
    for i,f in enumerate(frames): s.alpha_composite(f,(i*w,0))
    return s

def outdoor(season):
    im=Image.new('RGBA',(W,H),V)
    stars=sky(im, y0=0, y1=58, seed=7)
    moon(im,66,31)
    ridge(im,49,2,'#191730',11,step=4)
    ridge(im,53,2,'#14132a',12,step=3)
    top=[]
    for x in range(W):
        d=abs(x-47)
        top.append(int(44+ (d/47)**1.6*12 + (1 if x%5==0 else 0) - (1 if x%7==3 else 0)))
    rock(im, top, 100, seed=21)
    bricks=tex(0,16)
    cx=arch(im,30,64,100,52,bricks)
    # плющ на арке летом
    p=im.load()
    gcols={'summer':['#2f4f2a','#36592f','#4f7a3c','#5f9047'],'autumn':['#4f3e22','#5a4626','#8a5a24','#b0782c'],'winter':['#b8c6d6','#c8d4e0','#e8eef4','#ffffff']}[season]
    pcols={'summer':['#4a3b2a','#55442f','#6a5639'],'autumn':['#4a3b2a','#55442f','#6a5639'],'winter':['#8f9db0','#a3b0c0','#7a8698']}[season]
    def path(x,y):
        t=(y-99)/40; half=10+min(1,t)*14+ (y-139)*0.2*(y>139)
        return abs(x-47-(y-99)*0.08)<=half
    ground(im,99,gcols,31,path,pcols)
    sconce(im,33,76); sconce(im,61,76)
    stones(im,[(6,112,3),(84,126,4),(12,134,3),(72,140,3),(40,150,2),(88,104,2)])
    campfire(im,24,118)
    bedroll(im,66,116, *(('#3a5a8a','#26406a','#6a86b0') if season!='autumn' else ('#7a3a2a','#5a2418','#a05a40')))
    pack(im,82,110)
    if season=='summer': grass_tufts(im,[(4,104),(14,108),(76,104),(90,112),(8,126),(86,132),(60,128),(2,140),(34,138)],'#5f9047','#3f6a35')
    if season=='autumn':
        grass_tufts(im,[(4,104),(14,108),(76,104),(90,112),(8,126),(86,132)],'#b0782c','#8a5a24')
        rnd=random.Random(5)
        for _ in range(60):
            x=rnd.randrange(W); y=rnd.randrange(99,H); im.putpixel((x,y),C(rnd.choice(['#d8682a','#b8402a','#e0a030','#a05a24'])))
    if season=='winter':
        snowcap(im, lambda x,y: y>=top[x] and y<100, '#dfe7f0','#a8b8cc')
        # снег на арке
    # ночная тонировка всего, кроме неба
    m=(0.62,0.66,0.86) if season!='winter' else (0.70,0.76,0.95)
    night(im, m, keep=lambda x,y: y<58 and y<top[x])
    return im, stars

def blob(im, cx, cy, rx, ry, c1, c2, c3, seed=0):
    rnd=random.Random(seed); p=im.load()
    for y in range(cy-ry, cy+ry+1):
        for x in range(cx-rx, cx+rx+1):
            if 0<=x<W and 0<=y<H:
                d=((x-cx)/rx)**2+((y-cy)/ry)**2 + rnd.random()*0.15
                if d<=1:
                    p[x,y]=C(c3) if d<.35 and y<cy else C(c1) if d<.8 else C(c2)
    # обводка
    out=blank(W,H); o=out.load(); src=im.load()
    for y in range(cy-ry-1, cy+ry+2):
        for x in range(cx-rx-1, cx+rx+2):
            if 0<=x<W and 0<=y<H:
                d=((x-cx)/rx)**2+((y-cy)/ry)**2
                if 1<d<=1.35 and y<cy+ry: o[x,y]=V
    im.alpha_composite(out)

def crystal(im, x, y, h, c1, c2, c3, lean=0):
    """кристалл: ромбовидный столбик высотой h, светлая грань слева"""
    p=im.load()
    for k in range(h):
        w=2 if k<h-2 else 1
        xx=x+int(lean*k/h)
        for dx in range(-w,w+1):
            X,Y=xx+dx,y-k
            if 0<=X<W and 0<=Y<H: p[X,Y]=C(c3) if dx<0 else C(c1) if dx==0 else C(c2)
    top=y-h
    if 0<=top<H: p[x+int(lean),top]=C(c3)
    for k in range(-1,h+1):
        xx=x+int(lean*max(k,0)/h)
        for dx in (-3,3):
            X,Y=xx+dx,y-k
            if 0<=X<W and 0<=Y<H and p[X,Y][3] and p[X,Y][:3] not in (C(c1)[:3],C(c2)[:3],C(c3)[:3]): pass

def cave():
    im=Image.new('RGBA',(W,H),V); p=im.load()
    top=[0]*W
    rock(im, top, 100, seed=44, dark='#1c1d27', mid='#262835', hi='#343747', crack='#101118')
    rnd=random.Random(4)
    for x in range(W):
        for y in range(0,18):
            if dith(x,y,1-y/18): p[x,y]=C('#07070b')
    for sx in range(1,W,5):
        hh=rnd.randint(4,15); x=sx+rnd.randint(-1,1)
        for k in range(hh):
            w=max(0,int(2.2*(1-k/hh)))
            for dx in range(-w,w+1):
                if 0<=x+dx<W: p[x+dx,k]=C('#3a3d50') if dx<0 else C('#262835') if dx==0 else C('#16171f')
    # проход: неровная пасть с каменной кромкой
    cxh=47
    for y in range(56,100):
        t=(y-56)/44
        half=int(4+ min(1,t*2.4)*8 + math.sin(y*0.9)*0.8)
        for x in range(cxh-half,cxh+half+1): p[x,y]=C('#030304')
        for k in (1,2):
            if cxh-half-k>=0: p[cxh-half-k,y]=C('#4a4e64') if k==1 else C('#343747')
            if cxh+half+k<W: p[cxh+half+k,y]=C('#16171f') if k==1 else C('#262835')
    for x in range(cxh-5,cxh+6): p[x,55]=C('#4a4e64')
    for k in range(18):
        y=99-k; w=int(10*(1-k/24))
        if k%4==0:
            for x in range(cxh-w,cxh+w+1): p[x,y]=C('#34364a') if k<6 else C('#22232f') if k<10 else C('#15151d')
    floor=tex(2,1)
    fill_tex(im, floor, lambda x,y: y>=99, k=lambda c,x,y: tint(c,(0.44,0.47,0.62)))
    for x in range(W): p[x,99]=C('#0e0f14'); p[x,100]=C('#16171f')
    CY=('#5ef0ff','#1f8fb8','#c8fbff'); VI=('#b88cff','#6a3ad0','#ecdcff')
    for (x,y,h,c,l) in [(7,99,22,CY,-3),(12,99,15,CY,2),(3,99,10,VI,-2),(16,99,8,VI,3),(86,99,24,VI,3),(81,99,14,CY,-2),(90,99,11,CY,2),(76,99,7,VI,-2),
                        (24,22,7,CY,0),(68,30,8,VI,0),(56,18,5,CY,0),(30,130,7,CY,-1),(34,130,4,VI,1),(72,136,8,VI,1),(88,120,5,CY,0),(10,150,6,VI,0)]:
        crystal(im,x,y,h,*c,lean=l)
    stones(im,[(6,112,3),(84,126,4),(12,134,3),(40,150,2)],('#3c404c','#565a68','#262830'))
    campfire(im,24,118)
    bedroll(im,66,116,'#4a3a6a','#2e2448','#6a5a90'); pack(im,82,110)
    return im

def prison():
    im=Image.new('RGBA',(W,H),V); p=im.load()
    sky(im, y0=0, y1=40, seed=9); moon(im,16,10,4)
    wall=tex(1,16)
    top=[34 if (x//6)%2==0 else 30 for x in range(W)]
    fill_tex(im, wall, lambda x,y: top[x]<=y<100, k=lambda c,x,y: tint(c,(0.46,0.47,0.64)))
    for x in range(W):
        p[x,top[x]-1]=V
        if x>0 and top[x]!=top[x-1]:
            for y in range(min(top[x],top[x-1])-1,max(top[x],top[x-1])): p[x,y]=V
    # окна с решётками
    for wx in (8,76):
        for y in range(54,68):
            for x in range(wx,wx+10):
                edge = x in (wx,wx+9) or y in (54,67)
                p[x,y]=V if edge else C('#2a2010') if (x-wx)%3==0 else C('#6a4a1a') if y>60 else C('#4a3214')
    # ворота: арка из тёмного кирпича с поднятой решёткой
    cx=arch(im,30,64,100,50,tint_img(tex(1,16),(0.5,0.5,0.62)),keyc='#8a7a5a')
    for y in range(64,72):
        for x in range(38,57):
            if (x-38)%3==0 and p[x,y][:3]==(3,3,3): p[x,y]=C('#4a4a50')
    for x in range(38,57):
        if p[x,71][:3]==(3,3,3) or p[x,71][:3]==(74,74,80): p[x,72]=C('#5a5a62')
    sconce(im,26,74); sconce(im,68,74)
    # цепи
    for y in range(40,52): p[20,y]=C('#5a5a62') if y%2 else C('#3a3a40')
    floor=tex(1,1)
    fill_tex(im, floor, lambda x,y: y>=99, k=lambda c,x,y: tint(c,(0.48,0.5,0.66)))
    rnd=random.Random(8)
    for _ in range(26):
        x=rnd.randrange(W); y=rnd.randrange(102,H); p[x,y]=C('#3f6a35'); 
        if y>0: p[x,y-1]=C('#2f4f2a')
    for x in range(W): p[x,99]=C('#141414')
    stones(im,[(84,126,4),(12,134,3)],('#4a4a50','#64646c','#2c2c30'))
    campfire(im,24,118)
    bedroll(im,66,116,'#6a5a3a','#4a3e26','#8a7a52'); pack(im,82,110)
    # бочка
    for y in range(104,113):
        for x in range(4,11): p[x,y]=C('#7a5532') if x<8 else C('#5a3c22')
        p[3,y]=V; p[11,y]=V
    for x in range(3,12): p[x,103]=V; p[x,113]=V; p[x,106]=C('#3a3a40'); p[x,110]=C('#3a3a40')
    return im

def tint_img(t,m):
    t=t.copy(); q=t.load()
    for y in range(t.height):
        for x in range(t.width): q[x,y]=tint(q[x,y],m)
    return t

def hall():
    im=Image.new('RGBA',(W,H),V); p=im.load()
    wall=tex(3,16)
    fill_tex(im, wall, lambda x,y: 12<=y<100, k=lambda c,x,y: tint(c,(0.5,0.5,0.62)))
    for x in range(W):
        for y in range(0,14):
            p[x,y]=C('#0d0c0a') if dith(x,y,1-(y/14)) else p[x,y] if y>=12 else C('#16130f')
    # балка
    for x in range(W):
        for y in (12,13,14): p[x,y]=C('#4a3018') if y==12 else C('#3a2410') if y==13 else V
    # колонны
    for (x0,x1) in ((4,14),(80,90)):
        for y in range(15,100):
            for x in range(x0,x1+1):
                p[x,y]=V if x in (x0,x1) else C('#a89c84') if x<x0+3 else C('#8a7f6a') if x<x1-2 else C('#6a614f')
        for y in (15,16,17,96,97,98):
            for x in range(x0-2,x1+3): p[x,y]=V if y in (15,98) or x in (x0-2,x1+2) else C('#c8b890') if y in (16,97) else C('#8a7f6a')
    # знамёна
    for bx in (20,66):
        for y in range(22,56):
            for x in range(bx,bx+9):
                edge = x in (bx,bx+8)
                tip = y>50 and abs(x-(bx+4))<(y-50)
                if tip: continue
                p[x,y]=V if edge else C('#a02828') if x<bx+5 else C('#7a1c1c')
        for x in range(bx-1,bx+10): p[x,21]=C('#c8a050'); p[x,20]=V
        for (dx,dy) in [(4,30),(3,31),(5,31),(4,32),(2,33),(6,33),(4,34),(4,35)]: p[bx+dx,dy]=C('#ffcc66')
    # большой проём с лестницей
    for y in range(58,100):
        for x in range(34,61):
            p[x,y]=V if x in (34,60) or y==58 else C('#030303')
    for y in range(52,58):
        for x in range(31,64): p[x,y]=V if y in (52,57) or x in (31,63) else C('#c8b890') if y==53 else C('#9a8a68')
    for (dx) in range(44,51): p[dx,54]=C('#ffcc66')
    for k in range(16):
        y=99-k; w=int(12*(1-k/24))
        if k%3==0:
            for x in range(47-w,47+w+1): p[x,y]=C('#4a4434') if k<6 else C('#2e2a20') if k<10 else C('#1a1712')
    # светильники
    for lx in (26,68):
        for (dx,dy,c) in [(0,0,'#ffcc66'),(-1,1,'#c8a050'),(1,1,'#c8a050'),(0,1,'#fff3a0'),(0,2,'#8a6a2a'),(0,-1,'#3a2a14'),(0,-2,'#3a2a14')]: p[lx+dx,66+dy]=C(c)
    floor=tex(3,1)
    fill_tex(im, floor, lambda x,y: y>=99, k=lambda c,x,y: tint(c,(0.56,0.58,0.72)))
    for y in range(100,H):
        for x in range(W):
            if abs(x-47-(y-100)*0.05) <= 8+(y-100)*0.12: p[x,y]=C('#7a2020') if dith(x,y,.7) else C('#5a1818')
    for x in range(W): p[x,99]=C('#141414')
    campfire(im,24,118)
    bedroll(im,66,116,'#3a5a8a','#26406a','#6a86b0'); pack(im,82,110)
    return im
