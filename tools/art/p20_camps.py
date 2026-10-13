import sys, math, random; sys.path.insert(0,'/home/claude/world')
import camp
from camp import *
from banner import light, SPR
O='./out/'
CW,CH=66,48
TORCH=Image.open(SPR+'torch.png').convert('RGBA')
SMALLFIRE=fire_frames(6,9,12,seed=5)
def setsize(): camp.W,camp.H=CW,CH
def fire(im,cx,by,f=2):
    campfire(im,cx,by); im.alpha_composite(SMALLFIRE[f],(cx-4,by-12))
def torches(im,xs,y):
    for i,x in enumerate(xs):
        sconce(im,x,y); im.alpha_composite(TORCH.crop((5*((i*2+1)%4),0,5*((i*2+1)%4)+5,7)),(x-2,y-7))
def roll(im,x,y,c):
    p=im.load()
    for dx in range(9):
        for dy in range(2): p[x+dx,y+dy]=C(c[2]) if dy==0 else C(c[0])
    for dy in range(-1,3): p[x-1,y+dy]=V; p[x+9,y+dy]=V
    for dx in range(-1,10): p[x+dx,y-1]=V; p[x+dx,y+2]=V
    p[x+7,y]=C('#c8b48a'); p[x+7,y+1]=C('#8a7a5a')
GY=35
def card_cave():
    setsize(); im=Image.new('RGBA',(CW,CH),V); p=im.load()
    rock(im,[0]*CW,GY+1,seed=44,dark='#1c1d27',mid='#262835',hi='#343747',crack='#101118')
    rnd=random.Random(4)
    for x in range(CW):
        for y in range(0,8):
            if dith(x,y,1-y/8): p[x,y]=C('#07070b')
    for sx in range(1,CW,4):
        hh=rnd.randint(2,7); x=sx+rnd.randint(-1,1)
        for k in range(hh):
            w=max(0,int(1.6*(1-k/hh)))
            for dx in range(-w,w+1):
                if 0<=x+dx<CW: p[x+dx,k]=C('#3a3d50') if dx<0 else C('#262835') if dx==0 else C('#16171f')
    cx=37
    for y in range(13,GY+1):
        t=(y-13)/(GY-13); half=int(3+min(1,t*2.4)*5+math.sin(y*0.9)*0.6)
        for x in range(cx-half,cx+half+1): p[x,y]=C('#030304')
        p[cx-half-1,y]=C('#4a4e64'); p[cx+half+1,y]=C('#16171f')
    for x in range(cx-3,cx+4): p[x,12]=C('#4a4e64')
    for k in range(0,10,3):
        y=GY-k; w=int(6*(1-k/14))
        for x in range(cx-w,cx+w+1): p[x,y]=C('#34364a') if k<4 else C('#22232f')
    fill_tex(im,tex(2,1),lambda x,y:y>GY,k=lambda c,x,y:tint(c,(0.44,0.47,0.62)))
    for x in range(CW): p[x,GY+1]=C('#0e0f14')
    CY=('#5ef0ff','#1f8fb8','#c8fbff'); VI=('#b88cff','#6a3ad0','#ecdcff')
    for (x,y,h,c,l) in [(4,GY+1,15,CY,-2),(8,GY+1,9,VI,2),(2,GY+1,6,VI,-1),(61,GY+1,16,VI,2),(57,GY+1,9,CY,-2),(64,GY+1,6,CY,1),(23,8,4,CY,0),(50,10,5,VI,0)]:
        crystal(im,x,y,h,*c,lean=l)
    fire(im,18,43); roll(im,44,41,('#4a3a6a','#2e2448','#6a5a90'))
    for (x,y,r,c) in [(5,28,9,'#5ef0ff'),(61,27,10,'#b88cff'),(37,30,6,'#5ef0ff')]: light(im,x,y,r,c)
    light(im,18,36,16,'#ff9a3a')
    return im
