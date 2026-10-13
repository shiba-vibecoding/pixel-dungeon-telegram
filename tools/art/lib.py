from PIL import Image, ImageDraw, ImageFont
import json, os, math
A='/home/claude/pdt/packages/client/public/assets/'
OUT='/home/claude/world/out/world/'; PRE='/home/claude/world/out/previews/'
REGIONS=['Канализация','Тюрьма','Пещеры','Город гномов','Демонические залы']
V=(11,11,9,255)
def tiles(r): return Image.open(A+f'tiles{r}.png').convert('RGBA')
def tile(sheet,n,size=16,cols=16): return sheet.crop(((n%cols)*size,(n//cols)*size,(n%cols)*size+size,(n//cols)*size+size))
ITEMS=Image.open(A+'items.png').convert('RGBA')
def item(n): return ITEMS.crop(((n%8)*16,(n//8)*16,(n%8)*16+16,(n//8)*16+16))
def blank(w,h): return Image.new('RGBA',(w,h),(0,0,0,0))
def shade(c,k):  # k<1 darker, >1 lighter toward white
    if c[3]==0: return c
    if k<=1: return (int(c[0]*k),int(c[1]*k),int(c[2]*k),c[3])
    t=k-1; return (int(c[0]+(255-c[0])*t),int(c[1]+(255-c[1])*t),int(c[2]+(255-c[2])*t),c[3])
def diffmask(a,b): return [[a.getpixel((x,y))!=b.getpixel((x,y)) for x in range(a.width)] for y in range(a.height)]
def from_ascii(rows, pal):
    h=len(rows); w=max(len(r) for r in rows); im=blank(w,h); p=im.load()
    for y,r in enumerate(rows):
        for x,ch in enumerate(r):
            if ch in pal: p[x,y]=pal[ch]
    return im
def outline(im, col=V):
    w,h=im.size; out=blank(w,h); src=im.load(); o=out.load()
    for y in range(h):
        for x in range(w):
            if src[x,y][3]: continue
            for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)):
                X,Y=x+dx,y+dy
                if 0<=X<w and 0<=Y<h and src[X,Y][3]>0: o[x,y]=col; break
    out.alpha_composite(im); return out
KEYMAP={'туман':'fog','пыль':'fog','взвесь':'fog','дым':'fog','марево':'fog'}
def keyof(label, have):
    import re
    k=re.split(r'[\s:(]',label.strip(),1)[0].strip()
    k=KEYMAP.get(k,k)
    if k in have:
        k2=k+'-pressed' if 'нажат' in label else k+'-2'
        k=k2
    return k
class Sheet:
    """Лист с атласом: add(name, frames, w, h, ms) кладёт строку кадров."""
    def __init__(self, name, title):
        self.name=name; self.title=title; self.rows=[]
    def add(self, label, frames, ms, note=''):
        self.rows.append((label, frames, ms, note))
    def build(self):
        W=max(sum(f.width for f in fr) for _,fr,_,_ in self.rows); H=sum(max(f.height for f in fr) for _,fr,_,_ in self.rows)
        im=blank(W,H); atlas={'image':self.name+'.png','animations':{}}; y=0
        for label,fr,ms,note in self.rows:
            x=0; rh=max(f.height for f in fr); frames=[]
            for i,f in enumerate(fr):
                im.alpha_composite(f,(x,y)); frames.append({'x':x,'y':y,'w':f.width,'h':f.height,'ms':(ms[i] if isinstance(ms,list) else ms)}); x+=f.width
            key=keyof(label, atlas['animations'])
            atlas['animations'][key]={'label':label,'frames':frames,'note':note}
            y+=rh
        im.save(OUT+self.name+'.png',optimize=True)
        json.dump(atlas,open(OUT+self.name+'.json','w'),ensure_ascii=False,indent=1)
        preview(self, im, atlas)
        return im, atlas
FONT=ImageFont.truetype('/home/claude/fonts-dl/galmuri-2.40.3/package/dist/Galmuri9.ttf',10)
FONTB=ImageFont.truetype('/home/claude/fonts-dl/galmuri-2.40.3/package/dist/Galmuri11.ttf',12)
def text(d,xy,s,fill,font=FONT):
    d.fontmode='1'; d.text(xy,s,fill=fill,font=font)
def preview(sheet, im, atlas, k=4):
    pad=8; lw=0
    rows=[]
    for label,fr,ms,note in sheet.rows:
        rows.append((label,fr,ms,note))
    rowh=[max(f.height for f in fr)*k+30 for _,fr,_,_ in rows]
    W=max(pad*2+sum(max(f.width*k,44)+6 for f in fr) for _,fr,_,_ in rows); W=max(W,8+int(max(FONT.getlength(l+"  · "+n) for l,_,_,n in rows))+16, 360)
    H=40+sum(rowh)+pad
    pv=Image.new('RGBA',(W,H),(31,33,28,255)); d=ImageDraw.Draw(pv)
    text(d,(pad,8),f'{sheet.name}.png — {sheet.title}  (×{k})',(255,235,164,255),FONTB)
    y=34
    for (label,fr,ms,note),rh in zip(rows,rowh):
        msl=ms if isinstance(ms,list) else [ms]*len(fr)
        text(d,(pad,y),label+(('  · '+note) if note else ''),(176,181,163,255))
        x=pad; yy=y+14
        for i,f in enumerate(fr):
            cell=Image.new('RGBA',(f.width*k,f.height*k),(11,11,9,255))
            # шахматка под прозрачностью
            cd=ImageDraw.Draw(cell)
            for cy in range(0,f.height*k,k*2):
                for cx in range(0,f.width*k,k*2):
                    if (cx//(k*2)+cy//(k*2))%2==0: cd.rectangle([cx,cy,cx+k*2-1,cy+k*2-1],fill=(20,21,18,255))
            cell.alpha_composite(f.resize((f.width*k,f.height*k),Image.NEAREST))
            pv.alpha_composite(cell,(x,yy))
            text(d,(x,yy+f.height*k+1),f'{i} · {msl[i]}' if msl[i] else f'{i}',(232,226,200,255))
            x+=max(f.width*k,44)+6
        y+=rh
    pv.save(PRE+sheet.name+'.png')
