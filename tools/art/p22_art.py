import sys, json; sys.path.insert(0,'.')
from lib import *
A='./shattered/'; O='./out/'
V=(11,11,9,255)
def C(h,a=255): h=h.lstrip('#'); return (int(h[0:2],16),int(h[2:4],16),int(h[4:6],16),a)
small=Image.open(A+'interfaces/buffs.png').convert('RGBA'); large=Image.open(A+'interfaces/large_buffs.png').convert('RGBA')
HI=Image.open(A+'interfaces/hero_icons.png').convert('RGBA')
def cell(im,i,sz): cols=im.width//sz; return im.crop(((i%cols)*sz,(i//cols)*sz,(i%cols)*sz+sz,(i//cols)*sz+sz))
def hard(im,m):
    if m is None: return im.copy()
    out=im.copy(); p=out.load()
    for y in range(out.height):
        for x in range(out.width):
            c=p[x,y]
            if c[3]: p[x,y]=tuple(min(255,int(c[i]*m[i])) for i in range(3))+(c[3],)
    return out
def strip(ims,sz):
    s=blank(sz*len(ims),sz)
    for i,im in enumerate(ims): s.alpha_composite(im,(i*sz,0))
    return s
# ---------- свои значки 7×7 и 16×16: стена света, освящённая земля ----------
NAVY=C('#0d1d4a'); Y=C('#ffea00'); YD=C('#c8a800'); G=C('#5ad83a'); GD=C('#2f8a1a')
def from_rows(rows,pal): return from_ascii(rows,pal)
wall7=from_rows(["nnnnnnn","nyynyyn","nnnnnnn","yynyynn","nnnnnnn","nyynyyn","nnnnnnn"],{'n':NAVY,'y':Y})
hall7=from_rows(["nnnnnnn","nnngnnn","ngngngn","nngGgnn","ngGgGgn","yyyyyyy","nnnnnnn"],{'n':NAVY,'g':G,'G':GD,'y':Y})
wall16=cell(HI,57,16); hall16=from_rows([
"nnnnnnnnnnnnnnnn",
"nnnnnnnnnnnnnnnn",
"nnnnnnnygnnnnnnn",
"nnnnnnnggnnnnnnn",
"nnngnnnggnnngnnn",
"nnnggnngGnnggnnn",
"nnnnGgngGnggnnnn",
"nngnnGgGGgGnngnn",
"nnggnnGGGGnnggnn",
"nnnGgnGGGGngGnnn",
"nnnnGGGGGGGGnnnn",
"nyyyyyyyyyyyyyyn",
"nYYYYYYYYYYYYYYn",
"nnnnnnnnnnnnnnnn",
"nnnnnnnnnnnnnnnn",
"nnnnnnnnnnnnnnnn"],{'n':NAVY,'g':G,'G':GD,'y':Y,'Y':YD})
# ---------- значки Клирика: вознесение, сила многих, три формы, стена света, освящённая земля ----------
CL=[('ascend',79,None),('many',83,None),('body',82,(1,0,0)),('mind',82,(.25,.6,1)),('spirit',82,(0,1,0))]
cs=[hard(cell(small,i,7),m) for k,i,m in CL]+[wall7,hall7]; cl=[hard(cell(large,i,16),m) for k,i,m in CL]+[wall16,hall16]
strip(cs,7).save(O+'cleric-buffs.png'); strip(cl,16).save(O+'cleric-buffs-l.png')
# ---------- значки талантов с оттенками (Talent.java: icon + hardlight) ----------
TT=[('improvised',7,(0.15,0.2,0.5)),('rejuvenating',7,(0,0.35,0.15)),('seerShot',7,(0.7,0.4,0.7)),('patientStrike',7,(0.5,0,1)),('aggressiveBarrier',7,(0.35,0,0.7)),
    ('lethalHaste',7,(0.35,0,0.7)),('swiftEquip',7,(0.35,0,0.7)),('swiftEquip2',7,(0.85,0,1)),('searingLight',7,(0,0,1)),
    ('liquidAgility',57,(0.5,0,1)),('deadlyFollowup',57,(0.5,0,1)),('preciseAssault',57,(1,1,0)),('followupStrike',57,(0,0.75,1)),
    ('provokedAnger',45,(1.43,1.43,1.43)),('lingeringMagic',45,(1.43,1.43,0)),('satiatedSpells',75,None)]
