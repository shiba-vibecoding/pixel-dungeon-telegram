import {
  F, GATE_CELLS, hasFlag, isFist, type Item, type Level, type Mob, type MobKind, PEDESTALS, type PlantKind, T, THRONE, WIDTH, type World,
} from '@pd/core';
import { lt, plain, terrainText, trapText } from './levelnames';
import { lang, t } from './i18n';
import { artText } from './artifacttext';

/*
 * What the examine tool tells about a cell (Toolbar's info button, Mob.description,
 * Level.tileName and tileDesc): the monster there, or the terrain.
 */

const EN_MOBS: Partial<Record<MobKind, string>> = {
  rat: 'Marsupial rats are aggressive but rather weak denizens of the sewers. They have a nasty bite, but are only life threatening in large numbers.',
  gnoll: 'Gnolls are hyena-like humanoids. They dwell in sewers and dungeons, venturing up to raid the surface from time to time. Gnoll scouts are regular members of their pack, they are not as strong as brutes and not as intelligent as shamans.',
  crab: 'These huge crabs are at the top of the food chain in the sewers. They are extremely fast and their thick carapace can withstand heavy blows.',
  goo: 'Little is known about the Goo. It is quite possible that it is not even a creature, but rather a conglomerate of substances from the sewers that has gained rudiments of free will.',
  ghost: 'The ghost is barely visible. It looks like a shapeless spot of faint light with a sorrowful face.',
  shopkeeper: 'This stout guy looks more appropriate for a trade district in some large city than for a dungeon. His prices explain why he prefers to do business here.',
  wandmaker: 'This old but hale gentleman wears a slightly confused expression. He is protected by a magic shield.',
  skeleton: 'Skeletons are composed of the bones of unlucky adventurers and inhabitants of the prison, animated by emanations of evil magic from the depths below. After they have been damaged enough, skeletons will disintegrate in an explosion of bones. The shrapnel from this explosion is harmful to anything nearby, but armor is very effective at mitigating it.',
  thief: 'Though these inmates roam free of their cells, this place is still their prison. Over time, this place has taken their minds as well as their freedom. Long ago, these crazy thieves and bandits have forgotten who they are and why they steal.\n\nThese enemies are more likely to steal and run than they are to fight. Make sure to keep them in sight, or you might never see your stolen item again.',
  swarm: 'The deadly swarm of flies buzzes angrily. Every non-magical attack will split it into two smaller but equally dangerous swarms.',
  shaman: 'Gnoll shamans are intelligent gnolls who use battle spells to compensate for their lack of might. They have a very respected position in gnoll society, despite their weaker strength.',
  bat: 'These brisk and tenacious inhabitants of the caves are much more dangerous than they seem. They replenish their health with each successful attack, which allows them to defeat much larger opponents.',
  brute: 'Brutes are the largest, strongest, and toughest of all gnolls. When mortally wounded, they go berserk, gaining temporary shielding and a large boost to damage.',
  tengu: 'Tengu are members of the ancient assassins clan, which is also called Tengu. These assassins are noted for their extensive use of shuriken and traps.',
  spinner: 'These greenish furry cave spiders try to avoid direct combat. Instead they prefer to wait in the distance while their victim struggles in their excreted cobweb, slowly dying from their venomous bite. They are capable of shooting their webs great distances, and will try to block whatever path their prey is taking.',
  dm300: 'This machine was created by the Dwarves several centuries ago, for construction and mining and now and then for the defence of the city. Later the Dwarves replaced machines with golems, elementals and even demons, which led their civilisation to its decline.',
  elemental: 'Elementals are chaotic creatures that are often created when powerful occult magic isn\'t properly controlled. Elementals have minimal intelligence, and are usually associated with a particular type of magic.\n\nFire elementals are a common type of elemental which deals damage with fiery magic. They will set their target ablaze with melee attacks, and can occasionally shoot bolts of fire as well.',
  monk: 'These monks are fanatics, who have devoted themselves to protecting their king through physical might. So great is their devotion that they have totally surrendered their minds to their king, and now roam the dwarven city like mindless zombies.\n\nMonks rely solely on the art of hand-to-hand combat, and are able to use their unarmed fists both for offense and defense. When they become focused, monks will parry the next physical attack used against them, even if it was otherwise guaranteed to hit. Monks build focus more quickly while on the move, and more slowly when in direct combat.',
  warlock: 'As the dwarves\' interests shifted from engineering to arcane arts, warlocks came to power in the city. They started with elemental magic, but soon switched to demonology and necromancy. The strongest of these warlocks seized the throne of the dwarven city, and his cohorts were allowed to continue practising their dark magic, so long as they surrendered their free will to him.\n\nThese warlocks possess powerful disruptive magic, and are able to temporarily hinder the upgrade magic applied to your equipment. The more upgraded an item is, the more strongly it will be affected.',
  golem: 'Golems are an attempt to correct the previous flaws in dwarven machinery via the dwarves newfound use of magic. They are much more compact and efficient compared to the DM-300 while still being very deadly.\n\nWhile golems are still too large to fit into passageways, the dwarves have given them new magical abilities to compensate. Golems can teleport themselves between rooms, and teleport enemies to them when they are out of reach.',
  king: 'The last king of dwarves was known for his deep understanding of life and death. He persuaded his court to take part in a ritual that should have granted them eternal youth. In the end he was the only one who got it - and an army of undead as a bonus.',
  undead: 'These undead dwarves, risen by the will of the King of Dwarves, were members of his court. They appear as skeletons with a stunning amount of facial hair.',
  succubus: 'Succubi are shapeshifting demons that manipulate the minds of their prey. This one has taken the form of a pale gothic humanoid, perhaps to attract dwarven warlocks?\n\nSuccubi may temporarily charm their enemy when they attack, making their enemy unable to directly attack them. When succubi attack a charmed enemy, they will steal some of their life essence.',
  eye: 'Evil Eyes are floating balls of pent up demonic energy. While they are capable of melee combat, their true strength comes from their magic.\n\nAfter building energy for a short time an Evil Eye will unleash a devastating beam of energy called the deathgaze. Anything within the Evil Eye\'s sights will take tremendous damage, wise adventurers will run for cover.',
  scorpio: 'These huge arachnid-like demonic creatures avoid close combat, preferring to fire crippling serrated spikes from long distances.',
  yog: 'Yog-Dzewa is an Old God, a powerful entity from the realms of chaos. A century ago, the ancient dwarves barely won the war against its army of demons, but could not kill the god itself. Instead, they imprisoned it in the halls below their city, believing it too weak to rise ever again.',
  mimic: 'Mimics are magical creatures which can take any shape they wish. In dungeons they almost always choose a shape of a treasure chest, in order to lure in unsuspecting adventurers.\n\nMimics have a nasty bite, but often hold more treasure than a regular chest.',
  statue: 'You would think that it\'s just another one of this dungeon\'s inanimate statues, but its red glowing eyes give it away.',
  piranha: 'These carnivorous fish are bred specifically to protect flooded areas. Their bite is deadly, so it\'s best to avoid confronting them directly.',
  imp: 'Imps are lesser demons, notable for neither their strength nor their magic talent, but they are quite smart and sociable. Many imps prefer to live among non-demons.',
  sheep: 'This is a magic sheep. What is so magical about it? You cannot kill it. It will stand there until it magically fades away, chewing cud with a blank stare.',
  blacksmith: 'This troll blacksmith looks like all trolls look: tall and lean, his skin like stone in both colour and texture. He is tinkering with disproportionately small tools.',
  mirror: 'This illusion bears a close resemblance to you, but it is paler and twitches a little.',
  fetidRat: 'Something is clearly wrong with this rat. Its greasy black fur and rotting skin are very different from the healthy rats you\'ve seen previously. Its pale green eyes make it seem especially menacing.\n\nThe rat carries a cloud of horrible stench with it, it\'s overpoweringly strong up close.\n\nDark ooze dribbles from the rat\'s mouth, it eats through the floor but seems to dissolve in water.',
  curse: 'This creature resembles the sad ghost, but it swirls with darkness. Its face bears an expression of despair.',
  ratKing: 'This rat is a little bigger than a regular marsupial rat and it is wearing a tiny crown on its head.',
  wraith: 'A wraith is a vengeful spirit of a sinner, whose grave or tomb was disturbed. Being an ethereal entity, it is very hard to hit with a regular weapon.',
  bee: 'Despite their small size, golden bees tend to protect their home fiercely. This one is very mad, better keep your distance.',
  impShopkeeper: 'Imps are lesser demons, notable for neither their strength nor their magic talent. But they are quite smart and sociable, and many imps prefer to live and do business among non-demons.',
  albino: 'This is a rare breed of marsupial rat, with pure white fur and jagged teeth.',
  snake: 'These oversized serpents are capable of quickly slithering around blows, making them quite hard to hit. Magical attacks or surprise attacks are capable of catching them off-guard however.\n\nYou can perform a surprise attack by attacking while out of the snake\'s vision. One way is to let a snake chase you through a doorway and then strike just after it moves into the door.',
  gnollExile: 'This grey-furred gnoll has a large mark on its shoulder, denoting it as an exile. Gnolls are usually exiled from their society for ignoring orders or breaking laws. Exiles have to be strong and shrewd to survive, this one looks like it knows how to use the spear it\'s holding.',
  gnollTrickster: 'A strange looking creature, even by gnoll standards. It hunches forward with a wicked grin, almost cradling the satchel hanging over its shoulder. Its eyes are wide with a strange mix of fear and excitement.\n\nThere is a large collection of poorly made darts in its satchel, they all seem to be tipped with various harmful substances.',
  hermitCrab: 'For one reason or another, this sewer crab has decided to wear the broken upper part of a barrel on its head! The extra weight has slown it down to regular speed, but has also granted it considerably more defence. You think you can hear something bouncing around inside the barrel though...',
  greatCrab: 'This crab is gigantic, even compared to other sewer crabs. Its blue shell is covered in cracks and barnacles, showing great age. It lumbers around slowly, barely keeping balance with its massive claw.\n\nWhile the crab only has one claw, its size easily compensates. The crab holds the claw in front of any threat, shielding itself behind an impenetrable wall of carapace. However, the crab cannot block attacks it doesn\'t see coming, or attacks from multiple enemies at once.',
  slime: 'Slimes are strange, slightly magical creatures with a rubbery outer body and a liquid core. The city sewers provide them with an ample supply of water and nutrients.\n\nBecause of their elastic outer membrane, it is difficult to deal more than 6 damage to slimes from any one attack.',
  causticSlime: 'This slime seems to have been tainted by the dark magic emanating from below. It has lost its usual green color, and drips with caustic ooze.',
  necroSkeleton: 'This skeleton has been summoned by a necromancer. It behaves just like a regular skeleton, and will die when the necromancer which summoned it is slain.',
  bandit: 'An elite thief, distinguished by their more opulent purple robe. Despite their greater skill, they\'ve become just as mindless as regular thieves.\n\nIn addition to stealing from you, crazed bandits will briefly blind, cripple, and poison you! They\'re much more likely to be carrying extra loot than a regular thief though.',
  dm100: 'The DM-100 is an early model of dwarven \'defense machine\' which was designed to protect dwarven miners in the caves below this prison. Their electrical shocks proved too weak however, and so they were gifted to the human city above. They went unused for years and eventually found their way to the prison, where the warden initially deemed them too cruel to use. However, as the prisoners became more unruly they became a necessity.',
  guard: 'Once keepers of the prison, these guards have long since become no different than the inmates. They shamble like zombies, brainlessly roaming through the halls in search of anything out of place, like you!\n\nThey carry chains around their hip, possibly used to pull in enemies to close range.',
  necromancer: 'These apprentice dark mages have flocked to the prison, as it is the perfect place to practise their evil craft.\n\nNecromancers will summon and empower skeletons to fight for them. Killing the necromancer will also kill the skeleton it summons.',
  spectralNecromancer: 'While Skeletons are a necromancer’s bread and butter, some prefer to look into other less corporeal minions. Spectral necromancers have chosen wraiths as their minion of choice!\n\nIndividual wraiths aren\'t as strong as skeletons, but these necromancers aren\'t afraid to summon a bunch of them!',
  tormentedSpirit: 'Tormented spirits are otherwise good-natured spirits that have been afflicted by a curse. So long as they are cursed they will attack just like a wraith, and are more powerful as well!\n\nIt may be possible to cleanse the curse by using the right item while next to the spirit. If the curse is lifted the spirit will surely be grateful...',
  shielded: 'The most senior gnoll brutes often wear powerful armor to show their status. The armor makes these brutes much more resilient to physical damage, and their greater discipline means they can rage for much longer before succumbing to their wounds.',
  blueShaman: 'Gnoll shamans are intelligent gnolls who use battle spells to compensate for their lack of might. They have a very respected position in gnoll society, despite their weaker strength.',
  purpleShaman: 'Gnoll shamans are intelligent gnolls who use battle spells to compensate for their lack of might. They have a very respected position in gnoll society, despite their weaker strength.',
  dm200: 'The DM-200 is the second generation of dwarven \'defense machine\', which was designed to protect dwarven miners in the caves and city below. They are much larger and bulkier than their predecessors, and attack with devastating hydraulic fists.\n\nTheir increased size is also their primary weakness, as they are unable to fit into the narrow tunnels and doorways of the dungeon. The dwarves were able to compensate for the DM-200\'s lack of mobility by allowing them to vent their toxic exhaust fumes at distant enemies, or enemies they cannot reach.',
  dm201: 'The dwarves briefly experimented with more heavily emphasizing the DM-200\'s lack of mobility and created some DM models that are entirely stationary. The DM-201 is a retrofitted DM-200 which acts as a sentry turret that has no movement ability. In exchange for the lack of mobility, DM-201s have significantly more durability and attacking power.\n\nAs DM-201s have no engine to vent exhaust from, the dwarves instead outfitted them with corrosive gas grenades! DM-201s are careful with these grenades however, and will only lob them when attacked from a distance.',
  ghoul: 'As dwarven society slowly began to collapse, and the current king of the dwarves seized absolute power, those who were weak or who resisted him were not treated well. As the king grew more adept at wielding dark magic, he bent these dwarves to his will, and now they make up the footsoldiers of his army.\n\nGhouls are not especially strong on their own, but always travel in groups and are much harder to kill in large numbers. When a ghoul is defeated, it will rise again after a few turns as long as another ghoul is nearby.',
  frostElemental: 'Elementals are chaotic creatures that are often created when powerful occult magic isn\'t properly controlled. Elementals have minimal intelligence, and are usually associated with a particular type of magic.\n\nFrost elementals are a common type of elemental which weakens enemies with chilling magic. They will chill their target with melee and occasional ranged attacks. Their magic is much more effective in water.',
  shockElemental: 'Elementals are chaotic creatures that are often created when powerful occult magic isn\'t properly controlled. Elementals have minimal intelligence, and are usually associated with a particular type of magic.\n\nShock elementals are a less common type of elemental which disrupts its enemies with electricity and flashes of light. In melee they will arc electricity to nearby enemies, and deal bonus damage to their primary target if they are in water. They will also occasionally focus a ranged blast of light at their target, temporarily blinding them.',
  chaosElemental: 'Elementals are chaotic creatures that are often created when powerful occult magic isn\'t properly controlled. Elementals have minimal intelligence, and are usually associated with a particular type of magic.\n\nChaos elementals are rare and dangerous elementals which haven\'t stabilized to a particular element. They will unleash wild unpredictable magic when they attack.',
  senior: 'These monks are fanatics, who have devoted themselves to protecting their king through physical might. So great is their devotion that they have totally surrendered their minds to their king, and now roam the dwarven city like mindless zombies.\n\nThis monk has mastered the art of hand-to-hand combat, and is able to gain focus while moving much more quickly than regular monks. When they become focused, monks will parry the next physical attack used against them, even if it was otherwise guaranteed to hit. Monks build focus more quickly while on the move, and more slowly when in direct combat.',
  acidic: 'These huge arachnid-like demonic creatures avoid close combat, preferring to fire crippling serrated spikes from long distances. This one appears to be dripping with corrosive ooze.',
  ripper: 'These horrific creatures are the result of the many dwarven corpses in this region being put to use by demonic forces. Rippers are emaciated ghoulish creatures that resemble dwarves, but with broken bodies and long sharp claws made of bone.\n\nRipper demons are not particularly durable, but they are agile and dangerous. They are capable of leaping great distances to quickly reach targets before goring them with their claws.',
  spawner: 'This twisting amalgam of dwarven flesh is responsible for creating ripper demons from the dwarves that have died in this region. Clearly the demons see no issue with using every resource they can against their enemies.\n\nWhile visually terrifying, demon spawners have no means of moving or directly defending themselves. Their considerable mass makes them hard to kill quickly however, and they will spawn ripper demons more quickly when they are under threat.\n\nDemon spawners seem to be connected to some central source of demonic power. Killing them may weaken it.',
  goldenMimic: 'Mimics are magical creatures which can take any shape they wish. In dungeons they almost always choose a shape of a treasure chest, in order to lure in unsuspecting adventurers.\n\nGolden mimics are tougher mimics which try to attract the strongest adventurers. They have better loot, but are also much stronger than regular mimics.',
  crystalMimic: 'Mimics are magical creatures which can take any shape they wish. In dungeons they almost always choose a shape of a treasure chest, in order to lure in unsuspecting adventurers.\n\nCrystal mimics are trickier than their regular cousins, and prefer to avoid conflict while stealing loot. They will attempt to sprint away once discovered, and have the ability to reposition enemies when they attack.',
  ebonyMimic: 'Mimics are magical creatures which can take any shape they wish. In dungeons they almost always choose a shape of a treasure chest, in order to lure in unsuspecting adventurers.\n\nEbony mimics are stealthy mimics with the ability to make themselves almost invisible. They lurk on things that adventurers are likely to interact with, but do contain loot of their own as well. They aren\'t any tougher than a regular mimic once discovered, but their surprise bite is devastating.',
  armoredStatue: 'You would think that it\'s just another one of this dungeon\'s inanimate statues, but its red glowing eyes give it away.\n\nIt seems to be in great condition because of the armor it\'s wearing, it might be very hard to kill.',
  phantomPiranha: 'Phantom piranhas are a rare breed of piranha with magical abilities and eerie translucent bodies. They are capable of teleporting as they are being attacked, either to escape or to quickly get close to their enemy!\n\nWhile they are annoying to fight, their meat is prized for its magical properties.',
};

