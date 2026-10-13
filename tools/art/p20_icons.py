import sys, math; sys.path.insert(0,'/home/claude/world')
import p16_trophies as T
from lib import *
O='/home/claude/world/v20/'
def C(h): h=h.lstrip('#'); return (int(h[0:2],16),int(h[2:4],16),int(h[4:6],16),255)
T.TIER['jade']=[C('#1f5a52'),C('#3aa894'),C('#7ee8d0'),C('#e0fff6')]
G=[C('#8a5a18'),C('#ffcc66'),C('#fff3c0')]
# 16: нефритовый кубок со ступенькой-гравировкой и золотой искрой
c16=T.cup16('jade'); p=c16.load()
for (x,y) in [(6,5),(7,5),(7,6),(8,6),(8,7),(9,7)]: p[x,y]=C('#1f5a52')
for (x,y,c) in [(13,0,G[2]),(12,1,G[1]),(14,1,G[1]),(13,1,G[2]),(13,2,G[1])]: p[x,y]=c
c16.save(O+'trophy-pioneer.png')
# 32: тот же кубок крупно, гравировка — лестница вниз, золотой ободок
c32=T.cup32('jade'); p=c32.load()
for y in range(32):
    for x in range(32):
        if p[x,y][:3]==(255,255,255) and y<14: pass
for (x,y) in [(13,9),(14,9),(14,10),(15,10),(15,11),(16,11),(16,12),(17,12),(17,13),(18,13)]: p[x,y]=C('#1f5a52')
for x in range(5,27):
    if p[x,4][3] and p[x,4][:3]!=(11,11,9): p[x,4]=G[1] if x<16 else G[0]
for (x,y,c) in [(27,1,G[2]),(26,2,G[1]),(28,2,G[1]),(27,2,G[2]),(27,3,G[1])]: p[x,y]=c
c32.save(O+'trophy-pioneer-32.png')
# 48: эмблема для письма — кубок 32 в лавровом венке и лента с хвостами
e=blank(48,48); p=e.load()
LG=[C('#2a5a24'),C('#4f9a3e'),C('#9ad870')]
for side in (-1,1):
    for i in range(8):
        t=i/7; ang=math.radians(250-t*130)          # от низа вверх по дуге
        cx=24+side*math.cos(ang)*-18; cy=27-math.sin(ang)*-1*0-math.cos(math.radians(t*90))*0
        cx=24+side*(10+math.sin(math.radians(t*120))*9); cy=40-t*30
        lx=int(round(cx)); ly=int(round(cy))
        for dx,dy,c in [(0,0,LG[1]),(side,0,LG[1]),(side*2,-1,LG[2]),(side,-1,LG[2]),(0,1,LG[0]),(side,1,LG[0])]:
            X,Y=lx+dx,ly+dy
            if 0<=X<48 and 0<=Y<48: p[X,Y]=c
        if i<7:
            for k in range(3):
                X=int(round(24+side*(10+math.sin(math.radians((i+k/3)/7*120))*9))); Y=int(round(40-(i+k/3)/7*30))
                if p[X,Y][3]==0: p[X,Y]=LG[0]
e.alpha_composite(c32,(8,4)); p=e.load()
rib=[C('#7a1420'),C('#b8283a'),C('#ff6a6a')]
for x in range(12,36):
    for y in range(37,42): p[x,y]=rib[2] if y==37 else rib[1] if y<40 else rib[0]
for (x0,dir_) in ((12,-1),(35,1)):
    for k in range(5):
        X=x0+dir_*(k+1)
        for y in range(39+k//2,44+k//2):
            if 0<=X<48 and y<48: p[X,y]=rib[0] if y>41+k//2 else rib[1]
    for y in range(43,47):
        X=x0+dir_*5
        if (y-43)%2==0 and 0<=X<48: p[X,y]=(0,0,0,0)
e=outline(e,V); e.save(O+'trophy-pioneer-48.png')
# значок «Охотник за багами» 16×16 на рамке значков: щит и жук под лупой
badge=['....vvvvvvvv....','..vvGGGGGGGGvv..','.vGgggggggggGGv.','vGgggkkggggggGGv','vGggkbbkgggvvgGv','vGgkbBbbkgvwwvGv','vGgkbbbbkvwwwwvv','vGggkbbkgvwwwwvv','vGgkgkkgkgvwwvGv','vGggggggggvvgvGv','.vGggggggggvvgv.','..vGgggggggggvv.','...vGgggggggv...','....vvGggGvv....','......vvvv......','................']
pal={'v':V,'G':C('#c8902e'),'g':C('#4a6ad0'),'k':C('#1a1a24'),'b':C('#3aa848'),'B':C('#9cf08a'),'w':C('#c8f4ff')}
from_ascii(badge,pal).save(O+'badge-bughunter.png')
# значки окон: нет связи (облако с разрывом), отчёт (свиток с пером), правила (свиток с «?»), обновление (стрелка по кругу)
pal2={'v':V,'s':C('#9fa896'),'S':C('#e8e2c8'),'r':C('#ff8a73'),'g':C('#ffcc66'),'b':C('#7ad8ff'),'d':C('#62665b')}
off=['................','.....vvvv.......','....vSSSSv......','..vvSSSSSSvvv...','.vSSSSSSSSSSSv..','vSSSSSvvSSSSSSv.','vSSSSvrrvSSSSSv.','vSSSSvrrvSSSSSv.','.vSSSSvvSSSSSv..','..vvvvvvvvvvv...','......vrv.......','.....vrrrv......','......vrv.......','................','......vrv.......','.......v........']
from_ascii(off,pal2).save(O+'icon-offline.png')
rep=['...........vvv..','..........vggv..','.vvvvvvvvvggv...','vSSSSSSSvggvv...','vSdddddvggvSv...','vSSSSSvggvSSv...','vSddddvgvddSv...','vSSSSvgvSSSSv...','vSdddvvddddSv...','vSSSSvSSSSSSv...','vSddddddddSSv...','vSSSSSSSSSSSv...','vSSSSSSSSSSSv...','.vvvvvvvvvvv....','................','................']
from_ascii(rep,pal2).save(O+'icon-report.png')
upd=['................','.....vvvvvv.....','....vbbbbbbv....','...vbvvvvvvbv...','..vbv......vbvv.','..vbv.....vbbbv.','..vbv......vbv..','..vbv.......v...','...v.......vbv..','..vbv......vbv..','.vbbbv.....vbv..','.vvbv......vbv..','...vbvvvvvvbv...','....vbbbbbbv....','.....vvvvvv.....','................']
from_ascii(upd,pal2).save(O+'icon-update.png')
print('ok')