strip([hard(cell(small,i,7),m) for k,i,m in TT],7).save(O+'talent-buffs.png'); strip([hard(cell(large,i,16),m) for k,i,m in TT],16).save(O+'talent-buffs-l.png')
# ---------- комбо: значок состояния 17 с оттенком лучшего приёма ----------
COMBO=[('none',None),('clobber',(0,1,0)),('slam',(0.8,1,0)),('parry',(1,1,0)),('crush',(1,0.8,0)),('fury',(1,0,0))]
strip([hard(cell(small,17,7),m) for k,m in COMBO],7).save(O+'combo-buffs.png'); strip([hard(cell(large,17,16),m) for k,m in COMBO],16).save(O+'combo-buffs-l.png')
# ---------- один лист заклинаний над героем: 8 Shattered + «мастерство» из PD 1.9 ----------
sp=Image.open(A+'effects/spell_icons.png').convert('RGBA'); pd=Image.open('./pd19/spell_icons.png').convert('RGBA')
ss=blank(16*9,16); ss.alpha_composite(sp,(0,0)); ss.alpha_composite(pd.crop((48,0,64,16)),(128,0)); ss.save(O+'spell-sprites.png')
# ---------- Хранительница: 12 растений (terrain_features 112–123) и что они ей дают (крупные значки) ----------
TF=Image.open(A+'environment/terrain_features.png').convert('RGBA')
plants=[cell(TF,112+i,16) for i in range(12)]; strip(plants,16).save(O+'warden-plants.png')
WE=[(50,None),(55,(2,0.75,0)),(41,None),(19,None),(55,(0,1.6,2.6)),(1,None),(55,(1,1.5,0)),(25,None),(20,None),(34,None),(None,None),(12,None)]
def stairs16():
    rows=["nnnnnnnnnnnnnnnn","nnnnnnnnnnnnnnnn","nnnnnnnnnnnnnnnn","nnnnnnnnnnnwwwnn","nnnnnnnnnnnwwwnn","nnnnnnnnnwwwssnn","nnnnnnnnnwwwssnn","nnnnnnnwwwssssnn","nnnnnnnwwwssssnn","nnnnnwwwssssssnn","nnnnnwwwssssssnn","nnnwwwssssssssnn","nnnwwwssssssssnn","nnnnnnnnnnnnnnnn","nnnnnnnnnnnnnnnn","nnnnnnnnnnnnnnnn"]
    return from_rows(rows,{'n':C('#2a5a2a'),'w':C('#e8f0d0'),'s':C('#9ab08a')})