const RU_MOBS: Partial<Record<MobKind, string>> = {
  rat: 'Сумчатые крысы - агрессивные, но слабые обитатели канализации. У них противный укус, но опасны они только в больших количествах.',
  gnoll: 'Гноллы - гиеноподобные гуманоиды. Они обитают в канализации и подземельях, периодически собираясь для рейдов на поверхность. Гноллы-разведчики - обычные члены стаи, не такие сильные, как громилы, и не такие умные, как шаманы.',
  crab: 'Эти крупные крабы находятся на вершине пищевой цепи в канализации. Они очень быстрые, а их толстый панцирь позволяет им пережить мощные удары.',
  goo: 'О Жиже известно немного. Возможно, это вовсе не существо, а сгусток веществ из канализации, обретший зачатки свободной воли.',
  ghost: 'Привидение едва видно: бесформенное пятно тусклого света с печальным лицом.',
  shopkeeper: 'Этот крепыш больше подошёл бы торговому кварталу большого города, чем подземелью. Его цены объясняют, почему он предпочитает торговать здесь.',
  wandmaker: 'У этого старого, но бодрого джентльмена немного растерянный вид. Его защищает магический щит.',
  skeleton: 'Скелеты состоят из костей неудачливых путешественников и узников тюрьмы, оживленные влиянием темной магии из глубин. Получив достаточное количество урона, они взрываются костяными осколками. Осколки опасны для всего поблизости, но броня весьма эффективна в снижении урона от осколков.',
  thief: 'Хотя заключенные свободно ходят вне камер, это место - всё равно их тюрьма. Со временем, помимо свободы, оно забрало и их рассудок. Эти воры и бандиты уже давно забыли, кто они и что они здесь делают.\n\nЭти подлецы предпочитают что-то украсть и убежать, чем сражаться до смерти. Не упускайте их из виду, иначе вы можете никогда больше не увидеть украденное.',
  swarm: 'Смертоносный рой жужжащих мух. Любая немагическая атака разделит его на два не менее опасных роя поменьше.',
  shaman: 'Гнолл-шаманы - умные гноллы, которые используют боевую магию, компенсируя таким образом недостаток физической силы. В обществе гноллов их почитают несмотря на их выраженную слабость.',
  bat: 'Эти шустрые и выносливые обитатели пещер куда более опасны, чем кажется. Они восстанавливают свое здоровье с каждой успешной атакой, что позволяет им преодолевать гораздо более крупных противников.',
  brute: 'Громилы - самые крупные, сильные и крепкие из гноллов. Получив смертельное ранение, они впадают в неистовство и получают временный щит, и наносят больше урона своим врагам.',
  tengu: 'Тенгу — члены древнего клана убийц, который тоже зовётся Тенгу. Эти убийцы славятся тем, что охотно пускают в ход сюрикены и ловушки.',
  spinner: 'Эти зеленые и мохнатые пещерные пауки избегают прямой схватки, оставаясь на расстоянии, пока запутавшаяся в их паутине жертва медленно умирает от ядовитого укуса. Они способны выстреливать паутину на большое расстояние и будут пытаться блокировать путь, по которому двигается их жертва.',
  dm300: 'Эту машину гномы построили несколько веков назад — для строительства и добычи руды, а иногда и для обороны города. Позже гномы заменили машины големами, элементалями и даже демонами, что и привело их цивилизацию к упадку.',
  elemental: 'Элементали - хаотичные существа, которых часто производят на свет при плохо контролируемых ритуалах. У элементалей имеется минимальный разум, и обычно их связывают с определенным видом магии.\n\nОгненные элементали - часто встречаемый вид, они причиняют урон огненной магией. Они приводят к возгоранию своей цели, которую они атакуют в ближнем бою, и порой они также могут выстрелить огненным зарядом.',
  monk: 'Эти монахи - фанатики, посвятившие себя защите своего короля физической силой. Их преданность настолько велика, что они полностью предали свое сознание своему королю, и теперь они бродят по городу дворфов как безмозглые зомби.\n\nМонахи полагаются исключительно на рукопашный бой, они используют свои невооруженные кулаки как для атаки, так и для защиты. Когда они сфокусируются, они смогут отразить следующую физическую атаку, направленную против них, даже если та в обычных условиях обязательно попала бы. Монахи быстрее фокусируются в движении и медленнее в прямом бою.',
  warlock: 'Когда интерес дворфов перешел от инженерии к чародейству, чернокнижники обрели власть в городе. Они начинали со стихийной магии, но вскоре перешли к демонологии и некромантии. Самый сильный из этих чернокнижников захватил престол в городе дворфов, и его пособникам позволили продолжать занятия темной магией, пока они покоряют ему свою свободную волю.\n\nЭти чернокнижники обладают сильной разрушительной магией, они способны временно блокировать магию улучшения, примененную в отношении ваших предметов. Чем более предмет улучшен, тем сильнее на нем скажется это влияние.',
  golem: 'Големы - попытка исправить изъяны дворфского оборудования путем новооткрытого использования магии. Они намного более компактны и эффективны по сравнению с DM-300, и, в то же время, все еще весьма смертельны.\n\nГолемы, все же, слишком велики, чтобы поместиться в переходы, но дворфы компенсировали это, наделив их новыми магиескими способностями. Големы способны телепортироваться из одного помещения в другое, а также могут телепортировать врагов к себе, если те находятся вне зоны досягаемости.',
  king: 'Последний король гномов славился глубоким пониманием жизни и смерти. Он убедил свой двор принять участие в ритуале, который должен был даровать им вечную молодость. В итоге получил её только он сам — и армию нежити в придачу.',
  undead: 'Эти мёртвые гномы, поднятые волей Короля гномов, были членами его двора. Это скелеты с поразительно пышными бородами.',
  succubus: 'Суккубы - демоны-оборотни, манипулирующие сознание своей жертвы. Этот принял образ бледного готичного гуманоида, возможно, чтобы привлечь дворфов-чернокнижников?\n\nСуккубы могут временно очаровать противника при атаке, лишая противника способности нанести прямую ответную атаку. Когда суккубы атакуют очарованного врага, они крадут немного его жизненной силы.',
  eye: 'Злобоглазы похожи на парящие в воздухе шары, переполненные демонической энергией. Они не слишком опасны в ближнем бою, их истинная сила заключается в их магических способностях.\n\nНакопив достаточно энергии, злобоглазы способны испустить луч разрушительной силы, называемый смертоносным взглядом. Этот луч нанесет огромный урон всему, что не успеет спрятаться от него.',
  scorpio: 'Эти огромные, паукообразные демонические существа избегают ближний бой, предпочитая стрелять издалека калечащими, зазубренными шипами.',
  yog: 'Йог-Дзева — Древний бог, могущественная сущность из царства хаоса. Век назад гномы едва выиграли войну с его армией демонов, но убить самого бога не смогли. Вместо этого они заточили его в чертогах под своим городом, веря, что он слишком слаб, чтобы когда-нибудь подняться.',
  mimic: 'Мимики - волшебные существа, способные принимать любой облик. В подземельях они почти всегда принимают облик сундука, чтобы заманить ничего не подозревающих путешественников.\n\nМимики очень больно кусаются, но зато у них, обычно, больше сокровищ чем в нормальных сундуках.',
  statue: 'На первый взгляд это всего лишь одна из неподвижных статуй этого подземелья, но её выдают красные светящиеся глаза.',
  piranha: 'Этих хищный рыб специально развели для защиты затопленных мест. Их укусы опасны, так что лучше избегать прямого столкновения с ними.',
  imp: 'Бесы — младшие демоны, не отличающиеся ни силой, ни магическим даром, зато они умны и общительны. Многие бесы предпочитают жить среди не-демонов.',
  sheep: 'Это волшебная овца. Что в ней волшебного? Её нельзя убить. Она будет стоять здесь, пока волшебным образом не исчезнет, и жевать жвачку с отсутствующим видом.',
  blacksmith: 'Этот тролль-кузнец выглядит как все тролли: высокий и худой, с кожей, похожей на камень и цветом, и на ощупь. Он возится с несоразмерно мелкими инструментами.',
  mirror: 'Эта иллюзия очень похожа на вас, только бледнее и слегка подрагивает.',
  fetidRat: 'Что-то определенно не так с этой крысой. Её засаленный черный мех и гниющая шкура совсем не похожи на здоровых крыс, которых вы видели ранее. А тусклые зелёные глаза придают ей совсем уж пугающий вид.\n\nЗа крысой следует жуткое облако вони, невероятно сильное вблизи.\n\nТемная слизь капает изо рта крысы, разъедая пол, но растворяясь в воде.',
  curse: 'Это существо напоминает печальное привидение, но клубится тьмой. На его лице застыло отчаяние.',
  ratKing: 'Эта крыса чуть крупнее обычной сумчатой, и на голове у неё крошечная корона.',
  wraith: 'Призрак - это мстительный дух грешника, чья могила была потревожена. Будучи нематериальной сущностью, призрак легко избегает атаки простым оружием.',
  bee: 'Несмотря на небольшой размер, золотые пчелы будут яростно защищать свой дом. Эта совсем с ума сошла, лучше держаться подальше.',
  impShopkeeper: 'Бесы — младшие демоны, не отличающиеся ни силой, ни магическим даром. Зато они умны и общительны, и многие бесы предпочитают жить и торговать среди не-демонов.',
  albino: 'Это редкая разновидность сумчатой крысы с абсолютно белым мехом и зазубренными зубами.',
  snake: 'Эти огромные змеи способны легко ускользать от ударов, из-за чего по ним сложно попасть. Однако, магические или внезапные атаки застанут их врасплох.\n\nВы можете совершить внезапную атаку, пока змея вас ещё не заметила. Попробуйте заманить ее за собой в дверь и затем атаковать в момент, когда змея окажется в дверном проёме.',
  gnollExile: 'Этот гнолл с серой шерстью имеет большое клеймо на плече, что показывает его изгнание. Гноллов обычно изгоняют из своего общества за неповиновение приказам или нарушение законов. Изгои должны быть сильны и смекалисты, чтобы выжить. Этот, похоже, знает, как использовать копьё, которое он держит.',
  gnollTrickster: 'Даже на фоне присущей всем гноллам странности, этот кажется особенно странным. Чуть склонившись вперед с дикой ухмылкой, он едва ли не баюкает перекинутую через плечо сумку. Его глаза полны странной смеси страха и наслаждения.\n\nВ его сумке внушительная коллекция самодельных дротиков, явно покрытых какой-то гадостью.',
  hermitCrab: 'По какой-то причине этот сточный краб решил носить сломанную верхушку бочки у себя на голове! Дополнительная нагрузка замедлила его до обычной скорости, но также и добавила заметную защиту. Вам слышится, как что-то гремит в бочке...',
  greatCrab: 'Этот краб огромен, даже по сравнению с другими сточными крабами. Его синий панцирь покрыт трещинами и прилипалами, выдавая его древний возраст. Он медленно шатается, еле удерживая равновесие со своей гигантской клешнёй.\n\nХоть у краба всего одна клешня, её размер это с лихвой компенсирует. Краб держит клешню перед любой угрозой, защищая себя от атак непробиваемым щитом. Однако, краб не может блокировать атаки, которые он не видит или атаки сразу от нескольких врагов.',
  slime: 'Слизни - странные, отчасти магические существа. Они эластичные снаружи и жидкие внутри. Канализация города обеспечивает их водой и питательными веществами.\n\nБлагодаря их растяжимой анатомии, крайне сложно нанести слизню больше чем 6 единиц урона за один удар.',
  causticSlime: 'Этот слизень, должно быть, был заражён тёмной магией, которая излучается из глубин. Он потерял свой обычный зелёный цвет и с него капает едкая слизь.',
  necroSkeleton: 'Этот скелет был призван некромантом. Он ведет себя как обычный скелет и умрет, когда некромант, вызвавший его, будет убит.',
  bandit: 'Элитный вор, отличающийся более роскошной пурпурной мантией. Несмотря на более высокое мастерство, они стали такими же безумными, как обычные воры.\n\nПомимо того, что они крадут у вас вещи, безумные бандиты временно ослепляют, калечат и отравляют вас! Однако они гораздо чаще носят с собой дополнительные сокровища, чем обычные воры.',
  dm100: 'DM-100 - ранняя модель дворфовского \'оборонного оборудования\', было создано для защиты шахтеров-дворфов в пещерах под этой тюрьмой. Удары электрическим током этих устройств, однако, оказались слишком слабыми, так что их подарили человеческому городу выше. Но в городе им не нашли применение и через несколько лет их отправили в тюрьму, где стражи изначально считали, что применять их - слишком жестоко. Но заключенные становились все менее управляемыми, так что они стали необходимы.',
  guard: 'Когда-то смотрители тюрьмы, эти стражи давно стали такими же, как заключенные. Как зомби, они бессмысленно бродят по коридорам в поисках того, чего здесь не должно быть - например, вас!\n\nОни носят цепь на поясе, возможно, чтобы притягивать к себе врагов.',
  necromancer: 'Эти начинающие тёмные маги стеклись в тюрьму, так как это - лучшее место для практикования их тёмного ремесла.\n\nНекроманты будут призывать и улучшать скелетов, которые дерутся на его стороне. Эти скелеты будут существовать только пока жив поднявший их некромант.',
  spectralNecromancer: 'В то время как скелеты - основа некромантии, некоторые предпочитают использовать других, менее телесных приспешников. Заклинатели призраков выбрали призраков в качестве своих фаворитов!\n\nОтдельные призраки не так сильны, как скелеты, но эти некроманты не боятся вызывать их целую кучу!',
  tormentedSpirit: 'Измученные призраки - это добрые духи, которые страдают от проклятия. Они будут атаковать как обычные призраки, но сильнее!\n\nВозможно, получится снять проклятие, использовав правильный предмет рядом с призраком? Если проклятие отступит, то дух будет крайне благодарен...',
  shielded: 'Самые влиятельные гноллы-громилы часто носят мощную броню, чтобы демонстрировать свой статус. Благодаря ей они гораздо более выносливы по отношению к физическому урону, а их более высокий уровень дисциплины означает, что они могут пребывать в ярости гораздо дольше, прежде чем скончаться от своих ран.',
  blueShaman: 'Гнолл-шаманы - умные гноллы, которые используют боевую магию, компенсируя таким образом недостаток физической силы. В обществе гноллов их почитают несмотря на их выраженную слабость.',
  purpleShaman: 'Гнолл-шаманы - умные гноллы, которые используют боевую магию, компенсируя таким образом недостаток физической силы. В обществе гноллов их почитают несмотря на их выраженную слабость.',
  dm200: 'DM-200 - второе поколение \'оборонного оборудования\' дворфов, создан для защиты дворфовских шахтеров в пещерах и городе, который находится под ними. Оно гораздо больше и более громоздко чем предшественники и атакует сокрушительными гидравлическими кулаками.\n\nБолее крупный размер DM-200 - их главная уязвимость, т.к. они не помещаются в узкие тоннели и дверные проемы подземелий. Но дворфы смогли компенсировать неповоротливость DM-200 тем, что эти машины могут направлять свои токсичные выхлопы на отдаленных врагов или врагов, которых им не достать.',
  dm201: 'Дворфы какое-то время экспериментировали и далее развивали модели с низкой мобильностью, как у DM-200, и создали несколько моделей DM, которые были полностью стационарны. DM-201 - укомплектованный DM-200, служащий сторожевой башней без возможности передвижения. Компенсируя невозможностью передвигаться, у DM-201 значительно повышена выносливость и мощность атаки.\n\nТак как у DM-201 нет двигателя, из которого выходили бы выхлопные газы, дворфы вместо этого снабдили эту модель гранатами с разъедающим газом. DM-201, однако, очень осторожно пользуется этими гранатами и стреляет ими только в том случае, если его атакуют издалека.',
  ghoul: 'Когда дворфское общество начало постепенно распадаться, а нынешний король дворфов захватил абсолютную власть, с теми, кто были слабы или сопротивлялись ему, обращались не особо ласково. Когда король преуспел в искусстве темной магии, они подчинил этих дворфов своей воле, а теперь они стали пехотинцами его армии.\n\nВурдалаки, сами по себе, не особо сильны, но они всегда бродят группами и их непросто убить, когда их много. Когда вурдалак побежден, через несколько ходов он поднимется вновь, если вблизи есть еще хотя бы один вурдалак.',
  frostElemental: 'Элементали - хаотичные существа, которых часто производят на свет при плохо контролируемых ритуалах. У элементалей имеется минимальный разум, и обычно их связывают с определенным видом магии.\n\nМорозные элементали - часто встречаемый вид, они ослабляют своих противников замораживающей магией. Они замораживают свою цель в ближнем бою, и, порой, атаками издалека. Их магия намного эффективнее в воде.',
  shockElemental: 'Элементали - хаотичные существа, которых часто производят на свет при плохо контролируемых ритуалах. У элементалей имеется минимальный разум, и обычно их связывают с определенным видом магии.\n\nЭлектрический элементаль - нечасто встречаемый вид, они разрывают своих противников электрическими ударами и вспышками света. В ближнем бою от них исходят электрические удары по находящимся близко врагам, и дополнительный урон причиняется их главной цели, если та находится в воде. Они также способны время от времени издалека направлять вспышку света на свою цель, которая тогда на время слепнет.',
  chaosElemental: 'Элементали - хаотичные существа, которых часто производят на свет при плохо контролируемых ритуалах. У элементалей имеется минимальный разум, и обычно их связывают с определенным видом магии.\n\nЭлементали хаоса - редкий и опасный вид, они не стабилизировались в определенном элементе. При атаке они разражаются дикой и непредсказуемой магией.',
  senior: 'Эти монахи - фанатики, посвятившие себя защите своего короля физической силой. Их преданность настолько велика, что они полностью предали свое сознание своему королю, и теперь они бродят по городу дворфов как безмозглые зомби.\n\nЭтот монах полностью освоил искусство рукопашного боя и может сфокусироваться в движении гораздо быстрее, чем обычные монахи. Как только он сфокусируется, он отразит следующую физическую атаку, направленную против него, даже, если та в обычных условиях обязательно попала бы. Монахи быстрее фокусируются в движении и медленнее в прямом бою.',
  acidic: 'Эти огромные, паукообразные демонические существа избегают ближний бой, и вместо этого предпочитают стрелять издалека зазубренными шипами. А с этого прямо капает едкая кислота.',
  ripper: 'Эти страшные существа - то, для чего демонические силы употребили множество трупов дворфов в этом регионе. Потрошители - чахнущие существа-вурдалаки, похожие на дворфов, но с изломленными телами и длинными, острыми клешнями, сделанными из кости.\n\nДемоны-потрошители не особо выносливы, но они быстры и опасны. Они способны прыгать на длинное расстояние, чтобы быстро добраться до своей цели перед тем, как растерзать ее своими клешнями.',
  spawner: 'Этот вихрь сплавов из плоти дворфов производит демонов-потрошителей из частей дворфовких тел. Очевидно, демоны не брезгают использованием любого подручного материала против своих врагов.\n\nИмея ужасающий вид, эти производители демонов, с другой стороны, не имеют средств для передвижения или для прямой обороны. Все же, их внушительная масса препятствует их быстрому уничтожению, а при опасности они будут быстрее производить демонов-потрошителей.\n\nРассадники демонов, похоже, связаны с каким-то центральным источником демонической силы. Их уничтожение может привести к его ослабеванию.',
  goldenMimic: 'Мимики - волшебные существа, способные принимать любой облик. В подземельях они почти всегда принимают облик сундука, чтобы заманить ничего не подозревающих путешественников.\n\nЗолотые мимики - более сильные мимики, которые стараются привлечь самых сильных путешественников. У них бывают сокровища получше, но они намного сильнее обычных мимиков.',
  crystalMimic: 'Мимики - волшебные существа, способные принимать любой облик. В подземельях они почти всегда принимают облик сундука, чтобы заманить ничего не подозревающих путешественников.\n\nХрустальные мимики - сложнее своих обычных собратьев, они стараются избегать конфликтов, но крадут сокровища. Когда их обнаруживают, они пытаются скрыться, и, кроме того, они способны сдвигать врагов с места, когда они атакуют.',
  ebonyMimic: 'Мимики - волшебные существа, способные принимать любой облик. В подземельях они почти всегда принимают облик сундука, чтобы заманить ничего не подозревающих путешественников.\n\nЭбонитовые мимики - необычайно скрытные мимики, которые способны становиться почти невидимыми. Они обычно прячутся в вещах, которые могут подобрать путешественники, но при этом содержат и свои сокровища. Однако, они не такие сильные как обычные мимики, но их неожиданный укус сокрушителен.',
  armoredStatue: 'На первый взгляд это всего лишь одна из неподвижных статуй этого подземелья, но ее выдают красные светящиеся глаза.\n\nПохоже, она в прекрасной форме, судя по броне, которую она носит, и, вероятно, будет чрезвычайно трудно ее убить.',
  phantomPiranha: 'Призрачная пиранья - редкая порода пираний с магическими способностями и жуткими полупрозрачными телами. В случае опасности они способны телепортироваться, чтобы убежать или быстро сблизиться со своим врагом!\n\nХоть драться с ними неприятно, мясо призрачных пираний ценится за волшебные свойства.',
};

