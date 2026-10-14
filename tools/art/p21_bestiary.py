import sys, json; sys.path.insert(0,'.')
from PIL import Image
S='./shattered/sprites/'; O='./out/'
def frame(sheet,fw,fh,i):
    im=Image.open(S+sheet+'.png').convert('RGBA'); cols=im.width//fw
    return im.crop(((i%cols)*fw,(i//cols)*fh,(i%cols)*fw+fw,(i//cols)*fh+fh))
# key, sheet, fw, fh, frame, region(0-4 / 'boss' / 'any' / 'rare'), ru, en
M=[
('rat','rat',16,15,0,0,'Крыса','Rat'),('snake','snake',12,11,0,0,'Змея','Snake'),('gnoll','gnoll',12,15,0,0,'Гнолл-разведчик','Gnoll scout'),('swarm','swarm',16,16,0,0,'Рой мух','Swarm of flies'),('crab','crab',16,16,0,0,'Краб','Sewer crab'),('slime','slime',14,12,0,0,'Слизень','Slime'),
('skeleton','skeleton',12,15,0,1,'Скелет','Skeleton'),('thief','thief',12,13,0,1,'Вор','Thief'),('dm100','dm100',16,14,0,1,'DM-100','DM-100'),('guard','guard',12,16,0,1,'Тюремный страж','Prison guard'),('necro','necromancer',16,16,0,1,'Некромант','Necromancer'),
('bat','bat',15,15,0,2,'Летучая мышь','Vampire bat'),('brute','brute',12,16,0,2,'Гнолл-громила','Gnoll brute'),('shamanR','shaman',12,15,0,2,'Шаман (красный)','Red shaman'),('shamanB','shaman',12,15,21,2,'Шаман (синий)','Blue shaman'),('shamanP','shaman',12,15,42,2,'Шаман (фиолетовый)','Purple shaman'),('spinner','spinner',16,16,0,2,'Пещерный паук','Cave spinner'),('dm200','dm200',21,18,0,2,'DM-200','DM-200'),
('ghoul','ghoul',12,14,0,3,'Гуль','Dwarven ghoul'),('elemFire','elemental',12,14,0,3,'Огненный элементаль','Fire elemental'),('elemFrost','elemental',12,14,28,3,'Ледяной элементаль','Frost elemental'),('elemShock','elemental',12,14,42,3,'Грозовой элементаль','Shock elemental'),('warlock','warlock',12,15,0,3,'Колдун','Dwarf warlock'),('monk','monk',15,14,1,3,'Монах','Dwarf monk'),('golem','golem',17,19,0,3,'Голем','Golem'),
('ripper','ripper',15,14,1,4,'Демон-потрошитель','Ripper demon'),('spawner','spawner',16,16,0,4,'Демонический спаунер','Demon spawner'),('succubus','succubus',12,15,0,4,'Суккуб','Succubus'),('eye','eye',16,18,0,4,'Злой глаз','Evil eye'),('scorpio','scorpio',17,17,0,4,'Скорпион','Scorpio'),
('goo','goo',20,14,2,'boss','Жижа','Goo'),('tengu','tengu',14,16,0,'boss','Тэнгу','Tengu'),('pylon','pylon',10,20,0,'boss','Пилон','Pylon'),('dm300','dm300',25,22,0,'boss','DM-300','DM-300'),('dwarfking','king',16,16,0,'boss','Король дворфов','Dwarf King'),
('larva','larva',12,8,4,'boss','Личинка','God\'s larva'),('fistBurn','yog_fists',24,17,0,'boss','Пылающий кулак','Burning fist'),('fistSoil','yog_fists',24,17,10,'boss','Земляной кулак','Soiled fist'),('fistRot','yog_fists',24,17,20,'boss','Гнилой кулак','Rotting fist'),('fistRust','yog_fists',24,17,30,'boss','Ржавый кулак','Rusted fist'),('fistBright','yog_fists',24,17,40,'boss','Светлый кулак','Bright fist'),('fistDark','yog_fists',24,17,50,'boss','Тёмный кулак','Dark fist'),('yog','yog',20,19,0,'boss','Йог-Дзева','Yog-Dzewa'),
('wraith','wraith',14,15,0,'any','Призрак','Wraith'),('piranha','piranha',12,16,4,'any','Пиранья','Giant piranha'),('mimic','mimic',16,16,3,'any','Мимик','Mimic'),('mimicGold','mimic',16,16,19,'any','Золотой мимик','Golden mimic'),('mimicEbony','mimic',16,16,51,'any','Эбеновый мимик','Ebony mimic'),('statue','statue',12,15,0,'any','Живая статуя','Animated statue'),('guardian','statue',12,15,0,'any','Страж-ловушка','Guardian'),('sentry','sentry',8,15,0,'any','Часовой','Sentry'),
('albino','rat',16,15,16,'rare','Крыса-альбинос','Albino rat'),('exile','gnoll',12,15,21,'rare','Гнолл-изгнанник','Gnoll exile'),('hermit','crab',16,16,16,'rare','Рак-отшельник','Hermit crab'),('caustic','slime',14,12,9,'rare','Едкий слизень','Caustic slime'),('bandit','thief',12,13,21,'rare','Безумный бандит','Crazy bandit'),('spectral','necromancer',16,16,16,'rare','Призрачный некромант','Spectral necromancer'),('armBrute','brute',12,16,21,'rare','Бронированный громила','Armored brute'),('dm201','dm200',21,18,12,'rare','DM-201','DM-201'),('elemChaos','elemental',12,14,56,'rare','Элементаль хаоса','Chaos elemental'),('senior','monk',15,14,18,'rare','Старший монах','Senior monk'),('acidic','scorpio',17,17,15,'rare','Едкий скорпион','Acidic scorpio'),('tormented','wraith',14,15,9,'rare','Измученный дух','Tormented spirit'),('phantom','piranha',12,16,25,'rare','Призрачная пиранья','Phantom piranha'),('mimicCrystal','mimic',16,16,35,'rare','Хрустальный мимик','Crystal mimic'),('armStatue','statue',12,15,43,'rare','Бронированная статуя','Armored statue'),
]
C=24
def trim(im):
    bb=im.getbbox(); return im.crop(bb) if bb else im
cols=11; rows=(len(M)+cols-1)//cols
atlas=Image.new('RGBA',(cols*C,rows*C),(0,0,0,0)); meta=[]
for n,(k,sh,fw,fh,fi,reg,ru,en) in enumerate(M):
    f=trim(frame(sh,fw,fh,fi))
    if k=='guardian':
        p=f.load()
        for yy in range(f.height):
            for xx in range(f.width):
                c=p[xx,yy]
                if c[3]: p[xx,yy]=(int(c[0]*.8),int(c[1]*.8),int(c[2]*.8+255*.2),c[3])
    if f.width>C or f.height>C: print('big',k,f.size); f=f.crop(((f.width-C)//2 if f.width>C else 0, max(0,f.height-C), (f.width-C)//2+C if f.width>C else f.width, f.height))
    x=(n%cols)*C+(C-f.width)//2; y=(n//cols)*C+C-f.height-(2 if f.height<=C-2 else 0)  # ноги на 2 px выше низа ячейки
    atlas.alpha_composite(f,(x,y)); meta.append([k,n,reg,ru,en])
atlas.save(O+'bestiary.png'); json.dump(meta,open(O+'bestiary.json','w'),ensure_ascii=False)
big=atlas.resize((atlas.width*4,atlas.height*4),0); bg=Image.new('RGBA',big.size,(40,42,36,255)); bg.alpha_composite(big); bg.save('./out/best.png')
print(len(M), atlas.size)