eff=[hard(cell(large,i,16),m) if i is not None else stairs16() for i,m in WE]; strip(eff,16).save(O+'warden-effects.png')
# ---------- свои значки 16×16: приёмы Монаха, части счёта, прицел ----------
P={'#':V,'b':C('#5a4422'),'B':C('#a08840'),'y':C('#ffe080'),'w':C('#fff6d8'),'r':C('#e04a2a'),'g':C('#6ad04a'),'c':C('#8ad8ff'),'d':C('#3a2a12'),'s':C('#c8c8c8'),'S':C('#7a7a7a'),'k':C('#2a2a2a'),'o':C('#e0a030'),'l':C('#ffcc66'),'m':C('#96601a')}
MONK={
'flurry':["bbbbbbbbbbbbbbbb","bBBBBBBBBBBBBBBb","bB###BBBBB###BBb","bB#ww#BBB#ww#BBb","bB#wy#BBB#wy#BBb","bB#yy#yBy#yy#BBb","bB####BBB####BBb","bBByBBByBBByBBBb","bBByBBByBBByBBBb","bB###BBBBB###BBb","bB#ww#BBB#ww#BBb","bB#wy#BBB#wy#BBb","bB#yy#BBB#yy#BBb","bB####BBB####BBb","bBBBBBBBBBBBBBBb","bbbbbbbbbbbbbbbb"],
'focus':["bbbbbbbbbbbbbbbb","bBBBBBBBBBBBBBBb","bBBBBByyyyBBBBBb","bBBByyBBBByyBBBb","bBByBBBBBBBByBBb","bByBBB####BBByBb","bByBB#wwww#BByBb","byBB#ww##ww#BByb","byBB#ww##ww#BByb","bByBB#wwww#BByBb","bByBBB####BBByBb","bBByBBBBBBBByBBb","bBBByyBBBByyBBBb","bBBBBByyyyBBBBBb","bBBBBBBBBBBBBBBb","bbbbbbbbbbbbbbbb"],
'dash':["bbbbbbbbbbbbbbbb","bBBBBBBBBBBBBBBb","bBBBBBBBBB#BBBBb","bBBBBBBBBB##BBBb","byyyyBBBBB#w#BBb","bBBBBBy####ww#Bb","bBByyyBwwwwwww#b","bBBBBBy####ww#Bb","byyyyBBBBB#w#BBb","bBBBBBBBBB##BBBb","bBBBBBBBBB#BBBBb","bBByyyyBBBBBBBBb","bBBBBBBBBBBBBBBb","bByyBBByyyBBBBBb","bBBBBBBBBBBBBBBb","bbbbbbbbbbbbbbbb"],
'kick':["bbbbbbbbbbbbbbbb","bBBBBBBBBBBBBBBb","bBBBBBBBBBBBByBb","bBBBBBBBBBByByBb","bBB####BBBBByBBb","bBB#ww#BBBBBBBBb","bBB#ww##BBBByBBb","bBB#wwww#BByByBb","bBBB#wwww##yBBBb","bBBBB#wwwww#BBBb","bBBBBB#wwww#yBBb","bBBBBBB####ByByb","bBBBBBBBBBBBBByb","bBBBBBBBBBBBBBBb","bBBBBBBBBBBBBBBb","bbbbbbbbbbbbbbbb"],
'meditate':["bbbbbbbbbbbbbbbb","bBBBBBBBBBBBBBBb","bBBBBBByBBBBBBBb","bBBBBByyyBBBBBBb","bBBBBBy#yBBBBBBb","bBBBBB###BBBBBBb","bBBBBB#w#BBBBBBb","bBBBB#www#BBBBBb","bBBB#wwwww#BBBBb","bBB#w#www#w#BBBb","bBB##wwwww##BBBb","bBBB#######BBBBb","bBByyyyyyyyyBBBb","bBBBBBBBBBBBBBBb","bBBBBBBBBBBBBBBb","bbbbbbbbbbbbbbbb"]}
strip([from_rows(r,P) for r in MONK.values()],16).save(O+'monk-abilities.png')
SCORE={
'progress':["................","................","##########......","#llllllll#......","#mmmmmmmm#......","#ssssssss####...","#SSSSSSSSllll#..","#ssssssssmmmm#..","#SSSSSSSSssss###","#ssssssssSSSSll#","#SSSSSSSSssssmm#","#ssssssssSSSSss#","################","......#y#.......",".....#yyy#......","......###......."],
'treasure':["................","................","......####......",".....#lllo#.....","....#llloom#....","...####oom####..","..#lllo##m#lll#.","..#lloom#mloom#.","..#oomm##ommm#..","...####ll####...","...#llloooom#...","..#lllooooomm#..","..#looommmmmm#..","...##########...","................","................"],
'explore':["................","..#########.....",".#wwwwwwwww#....",".#wSwwwSSww#....",".#wSSwwwSww#....",".#wwSSwwwww#....",".#wwwS##www#....",".#wwww#cc###....",".#www#cwwc#.....",".#www#cwwc#.....",".#wwww#cc##.....",".######..##.....","..........##....","...........##...","............#...","................"],
'bosses':["................","...#..#..#..#...","..#l##l##l##l#..","..#lllllllllo#..","..############..","..#ssssssssSS#..",".#sssssssssSSS#.",".#ss##sss##SSS#.",".#s#rr#s#rr#SS#.",".#ss##sss##SSS#.",".#sssss#ssSSSS#.","..#sssssssSSS#..","...#s#s#s#S##...","...#s#s#s#S#....","....#######.....","................"],
'quests':["................","...##########...","..#wwwwwwwwww#..","..#w#######ww#..","..#wwwwwwwwww#..","..#w######www#..","..#wwwwwwwwww#..","..#w#####wwww#..","..#wwwwwwww###..","..#w####ww#gg#..","..#wwwwww#ggg#..","..#wwwwww#g#g#..","...#######g###..","..........#.....","................","................"]}
def stairs_prog():
    im=blank(16,16); p=im.load()
    for x in range(1,15):
        h=2+3*((x-1)//4)
        for y in range(h,14): p[x,y]=C('#ffcc66') if y==h else C('#e0a030') if y==h+1 else (C('#8a8f96') if (x+y)%5 else C('#6a6f76'))
    im=outline(im,V); q=im.load()
    for (x,y) in [(12,1),(12,2),(12,3),(11,3),(13,3),(10,2),(14,2)]: pass
    ar=blank(16,16); r=ar.load()
    for (x,y) in [(12,1),(12,2),(12,3),(12,4),(10,5),(11,5),(12,5),(13,5),(14,5),(11,6),(12,6),(13,6),(12,7)]: r[x,y]=C('#ffffff')
    im.alpha_composite(outline(ar,V))
    return im
SCORE_IM=[stairs_prog()]+[from_rows(r,P) for k,r in SCORE.items() if k!='progress']
strip(SCORE_IM,16).save(O+'score-parts.png')

aim=from_rows(["################","#ll##########ll#","#l############l#","################","######....######","######....######","######.ll.######","######.ll.######","######....######","######....######","################","################","################","#l############l#","#ll##########ll#","################"],{'#':(0,0,0,0),'.':(0,0,0,0),'l':C('#ffcc66')})
aim.save(O+'aim.png')
json.dump({'cleric':[k for k,_,_ in CL]+['wall','hallowed'],'talent':[k for k,_,_ in TT],'combo':[k for k,_ in COMBO],'monk':list(MONK),'score':list(SCORE)},open(O+'v22.json','w'))
# превью
fs=['cleric-buffs-l.png','talent-buffs-l.png','combo-buffs-l.png','spell-sprites.png','warden-plants.png','warden-effects.png','monk-abilities.png','score-parts.png','aim.png']
W=max(Image.open(O+f).width for f in fs)*4; o=Image.new('RGBA',(W,len(fs)*72),(40,42,36,255))
for i,f in enumerate(fs): im=Image.open(O+f); o.alpha_composite(im.resize((im.width*4,im.height*4),0),(0,i*72))
o.save('./out/v22art.png'); print('ok')