/** Rare variants and a boss's parts are described as what they are a version or part of. */
const SAME_AS: Partial<Record<MobKind, MobKind>> = {
  larva: 'yog', rottingFist: 'yog', burningFist: 'yog',
};

/** What Shattered's Mob.description and info add (Messages of each kind and of ChampionEnemy). */
const MOB_EXTRAS = {
  en: {
    spell: { shaman: 'This shaman is wearing a red mask, and will use magic that temporarily weakens your attacking power.', blueShaman: 'This shaman is wearing a blue mask, and will use magic that temporarily increases the damage you take.', purpleShaman: 'This shaman is wearing a purple mask, and will use magic that temporarily reduces your accuracy and evasion.' },
    exilePassive: 'The gnoll exile isn\'t moving to attack. It doesn\'t seem as aggressive as the other gnolls here, and probably doesn\'t think that fighting you is worth it. You could just let it pass, but it has a backpack that might be full of useful items...',
    exileAggro: 'The gnoll exile looks around angrily. It seems something has made it decide to fight after all. Watch out for that spear!',
    statueWeapon: (weapon: string) => `While the statue itself is made of stone, the ${weapon} it's wielding looks real.`,
    statueGear: (weapon: string, armor: string) => `While the statue itself is made of stone, the ${weapon} and ${armor} it's wielding look real.`,
    carries: (item: string) => `The thief is carrying a ${item}. Stolen obviously.`,
    ebonyName: 'suspicious outline',
    ebonyDesc: 'There seems to be something here, but it\'s almost totally transparent.',
    focus: 'focused',
    focusDesc: 'This monk is perfectly honed in on their target, and seem to be anticipating their moves before they make them.\n\nWhile focused, the next physical attack made against this character is guaranteed to miss, no matter what circumstances there are. Parrying this attack will spend the monk\'s focus, and they will need to build it up again to parry another attack. Monks build focus more quickly while they are moving.',
    rage: 'brute rage',
    rageDesc: (shield: number) => `This gnoll brute is dying, but wants to take you with it!\n\nThe brute will die when its shielding wears off, either due to time or if it is damaged. In the meantime, it will deal hugely increased damage, so watch out!\n\nShield remaining: ${shield}.`,
    champions: {
      blazing: ['blazing champion', 'Blazing champions deal 25% more melee damage, ignite enemies they attack, are immune to fire, and spread fire around them as they die. They can\'t spread fire onto water however.'],
      projecting: ['projecting champion', 'Projecting champions deal 25% more melee damage and have +3 attack range.'],
      antiMagic: ['antimagic champion', 'Antimagic champions take 50% less damage and are completely immune to magical effects.'],
      giant: ['giant champion', 'Giant champions take 80% less damage and have +1 attack range, but cannot move through enclosed spaces.'],
      blessed: ['blessed champion', 'Blessed champions have 4x accuracy and evasion.'],
    },
    growing: 'growing champion',
    growingDesc: (boost: number, reduction: number) => `Growing champions gain a steadily increasing bonus to accuracy, evasion, physical damage, and a reduction to damage taken.\n\nCurrent acc/eva/dmg boost: ${boost}%\nCurrent damage reduction: ${reduction}%`,
  },
  ru: {
    spell: { shaman: 'Этот шаман надел красную маску и использует магию, которая временно ослабит вашу силу атаки.', blueShaman: 'Этот шаман надел синюю маску и использует магию, которая временно увеличит наносимый вам урон.', purpleShaman: 'Этот шаман надел багряную маску и использует магию, которая временно снизит вашу меткость и способность уклонения.' },
    exilePassive: 'Гнолл-изгой не спешит атаковать. Он не выглядит таким же агрессивным, как остальные гноллы здесь, и скорее всего считает, что нападать на вас не стоит того. Вы можете просто дать ему пройти, но у него есть рюкзак, который может быть полон полезных вещей.',
    exileAggro: 'Гнолл-изгой гневно озирается по сторонам. Похоже, что-то всё же заставило его сражаться. Берегитесь его копья!',
    statueWeapon: (weapon: string) => `Хотя сама статуя сделана из камня, но ${weapon} в её руках выглядит настоящим.`,
    statueGear: (weapon: string, armor: string) => `Хотя сама статуя сделана из камня, но ${weapon} и ${armor} в её руках выглядят настоящими.`,
    carries: (item: string) => `Вор несёт ${item}. Очевидно, украл где-то.`,
    ebonyName: 'подозрительное очертание',
    ebonyDesc: 'Похоже, здесь что-то кроется, но оно почти полностью прозрачно.',
    focus: 'сфокусирован',
    focusDesc: 'Этот монах отлично изучил свою цель и, кажется, предугадывает движения врага прежде, чем он их совершит.\n\nПока он сфокусирован, следующая физическая атака, против этого персонажа гарантированно промахнется, независимо от обстоятельств. Парирование этой атаки потратит фокус монаха, и ему нужно будет снова набрать его, чтобы парировать еще одну атаку. Монахи быстрее фокусируются во время движения.',
    rage: 'ярость громилы',
    rageDesc: (shield: number) => `Этот гнолл-громила умирает, но хочет забрать вас с собой!\n\nЭтот гнолл умрет, когда закончится действие его щита, либо по истечении времени, либо от нанесенного урона. До этого он наносит гораздо более сильный урон, так что будьте бдительны!\n\nХодов со щитом осталось: ${shield}.`,
    champions: {
      blazing: ['Пылающий чемпион', 'Пылающие чемпионы наносят на 25% больше урона в ближнем бою, поджигают при атаке, неуязвимы к огню и поджигают местность вокруг себя после смерти. Однако они не могут распространять огонь, где есть вода.'],
      projecting: ['Проецирующий чемпион', 'Проецирующие чемпионы наносят на 25% больше урона в ближнем бою и имеют увеличенный на 3 радиус атаки.'],
      antiMagic: ['Антимагический чемпион', 'Антимагические чемпионы получают на 50% меньше урона и совершенно неуязвимы к магии.'],
      giant: ['Гигантский чемпион', 'Гигантские чемпионы получают на 80% меньше урона и увеличенный на 1 радиус атаки, но не могут проходить в узкие пространства.'],
      blessed: ['благословенный чемпион', 'Благословенные чемпионы имеют 4-кратную меткость и уклонение.'],
    },
    growing: 'Растущий чемпион',
    growingDesc: (boost: number, reduction: number) => `Растущие чемпионы получают непрерывно возрастающий бонус меткости, уклонения, физической атаки и сопротивления урону.\n\nТекущий бонус метк/укл/атк: ${boost}%\nТекущее сопротивление урону: ${reduction}%`,
  },
};

