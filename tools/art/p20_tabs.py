import sys; sys.path.insert(0,'/home/claude/world')
from lib import *
O='./out/'
V=(11,11,9,255)
def C(h): h=h.lstrip('#'); return (int(h[0:2],16),int(h[2:4],16),int(h[4:6],16),255)
G={'#':V,'d':C('#96601a'),'m':C('#e0a030'),'l':C('#ffcc66'),'w':C('#fff0b8')}
icons={
'tab-skin':[
"................",
"....###..###....",
"...#lm#..#ml#...",
"..#lmm####mmd#..",
".#lmmmmmmmmmmd#.",
"#lmm#mmmmmm#mmd#",
"#lm##mmmmmm##md#",
".##.#mmmmmm#.##.",
"....#lmmmmd#....",
"....#lmmmmd#....",
"....#lmmmmd#....",
"....#lm##md#....",
"....#lm##md#....",
"....#ld##dd#....",
"....###..###....",
"................"],
'tab-camp':[
"................",
".......#........",
"......#w#.......",
"......#wl#..#...",
".....#wlm#.#w#..",
"....#wllm##l#...",
"....#wlmmmlm#...",
"...#wllmdmmmd#..",
"...#wlmddmmmd#..",
"....#lmmmmmd#...",
"..###########...",
".#rRRrrrrRRrr#..",
"..##rrRRRrr###..",
".#RRrr###rrRR#..",
"..###.....###...",
"................"],
'tab-effect':[
"................",
"......#.........",
".....#w#........",
".....#l#....#...",
"..###lwl###.#w#.",
".#wllwwwllm##l#.",
"..###lwl###.#...",
".....#l#........",
".....#m#..#.....",
"......#..#w#....",
"........##l##...",
".......#wlwlm#..",
"........##l##...",
".........#m#....",
"..........#.....",
"................"],
'tab-frame':[
"................",
".##############.",
".#wlllllllllllm#",
".#l##########m#.",
".#l#ssssssss#m#.",
".#l#ssssssss#m#.",
".#l#ssssssss#m#.",
".#l#ssssssss#m#.",
".#l#ssssssss#m#.",
".#l#ssssssss#m#.",
".#l#ssssssss#m#.",
".#l##########m#.",
".#lmmmmmmmmmmdd#",
".##############.",
"................",
"................"],
}
pal=dict(G); pal.update({'r':C('#7a5532'),'R':C('#4a3018'),'s':C('#262835')})
ims=[]
for k,rows in icons.items():
    rows=[r.ljust(16,'.')[:16] for r in rows]
    im=from_ascii(rows,pal); im.save(O+k+'.png'); ims.append(im)
o=Image.new('RGBA',(len(ims)*72,64),(40,42,36,255))
for i,im in enumerate(ims): o.alpha_composite(im.resize((64,64),0),(i*72,0))
o.save('./out/tabs.png')
