from PIL import Image
S='/home/claude/sh/spd/core/src/main/assets/interfaces/'; O='/home/claude/world/buffs/'
small=Image.open(S+'buffs.png').convert('RGBA'); large=Image.open(S+'large_buffs.png').convert('RGBA')
def cell(im,i,sz):
    cols=im.width//sz; return im.crop(((i%cols)*sz,(i//cols)*sz,(i%cols)*sz+sz,(i//cols)*sz+sz))
import colorsys
def hard(im,m):
    if m is None: return im
    out=im.copy(); p=out.load()
    if len(m)==3:   # как hardlight в Shattered: умножение каналов
        for y in range(out.height):
            for x in range(out.width):
                c=p[x,y]
                if c[3]: p[x,y]=tuple(min(255,int(c[i]*m[i])) for i in range(3))+(c[3],)
        return out
    h0,s0=m
    for y in range(out.height):
        for x in range(out.width):
            c=p[x,y]
            if not c[3]: continue
            h,s,v=colorsys.rgb_to_hsv(*(q/255 for q in c[:3]))
            if v<0.12: continue
            r,g,b=colorsys.hsv_to_rgb(h0, min(1,s0*max(0.62,s)) if v<0.97 else s0*0.3, min(1,v**0.85))
            p[x,y]=(int(r*255),int(g*255),int(b*255),c[3])
    return out
# [ключ, ru, en, иконка Shattered, множители hardlight]
T=[('haste','Ускорение','Haste',41,(0.13,0.95)),('stamina','Выносливость','Stamina',41,(0.33,0.8)),
   ('fireImbue','Огненная пропитка','Fire imbue',55,(2,0.75,0)),('toxicImbue','Ядовитая пропитка','Toxic imbue',55,(1,1.5,0)),('frostImbue','Ледяная пропитка','Frost imbue',55,(0,1.6,2.6)),
   ('barrier','Барьер','Barrier',20,(0.53,0.85)),('arcaneArmor','Тайная броня','Arcane armor',20,(0.78,0.7)),('prismatic','Призматический щит','Prismatic guard',20,(0.60,0.28)),('prismaticFull','Призматический щит, усилен','Prismatic guard, empowered',20,(1.6,1.5,0.9)),
   ('healing','Лечение','Healing',44,None),('aquaHealing','Водное лечение','Aquatic healing',44,(0.5,0.85)),('might','Рост здоровья','Health boost',44,(0.08,0.95)),
   ('cloak','Плащ теней','Cloak of shadows',12,(0.77,0.6)),('invisible','Невидимость (зелье)','Invisibility (potion)',12,None),
   ('hourglass','Песочные часы: стазис','Hourglass: stasis',7,(0.08,0.9)),('slow','Замедление','Slowed',7,None),
   ('capeThorns','Плащ шипов','Cape of thorns',31,(0.08,0.6)),('talisman','Талисман предвидения','Talisman of foresight',32,(0.5,0.65))]
ss=Image.new('RGBA',(7*len(T),7)); ls=Image.new('RGBA',(16*len(T),16))
for i,t in enumerate(T):
    ss.alpha_composite(hard(cell(small,t[3],7),t[4]),(i*7,0)); ls.alpha_composite(hard(cell(large,t[3],16),t[4]),(i*16,0))
ss.save(O+'buffs-tints.png'); ls.save(O+'buffs-tints-large.png')
import json; json.dump([list(t[:4])+[list(t[4]) if t[4] else None] for t in T],open(O+'buffs-tints.json','w'),ensure_ascii=False,indent=1)
pv=Image.new('RGBA',(16*len(T)*3,16*3+7*3+6),(40,42,36,255))
pv.alpha_composite(ls.resize((ls.width*3,48),Image.NEAREST),(0,0)); pv.alpha_composite(ss.resize((ss.width*3,21),Image.NEAREST),(0,54))
pv.save('/home/claude/shat/dbg/bt.png')