def card_prison():
    setsize(); im=Image.new('RGBA',(CW,CH),V); p=im.load()
    sky(im,y0=0,y1=14,seed=9); moon(im,44,3,2)
    top=[9 if (x//5)%2==0 else 6 for x in range(CW)]
    fill_tex(im,tex(1,16),lambda x,y:top[x]<=y<=GY,k=lambda c,x,y:tint(c,(0.46,0.47,0.64)))
    for x in range(CW):
        p[x,top[x]-1]=V
        if x>0 and top[x]!=top[x-1]:
            for y in range(min(top[x],top[x-1])-1,max(top[x],top[x-1])): p[x,y]=V
    for wx in (2,57):
        for y in range(16,25):
            for x in range(wx,wx+7):
                edge=x in (wx,wx+6) or y in (16,24)
                p[x,y]=V if edge else C('#2a2010') if (x-wx)%2==0 else C('#6a4a1a') if y>20 else C('#4a3214')
    cx=arch(im,21,51,GY+1,10,tint_img(tex(1,16),(0.5,0.5,0.62)),keyc='#8a7a5a')
    for y in range(19,24):
        for x in range(29,44):
            if (x-29)%3==0 and p[x,y][:3]==(3,3,3): p[x,y]=C('#4a4a50')
    for x in range(29,44):
        if p[x,23][:3] in ((3,3,3),(74,74,80)): p[x,24]=C('#5a5a62')
    fill_tex(im,tex(1,1),lambda x,y:y>GY,k=lambda c,x,y:tint(c,(0.48,0.5,0.66)))
    for x in range(CW): p[x,GY+1]=C('#141414')
    rnd=random.Random(8)
    for _ in range(8):
        x=rnd.randrange(CW); y=rnd.randrange(GY+3,CH); p[x,y]=C('#3f6a35')
    # бочка
    for y in range(37,45):
        for x in range(57,63): p[x,y]=C('#7a5532') if x<60 else C('#5a3c22')
        p[56,y]=V; p[63,y]=V
    for x in range(56,64): p[x,36]=V; p[x,45]=V; p[x,39]=C('#3a3a40'); p[x,42]=C('#3a3a40')
    night(im,(0.82,0.84,0.95),keep=lambda x,y:y<top[x])
    torches(im,(24,48),23)
    fire(im,13,43)
    light(im,13,36,16,'#ff9a3a'); light(im,24,20,7,'#ffb050'); light(im,48,20,7,'#ffb050')
    for wx in (5,60): light(im,wx,20,6,'#ffb04a')
    return im
def card_hall():
    setsize(); im=Image.new('RGBA',(CW,CH),V); p=im.load()
    fill_tex(im,tex(3,16),lambda x,y:4<=y<=GY,k=lambda c,x,y:tint(c,(0.5,0.5,0.62)))
    for x in range(CW):
        for y in range(0,4): p[x,y]=C('#0d0c0a') if dith(x,y,1-y/5) else C('#16130f')
        p[x,3]=C('#4a3018'); p[x,4]=V
    for (x0,x1) in ((1,7),(58,64)):
        for y in range(5,GY+1):
            for x in range(x0,x1+1):
                p[x,y]=V if x in (x0,x1) else C('#a89c84') if x<x0+2 else C('#8a7f6a') if x<x1-1 else C('#6a614f')
        for y in (5,6,GY-1,GY):
            for x in range(x0-1,x1+2):
                if 0<=x<CW: p[x,y]=V if y in (5,GY) or x in (x0-1,x1+1) else C('#c8b890')
    for bx in (11,49):
        for y in range(8,24):
            for x in range(bx,bx+6):
                if y>20 and abs(x-(bx+2.5))<(y-20): continue
                p[x,y]=V if x in (bx,bx+5) else C('#a02828') if x<bx+3 else C('#7a1c1c')
        for x in range(bx-1,bx+7): p[x,7]=C('#c8a050')
        for (dx,dy) in [(2,12),(3,12),(2,13),(3,13),(1,14),(4,14)]: p[bx+dx,dy]=C('#ffcc66')
    for y in range(16,GY+1):
        for x in range(25,42): p[x,y]=V if x in (25,41) or y==16 else C('#030303')
    for y in range(12,16):
        for x in range(23,44): p[x,y]=V if y in (12,15) or x in (23,43) else C('#c8b890') if y==13 else C('#9a8a68')
    for x in range(31,36): p[x,14]=C('#ffcc66')
    for k in range(0,12,3):
        y=GY-k; w=int(7*(1-k/18))
        for x in range(33-w,34+w): p[x,y]=C('#4a4434') if k<4 else C('#2e2a20')
    fill_tex(im,tex(3,1),lambda x,y:y>GY,k=lambda c,x,y:tint(c,(0.56,0.58,0.72)))
    for y in range(GY+1,CH):
        for x in range(CW):
            if abs(x-33)<=5+(y-GY)*0.35: p[x,y]=C('#7a2020') if dith(x,y,.7) else C('#5a1818')
    for x in range(CW): p[x,GY+1]=C('#141414')
    for lx in (19,47):
        for (dx,dy,c) in [(0,0,'#ffcc66'),(-1,1,'#c8a050'),(1,1,'#c8a050'),(0,1,'#fff3a0'),(0,2,'#8a6a2a'),(0,-1,'#3a2a14')]: p[lx+dx,24+dy]=C(c)
    fire(im,14,43); roll(im,47,41,('#3a5a8a','#26406a','#6a86b0'))
    light(im,14,36,16,'#ff9a3a'); light(im,19,25,9,'#ffcc66'); light(im,47,25,9,'#ffcc66'); light(im,33,14,6,'#ffcc66')
    return im
def card_outdoor():
    setsize(); im=Image.new('RGBA',(CW,CH),V); p=im.load()
    sky(im,y0=0,y1=GY,seed=7); moon(im,55,7,3)
    ridge(im,20,1,'#191730',11,step=4); ridge(im,23,1,'#14132a',12,step=3)
    top=[int(14+(abs(x-35)/33)**1.6*9) for x in range(CW)]
    rock(im,top,GY+1,seed=21)
    arch(im,21,49,GY+1,9,tex(0,16))
    def path(x,y): return abs(x-35-(y-GY)*0.1)<=4+(y-GY)*0.6
    ground(im,GY,['#2f4f2a','#36592f','#4f7a3c','#5f9047'],31,path,['#4a3b2a','#55442f','#6a5639'])
    grass_tufts(im,[(3,39),(60,40),(28,46),(52,46),(8,46)],'#5f9047','#3f6a35')
    night(im,(0.62,0.66,0.86),keep=lambda x,y:y<GY and y<top[x])
    torches(im,(24,46),23)
    fire(im,13,43); roll(im,47,41,('#3a5a8a','#26406a','#6a86b0'))
    light(im,13,36,16,'#ff9a3a'); light(im,24,20,7,'#ffb050'); light(im,46,20,7,'#ffb050')
    return im
if __name__=='__main__':
    out=[]
    for k,f in (('outdoor',card_outdoor),('cave',card_cave),('prison',card_prison),('hall',card_hall)):
        im=f(); im.save(O+f'camp-card-{k}.png'); out.append(im)
    o=Image.new('RGBA',(4*(CW*4+8),CH*4),(0,0,0,255))
    for i,im in enumerate(out): o.alpha_composite(im.resize((CW*4,CH*4),0),(i*(CW*4+8),0))
    o.save('./out/campcards.png'); print('ok')