/** The name a creature goes by: a ward's by its tier (Ward.name); a hidden ebony mimic is only a suspicious outline. */
export function mobName(mob: Mob, name: string = t.mobs[mob.kind]): string {
  if (mob.kind === 'ward') return t.wardNames[(mob.ward?.tier ?? 1) - 1] ?? t.mobs.ward;
  return mob.kind === 'ebonyMimic' && mob.hidden ? MOB_EXTRAS[lang === 'ru' ? 'ru' : 'en'].ebonyName : name;
}

/**
 * Mob.description and Mob.info: what the monster is, what more its kind says (a shaman's mask, a gnoll exile's mood,
 * a statue's arms, a thief's loot, a monk's focus, a brute's rage), and what champion it is.
 */
/** Shattered's own descriptions (Mob.description) of the wandmaker's quest's characters. */
const WANDMAKER_MOB_TEXTS: Partial<Record<MobKind, readonly string[]>> = {
  wandmaker: ['actors.mobs.npcs.wandmaker.desc'],
  rotHeart: ['actors.mobs.rotheart.desc'],
  rotLasher: ['actors.mobs.rotlasher.desc'],
  newbornElemental: ['actors.mobs.elemental$newbornfireelemental.desc', 'actors.mobs.elemental$newbornfireelemental.desc_boss'],
};

