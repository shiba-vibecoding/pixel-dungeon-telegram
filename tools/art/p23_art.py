import sys; sys.path.insert(0,'.')
from lib import *
A='./shattered/'; O='./out/'; S='./spr/'
V=(11,11,9,255)
def C(h,a=255): h=h.lstrip('#'); return (int(h[0:2],16),int(h[2:4],16),int(h[4:6],16),a)
# ---------- испытания: 7 наших + «Враги-чемпионы» и «Злые боссы» ----------
old=Image.open(S+'sheet-challenges.png').convert('RGBA')
P={'#':V,'w':C('#f0ead8'),'s':C('#c8c0a8'),'S':C('#8a8470'),'r':C('#e04030'),'R':C('#8a1a10'),'o':C('#ff9a2a'),'y':C('#ffd84a'),'k':C('#2a2620'),'g':C('#e0a030'),'G':C('#96601a'),'p':C('#ff6a2a')}
champ=from_ascii([
"..o....o....o...",
"...o...o...o....",
"o...o..o..o...o.",
".o...######..o..",
"..o.#wwwwws#.o..",
"...#wwwwwwss#...",
"oo.#ww##w##s#.oo",
"...#w#rr#rr#s#..",
"...#ww##w##s#...",
"..o#wwww#wss#o..",
".o..#wwwwss#..o.",
"o...#w#w#S#...o.",
"...o#s#s#S#o....",
"..o..#####...o..",
".o....o..o....o.",
"................"],P)
boss=from_ascii([
".#............#.",
"#R#..#.##.#..#R#",
"#rR##y#gg#y##Rr#",
".#rR#gyggyg#Rr#.",
"..#rR#ggggg#r#..",
"..#############.",
".#wwwwwwwwwwss#.",
".#w###www###s#..",
"#ww#rr#w#rr#ss#.",
"#ww#rrr#rrr#ss#.",
"#www###w###wss#.",
".#wwwww#wwwss#..",
"..#w#w#w#w#S#...",
"..#s#s#s#s#S#...",
"...#########....",
"................"],P)
new=blank(16*9,16); new.alpha_composite(old,(0,0)); new.alpha_composite(champ,(112,0)); new.alpha_composite(boss,(128,0))
new.save(O+'sheet-challenges9.png')
# выключенный вариант — как в старом листе: серый
# ---------- метки забега 9×9: зачёт, повтор, свой сид, без зачёта ----------
tags=[from_ascii(r,{'#':V,'g':C('#6ad04a'),'b':C('#7ab8ff'),'p':C('#c890ff'),'P':C('#7a4aa8'),'s':C('#a8a8a0'),'l':C('#5ab030')}) for r in [
[".........","........#",".......#g","......#g#","#....#g#.","g#..#g#..",".g##g#...","..gg#....","...#....."],
[".....#...","######b#.","#bbbbbbb#","######b#.",".#...#...",".#b######","#bbbbbbb#",".#b######","...#....."],
["....#....","...#l#...","..#lll#..","...#l#...","..##l##..",".#pppp#..","#ppPPpp#.","#pPPPPp#.",".######.."],
["..#####..",".#sssss#.","#ss...#s#","#s...#ss#","#s..#s.s#","#s.#s..s#","#s#s...s#",".#sssss#.","..#####.."]]]
st=blank(36,9)
for i,t in enumerate(tags): st.alpha_composite(t,(i*9,0))
st.save(O+'run-tags.png')
# ---------- цвета ловушек: 8 семейств + чёрная (сработала), форма «точки» ----------
TF=Image.open(A+'environment/terrain_features.png').convert('RGBA')
tc=blank(16*9,16)
for i in range(9): tc.alpha_composite(TF.crop((i*16,80,i*16+16,96)),(i*16,0))
tc.save(O+'trap-colours.png')
# ---------- колодец для памятки ----------
well=from_ascii([
"................","................","....########....","...#ssssssss#...","..#sSSSSSSSSs#..","..#S#bbbbbb#S#..",".#sS#bBbbBb#Ss#.",".#sS#bbbbbb#Ss#.",".#sSS######SSs#.",".#sssssssssss#..","..#sSsSsSsSs#...","..#sssssssss#...","...#########....","................","................","................"],
{'#':V,'s':C('#8a8f96'),'S':C('#5b5f66'),'b':C('#3a6ad8'),'B':C('#8ab8ff')})
well.save(O+'guide-well.png')
# ---------- «Ждать» и «Искать»: тёплые часы и лупа с голубым стеклом ----------
w=Image.open(S+'tool-wait.png').convert('RGBA'); p=w.load()
for y in range(w.height):
    for x in range(w.width):
        c=p[x,y]
        if c[3] and c[0]>180 and c[1]>180: p[x,y]=(min(255,c[0]+8),c[1]-6,c[2]-40,c[3])
w.save(O+'tool-wait2.png')
s=Image.open(S+'tool-search.png').convert('RGBA'); q=s.load()
# стекло: прозрачные точки внутри кольца — голубые
from collections import deque
seen=set(); dq=deque([(x,0) for x in range(s.width)]+[(x,s.height-1) for x in range(s.width)]+[(0,y) for y in range(s.height)]+[(s.width-1,y) for y in range(s.height)])
while dq:
    x,y=dq.popleft()
    if (x,y) in seen or not(0<=x<s.width and 0<=y<s.height): continue
    seen.add((x,y))
    if q[x,y][3]: continue
    dq.extend([(x+1,y),(x-1,y),(x,y+1),(x,y-1)])
for y in range(s.height):
    for x in range(s.width):
        if not q[x,y][3] and (x,y) not in seen: q[x,y]=(122,176,216,200) if (x+y)%3 else (200,228,248,220)
s.save(O+'tool-search2.png')
# превью
fs=[('sheet-challenges9.png',5),('run-tags.png',8),('trap-colours.png',4),('guide-well.png',5),('tool-wait2.png',6),('tool-search2.png',6)]
W=max(Image.open(O+f).width*k for f,k in fs); Hh=sum(Image.open(O+f).height*k+8 for f,k in fs)
o=Image.new('RGBA',(W,Hh),(90,92,84,255)); y=0
for f,k in fs:
    im=Image.open(O+f); o.alpha_composite(im.resize((im.width*k,im.height*k),0),(0,y)); y+=im.height*k+8
o.save('./out/v23art.png'); print('ok')