export function mobDescription(mob: Mob, nameOf: (item: Item) => string = (item) => item.kind, now = 0): string[] {
  const wandmakerKeys = WANDMAKER_MOB_TEXTS[mob.kind];
  if (wandmakerKeys) return wandmakerKeys.map((key) => plain(lt(key)));
  // Shattered's bosses, their fists, pylons and minions (DM300.description, Pylon.description, YogFist.description).
  const boss = t.bosses.descs;
  if (mob.kind === 'pylon') return [mob.boss?.active ? boss.pylonActive! : boss.pylon!];
  if (mob.kind === 'dm300') return mob.boss?.supercharged ? [boss.dm300!, boss.dm300Supercharged!] : [boss.dm300!];
  if (isFist(mob)) return [boss.fist!, boss[mob.kind] ?? ''];
  if (boss[mob.kind]) return [boss[mob.kind]!];
  // Shattered's wands' creatures: what they can do, as strong as the wand that made them.
  if (mob.kind === 'ward') {
    const { tier, level } = mob.ward ?? { tier: 1, level: 0 };
    return [t.wardInfo(tier, 2 + level, 8 + 4 * level, tier)];
  }
  if (mob.kind === 'guardian') {
    const level = Math.max(0, mob.guardian?.level ?? 0);
    return [t.guardianInfo(level, 3 + 3 * level)];
  }
  if (mob.kind === 'lotus') {
    const level = mob.lotus?.level ?? 0;
    return [t.lotusInfo(level, Math.round(Math.min(1, 0.4 + 0.04 * level) * 100))];
  }
  // The armour abilities' allies, in Shattered's words: the hawk says how long it has left.
  if (mob.kind === 'shadow') return [artText('actors.hero.abilities.rogue.shadowclone$shadowally.desc')];
  if (mob.kind === 'ninjaLog') return [artText('actors.hero.abilities.rogue.smokebomb$ninjalog.desc')];
  if (mob.kind === 'hawk') {
    const left = Math.max(0, Math.floor(mob.hawk?.remaining ?? 0));
    return [artText('actors.hero.abilities.huntress.spirithawk$hawkally.desc'), artText('actors.hero.abilities.huntress.spirithawk$hawkally.desc_remaining', [left])];
  }
  const table = lang === 'ru' ? RU_MOBS : EN_MOBS;
  const x = MOB_EXTRAS[lang === 'ru' ? 'ru' : 'en'];
  if (mob.kind === 'ebonyMimic' && mob.hidden) return [x.ebonyDesc];
  const lines = [table[mob.kind] ?? table[SAME_AS[mob.kind] ?? mob.kind] ?? ''];
  if (mob.corrupted) lines.push(t.corruptedInfo);
  const spell = (x.spell as Partial<Record<MobKind, string>>)[mob.kind];
  if (spell) lines.push(spell);
  if (mob.kind === 'gnollExile') lines.push(mob.provoked ? x.exileAggro : x.exilePassive);
  if ((mob.kind === 'statue' || mob.kind === 'armoredStatue') && mob.item) {
    lines.push(mob.armor ? x.statueGear(nameOf(mob.item), nameOf(mob.armor)) : x.statueWeapon(nameOf(mob.item)));
  }
  if ((mob.kind === 'thief' || mob.kind === 'bandit') && mob.item) lines.push(x.carries(nameOf(mob.item)));
  if (mob.focused) lines.push(`${capital(x.focus)}: ${x.focusDesc}`);
  if (mob.enraged && mob.rageShield !== undefined) lines.push(`${capital(x.rage)}: ${x.rageDesc(Math.max(0, mob.hp))}`);
  if (mob.champion === 'growing') {
    const growth = mob.growth ?? 1.19;
    lines.push(`${capital(x.growing)}: ${x.growingDesc(Math.trunc(100 * (growth - 1)), Math.trunc(100 * (1 - 1 / growth)))}`);
  } else if (mob.champion) {
    const [name, desc] = x.champions[mob.champion];
    lines.push(`${capital(name)}: ${desc}`);
  }
  // Death Mark: the mark and the turns it has left.
  if (mob.deathMark) lines.push(artText('actors.hero.abilities.rogue.deathmark$deathmarktracker.desc', [Math.max(0, Math.ceil(mob.deathMark.until - now))]));
  return lines;
}

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** A champion's name and what it does, in Shattered's words (ChampionEnemy), for its window; null for anything else. */
export function championText(mob: Mob): { name: string; desc: string } | null {
  if (!mob.champion) return null;
  const x = MOB_EXTRAS[lang === 'ru' ? 'ru' : 'en'];
  if (mob.champion === 'growing') {
    const growth = mob.growth ?? 1.19;
    return { name: capital(x.growing), desc: x.growingDesc(Math.trunc(100 * (growth - 1)), Math.trunc(100 * (1 - 1 / growth))) };
  }
  const [name, desc] = x.champions[mob.champion];
  return { name: capital(name), desc };
}

const EN_PLANTS: Record<PlantKind, readonly [string, string]> = {
  firebloom: ['Firebloom', 'When something touches a Firebloom, it bursts into flames.'],
  icecap: ['Icecap', 'Touched, an Icecap lets out a pollen that freezes everything around.'],
  sorrowmoss: ['Sorrowmoss', 'A Sorrowmoss is a flower (not a moss) with razor-sharp petals, coated with a deadly venom.'],
  dreamweed: ['Dreamweed', 'Touched, a Dreamweed lets out a glittering cloud of confusing gas.'],
  stormvine: ['Stormvine', 'Gravity affects the stormvine plant strangely, allowing its whispy blue tendrils to hang on the air. Anything caught in the vine is affected by this, and becomes disoriented.'],
  swiftthistle: ['Swiftthistle', 'When trampled, swiftthistle will briefly accelerate the flow of time around it, allowing the trampler to perform several actions instantly.'],
  blindweed: ['Blindweed', 'Upon being touched a blindweed perishes in a bright flash of light. The flash is strong enough to disorient for several seconds.'],
  mageroyal: ['Mageroyal', "The mageroyal's prickly flowers contain a chemical which is known for its properties as a strong neutralizing agent. Anything that steps in this plant will be cleansed of many negative effects."],
  starflower: ['Starflower', 'A rare plant, starflower is said to grant holy power to whomever touches it.'],
  sungrass: ['Sungrass', 'Sungrass is renowned for the healing properties of its sap.'],
  earthroot: ['Earthroot', 'When a creature touches an Earthroot, its roots make a kind of natural armour around it.'],
  fadeleaf: ['Fadeleaf', 'Touching a Fadeleaf will teleport any creature to a random place on the level.'],
  rotberry: ['Rotberry', 'The berries of this shrub taste like sweet, sweet death.'],
  dewcatcher: ['Dewcatcher', 'Dewcatchers are wondrous plants that fill themselves with magical dew. They attempt to camouflage as grass to avoid attention, but their bulges of collected dew give them away.'],
  seedpod: ['Seed Pod', 'Seed Pods are magical plants that produce seeds from other plant types, rather than any seeds of their own. They somehow manage to spread despite having no seed of their own.'],
};

const RU_PLANTS: Record<PlantKind, readonly [string, string]> = {
  firebloom: ['Огнецвет', 'Когда что-нибудь касается огнецвета, он вспыхивает пламенем.'],
  icecap: ['Ледянка', 'Если коснуться ледянки, она выпускает пыльцу, которая замораживает всё вокруг.'],
  sorrowmoss: ['Скорбный мох', 'Скорбный мох — это цветок (а не мох) с острыми как бритва лепестками, покрытыми смертельным ядом.'],
  dreamweed: ['Дрём-трава', 'Если коснуться дрём-травы, она выпускает сверкающее облако дурманящего газа.'],
  stormvine: ['Грозовая лоза', 'Гравитация странно действует на грозовую лозу, позволяя её тонким синим усикам парить в воздухе. Всё, что попадается в эти усики, получает похожий эффект и становится дезориентированным.'],
  swiftthistle: ['Скорополох', 'Если наступить на скорополох, он ненадолго ускорит поток времени вокруг себя, дав возможность совершить несколько действий за один момент.'],
  blindweed: ['Слепняк', 'При прикосновении слепняк испускает яркую вспышку света и погибает. Вспышка достаточно сильна, чтобы вывести из строя на несколько секунд.'],
  mageroyal: ['Магороза', 'Колючие цветки магорозы содержат вещество, известное своими сильными нейтрализующими свойствами. Всё, что попадёт в это растение, будет очищено от множества негативных эффектов.'],
  starflower: ['Звездоцвет', 'Редкое растение; говорят, звездоцвет дарует святую силу тому, кто к нему прикоснётся.'],
  sungrass: ['Солнечная трава', 'Сок солнечной травы славится своими целебными свойствами.'],
  earthroot: ['Земляной корень', 'Когда существо касается земляного корня, корни образуют вокруг него что-то вроде природной брони.'],
  fadeleaf: ['Блеклист', 'Прикосновение к блеклисту переносит любое существо в случайное место на уровне.'],
  rotberry: ['Гнилоягодник', 'Ягоды этого кустарника на вкус как сладкая, сладкая смерть.'],
  dewcatcher: ['Росянка', 'Росянки - удивительные растения, наполняющиеся волшебной росой. Чтобы не привлекать внимание, они маскируются под траву, но их выдают наполненные росой выпуклости.'],
  seedpod: ['Семяловка', 'Семяловки - это волшебные растения, которые производят семена других видов растений, вместо своих собственных. Каким-то образом им удается распространяться, несмотря на отсутствие собственных семян.'],
};

/** WellWater.tileDesc: what power the well's water holds. */
const WELLS: Record<'en' | 'ru', Record<'health' | 'awareness' | 'transmutation', string>> = {
  en: {
    health: 'The power of health radiates from the water of this well. Take a sip from it to heal your wounds.',
    awareness: 'The power of knowledge radiates from the water of this well. Take a sip from it to reveal the secrets of this level and of your pack.',
    transmutation: 'The power of change radiates from the water of this well. Throw an item into it to turn it into something else.',
  },
  ru: {
    health: 'От воды этого колодца исходит сила здоровья. Сделайте глоток, чтобы исцелить раны.',
    awareness: 'От воды этого колодца исходит сила знания. Сделайте глоток, чтобы раскрыть тайны этого уровня и своего рюкзака.',
    transmutation: 'От воды этого колодца исходит сила перемен. Бросьте в него предмет, чтобы превратить его во что-то другое.',
  },
};

export const wellText = (water: 'health' | 'awareness' | 'transmutation'): string => WELLS[lang === 'ru' ? 'ru' : 'en'][water];

/** Plant.desc: what grows there, and what it does. */
export function plantText(kind: PlantKind): { name: string; desc: string } {
  const [name, desc] = (lang === 'ru' ? RU_PLANTS : EN_PLANTS)[kind];
  return { name, desc };
}

/**
 * Level.tileName and tileDesc, the region's own where it has them (levelnames.ts); a trap in sight
 * says what trap it is (WndInfoTrap: its name, «inactive» once spent, and its description).
 */
export function tileText(level: Level, pos: number): { name: string; desc: string } {
  const terrain = level.map[pos]!;
  const trap = level.traps?.find((tr) => tr.pos === pos);
  if (trap && (terrain === T.TRAP || terrain === T.INACTIVE_TRAP)) {
    const { name, desc } = trapText(trap.kind);
    return { name, desc: trap.active ? desc : `${plain(lt('windows.wndinfotrap.inactive'))}

${desc}` };
  }
  const base = terrainText(level, terrain);
  const custom = customText(level, pos);
  return { name: custom?.name ?? base.name, desc: custom?.desc ?? base.desc };
}

/**
 * WndInfoCell.cellName and its description: the last custom tilemap drawing something on the cell (not those
 * drawn over the characters) may name and describe it (CustomTilemap.name, desc); otherwise the terrain does.
 */
function customText(level: Level, pos: number): { name?: string; desc?: string } | undefined {
  const x = pos % WIDTH;
  const y = Math.trunc(pos / WIDTH);
  let found: { kind: string; tx: number; ty: number; tile: number } | undefined;
  for (const c of level.customTiles ?? []) {
    if (c.wall || x < c.x || x >= c.x + c.w || y < c.y || y >= c.y + c.h) continue;
    const tile = c.data?.[x - c.x + (y - c.y) * c.w] ?? -1;
    if (tile >= 0) found = { kind: c.kind, tx: x - c.x, ty: y - c.y, tile };
  }
  if (!found) return undefined;
  const text = (key: string): { name: string; desc: string } => ({ name: plain(lt(`${key}.name`)), desc: plain(lt(`${key}.desc`)) });
  switch (found.kind) {
    case 'Carpet':
      // Carpet: its own name and description, but a tile laid over it (a statue, a pedestal) is the terrain's.
      return found.tile < 80 ? text('tiles.custom.carpet') : undefined;
    case 'RatKingRoomDeco': {
      const key = 'levels.rooms.secret.ratkingroom$ratkingroomdeco';
      if (level.map[pos] === T.CUSTOM_DECO) return { name: plain(lt(`${key}.statue_name`)), desc: plain(lt(`${key}.statue_desc`)) };
      if (found.tx === 2 && found.ty === 2) return { name: plain(lt(`${key}.pillow_name`)), desc: plain(lt(`${key}.pillow_desc`)) };
      return undefined;
    }
    case 'WeakFloorRoom.HiddenWell':
      return text('levels.rooms.special.weakfloorroom$hiddenwell');
    // The old wandmaker's rooms: the mass grave's bones, the ritual site's marker and tables.
    case 'MassGraveRoom$MassGraveDeco':
      return text('levels.rooms.quest.massgraveroom$massgravedeco');
    case 'RitualSiteRoom$RitualMarker':
      return text('levels.rooms.quest.ritualsiteroom$ritualmarker');
    case 'RitualSiteRoom$Table':
      return text('levels.rooms.quest.ritualsiteroom$table');
    default:
      return undefined;
  }
}

/**
 * WndInfoCell: what lies over the cell, after its description (Blob.tileDesc, for the blobs seen there): the
 * sacrificial fire, the eternal fire, a garden's foliage, toxic gas.
 */
export function blobTexts(world: World, depth: number, pos: number, seen: boolean): string[] {
  const level = world.levels[depth];
  const floor = world.floors[depth];
  if (!level || !floor) return [];
  const texts: string[] = [];
  // SacrificialFire is alwaysVisible; the rest only where the party can see.
  if (floor.altar && floor.altar.volume > 0 && floor.altar.pos === pos) texts.push(plain(lt('actors.blobs.sacrificialfire.desc')));
  if (!seen) return texts;
  if (level.eternalFire?.includes(pos)) texts.push(plain(lt('levels.rooms.special.magicalfireroom$eternalfire.desc')));
  if (floor.foliage?.includes(pos)) texts.push(plain(lt('actors.blobs.foliage.desc')));
  if (floor.gas?.toxic?.some(([cell, volume]) => cell === pos && volume > 0)) texts.push(plain(lt('actors.blobs.toxicgas.desc')));
  return texts.filter(Boolean);
}

/**
 * The boss levels' own tiles (CavesBossLevel and CityBossLevel's tileName and tileDesc, the custom tiles'
 * name and desc) and what a fight leaves on a cell (Tengu's blobs, bombs and shockers, the pylons' energy).
 */
export function bossTile(world: World, level: Level, pos: number): { name: string; desc: string; extra: string[] } | null {
  const tiles = t.bosses.tiles;
  const floor = world.floors[level.depth];
  const extra: string[] = [];
  const boss = floor?.boss;
  if (boss?.fire?.some(([c]) => c === pos)) extra.push(tiles.fireBlob);
  if (boss?.shock?.some(([c]) => c === pos)) extra.push(tiles.shockBlob);
  if (boss?.energy?.includes(pos)) extra.push(tiles.energyDesc);
  for (const entry of boss?.timed ?? []) {
    if (entry.kind === 'bomb' && entry.pos === pos) return { name: tiles.bombName, desc: tiles.bombDesc, extra: [tiles.bombBlob, ...extra] };
    if (entry.kind === 'shocker' && entry.pos === pos) return { name: tiles.shockerName, desc: tiles.shockerDesc, extra };
  }
  const terrain = level.map[pos]!;
  if (level.depth === 15 && !world.arena) {
    if (GATE_CELLS.includes(pos)) return { name: tiles.gateName, desc: hasFlag(terrain, F.SOLID) ? tiles.gateDesc : tiles.gateBroken, extra };
    if (terrain === T.INACTIVE_TRAP) return { name: tiles.wiresName, desc: tiles.wiresDesc, extra };
    if (terrain === T.WATER) return { ...tileText(level, pos), extra: [tiles.waterDesc, ...extra] };
  }
  if (level.depth === 20 && !world.arena) {
    if (pos === THRONE) return { name: tiles.throneName, desc: tiles.throneDesc, extra };
    if (PEDESTALS.includes(pos)) return { name: tiles.summoningName, desc: tiles.summoningDesc, extra };
  }
  if (extra.length > 0) return { ...tileText(level, pos), extra };
  return null;
}
