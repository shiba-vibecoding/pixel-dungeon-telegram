import { F, hasFlag, type Mob, type MobKind, type PlantKind, T, trapAt } from '@pd/core';
import { lang, t } from './i18n';

/*
 * What the examine tool tells about a cell (Toolbar's info button, Mob.description,
 * Level.tileName and tileDesc): the monster there, or the terrain.
 */

const EN_MOBS: Partial<Record<MobKind, string>> = {
  rat: 'Marsupial rats are aggressive, but rather weak denizens of the sewers. They can be dangerous only in big numbers.',
  gnoll: 'Gnolls are hyena-like humanoids. They dwell in sewers and dungeons, venturing up to raid the surface from time to time. Gnoll scouts are regular members of their pack: not as strong as brutes, nor as intelligent as shamans.',
  crab: 'These huge crabs are at the top of the food chain in the sewers. They are extremely fast and their thick exoskeleton can withstand heavy blows.',
  goo: 'Little is known about the Goo. It is quite possible that it is not even a creature, but rather a conglomerate of substances from the sewers that has gained rudiments of free will.',
  ghost: 'The ghost is barely visible. It looks like a shapeless spot of faint light with a sorrowful face.',
  shopkeeper: 'This stout guy looks more appropriate for a trade district in some large city than for a dungeon. His prices explain why he prefers to do business here.',
  wandmaker: 'This old but hale gentleman wears a slightly confused expression. He is protected by a magic shield.',
  skeleton: 'Skeletons are made of the bones of unlucky adventurers and inhabitants of the dungeon, animated by emanations of evil magic from the depths below. Damaged enough, they come apart in an explosion of bones.',
  thief: 'The deeper levels of the dungeon have always hidden all kinds of criminals. Not all of them kept a clear mind so far from daylight: long ago, these crazy thieves and bandits forgot who they are and why they steal.',
  swarm: 'The deadly swarm of flies buzzes angrily. Every non-magical attack splits it into two smaller but equally dangerous swarms.',
  shaman: 'The most intelligent gnolls can master shamanistic magic. Gnoll shamans prefer battle spells to make up for their lack of might, and do not hesitate to use them on those who question their status in the tribe.',
  bat: 'These brisk and tenacious inhabitants of cave domes may defeat much larger opponents by replenishing their health with each successful attack.',
  brute: 'Brutes are the largest, strongest and toughest of all gnolls. When severely wounded, they go berserk, inflicting even more damage on their enemies.',
  tengu: 'Tengu are members of the ancient assassins clan, which is also called Tengu. These assassins are noted for their extensive use of shuriken and traps.',
  spinner: 'These greenish furry cave spiders avoid direct combat, preferring to wait at a distance while their victim, entangled in their cobweb, slowly dies from their poisonous bite.',
  dm300: 'This machine was created by the Dwarves several centuries ago, for construction and mining and now and then for the defence of the city. Later the Dwarves replaced machines with golems, elementals and even demons, which led their civilisation to its decline.',
  elemental: 'Wandering fire elementals are a byproduct of summoning greater entities. They are too chaotic in their nature to be controlled by even the most powerful demonologist.',
  monk: 'These monks are fanatics, who devoted themselves to protecting their city\'s secrets from all aliens. They use no armour or weapons, relying solely on the art of hand-to-hand combat.',
  warlock: 'When the dwarves\' interests shifted from engineering to the arcane arts, warlocks came to power in the city. They started with elemental magic, but soon switched to demonology and necromancy.',
  golem: 'The Dwarves tried to combine their knowledge of mechanisms with their newfound power of elemental binding, using spirits of earth as the "soul" of the golems\' mechanical bodies. The tiniest mistake in the ritual could cause an outbreak.',
  king: 'The last king of dwarves was known for his deep understanding of life and death. He persuaded his court to take part in a ritual that should have granted them eternal youth. In the end he was the only one who got it - and an army of undead as a bonus.',
  undead: 'These undead dwarves, risen by the will of the King of Dwarves, were members of his court. They appear as skeletons with a stunning amount of facial hair.',
  succubus: 'The succubi are demons that look like seductive (in a slightly gothic way) girls. Using its magic, a succubus can charm a hero, who then cannot attack it until the charm wears off.',
  eye: 'One of this demon\'s other names is "orb of hatred": when it sees an enemy, it uses its deathgaze recklessly, often wounding its allies too.',
  scorpio: 'These huge arachnid-like demonic creatures avoid close combat by all means, firing crippling serrated spikes from long distances.',
  yog: 'Yog-Dzewa is an Old God, a powerful entity from the realms of chaos. A century ago, the ancient dwarves barely won the war against its army of demons, but could not kill the god itself. Instead, they imprisoned it in the halls below their city, believing it too weak to rise ever again.',
  mimic: 'Mimics are magical creatures which can take any shape they wish. In dungeons they almost always choose the shape of a treasure chest, as they know how to beckon an adventurer.',
  statue: 'You would think it is just another ugly statue of this dungeon, but its red glowing eyes give it away. The statue itself is made of stone, but the weapon it wields looks real.',
  piranha: 'These carnivorous fish are not natural inhabitants of underground pools. They were bred specifically to protect flooded treasure vaults.',
  imp: 'Imps are lesser demons, notable for neither their strength nor their magic talent, but they are quite smart and sociable. Many imps prefer to live among non-demons.',
  sheep: 'This is a magic sheep. What is so magical about it? You cannot kill it. It will stand there until it magically fades away, chewing cud with a blank stare.',
  blacksmith: 'This troll blacksmith looks like all trolls look: tall and lean, his skin like stone in both colour and texture. He is tinkering with disproportionately small tools.',
  mirror: 'This illusion bears a close resemblance to you, but it is paler and twitches a little.',
  fetidRat: 'This marsupial rat is much larger than a regular one. It is surrounded by a foul cloud.',
  curse: 'This creature resembles the sad ghost, but it swirls with darkness. Its face bears an expression of despair.',
  ratKing: 'This rat is a little bigger than a regular marsupial rat and it is wearing a tiny crown on its head.',
  wraith: 'A wraith is the vengeful spirit of a sinner whose grave or tomb was disturbed. Being an ethereal entity, it is very hard to hit with a regular weapon.',
  bee: 'Despite their small size, golden bees protect their master fiercely. They do not live long, though.',
  impShopkeeper: 'Imps are lesser demons, notable for neither their strength nor their magic talent. But they are quite smart and sociable, and many imps prefer to live and do business among non-demons.',
};

const RU_MOBS: Partial<Record<MobKind, string>> = {
  rat: 'Сумчатые крысы агрессивны, но довольно слабы. Опасны они только большими стаями.',
  gnoll: 'Гноллы — похожие на гиен гуманоиды. Они живут в канализации и подземельях и время от времени совершают набеги на поверхность. Гноллы-следопыты — рядовые члены стаи: не такие сильные, как громилы, и не такие умные, как шаманы.',
  crab: 'Эти огромные крабы — вершина пищевой цепи в канализации. Они очень быстры, а толстый панцирь выдерживает сильные удары.',
  goo: 'О Жиже известно немного. Возможно, это вовсе не существо, а сгусток веществ из канализации, обретший зачатки свободной воли.',
  ghost: 'Привидение едва видно: бесформенное пятно тусклого света с печальным лицом.',
  shopkeeper: 'Этот крепыш больше подошёл бы торговому кварталу большого города, чем подземелью. Его цены объясняют, почему он предпочитает торговать здесь.',
  wandmaker: 'У этого старого, но бодрого джентльмена немного растерянный вид. Его защищает магический щит.',
  skeleton: 'Скелеты собраны из костей незадачливых искателей приключений и обитателей подземелья и оживлены злой магией, что исходит из глубин. Достаточно повреждённые, они разлетаются взрывом костей.',
  thief: 'На нижних уровнях подземелья всегда прятались преступники всех мастей. Не все сохранили рассудок вдали от дневного света: эти безумные воры и бандиты давно забыли, кто они и зачем крадут.',
  swarm: 'Смертоносный рой мух злобно жужжит. Каждый немагический удар делит его на два роя поменьше, но не менее опасных.',
  shaman: 'Самые умные гноллы овладевают шаманской магией. Шаманы предпочитают боевые заклинания, чтобы восполнить недостаток силы, и не стесняются применять их против тех, кто сомневается в их положении в племени.',
  bat: 'Эти шустрые и цепкие обитатели пещерных сводов могут одолеть куда более крупных противников, восполняя здоровье с каждым удачным укусом.',
  brute: 'Громилы — самые большие, сильные и выносливые из гноллов. Тяжело раненные, они впадают в ярость и бьют ещё сильнее.',
  tengu: 'Тенгу — члены древнего клана убийц, который тоже зовётся Тенгу. Эти убийцы славятся тем, что охотно пускают в ход сюрикены и ловушки.',
  spinner: 'Эти зеленоватые пушистые пещерные пауки избегают ближнего боя и предпочитают ждать в стороне, пока опутанная паутиной жертва медленно умирает от их ядовитого укуса.',
  dm300: 'Эту машину гномы построили несколько веков назад — для строительства и добычи руды, а иногда и для обороны города. Позже гномы заменили машины големами, элементалями и даже демонами, что и привело их цивилизацию к упадку.',
  elemental: 'Блуждающие огненные элементали — побочный продукт призыва более могущественных сущностей. Они слишком хаотичны, чтобы ими мог управлять даже самый сильный демонолог.',
  monk: 'Эти монахи — фанатики, посвятившие себя охране тайн своего города от чужаков. Они не носят ни доспехов, ни оружия и полагаются только на искусство рукопашного боя.',
  warlock: 'Когда интересы гномов сместились от инженерии к тайным искусствам, к власти в городе пришли чернокнижники. Начав с магии стихий, они вскоре перешли к демонологии и некромантии.',
  golem: 'Гномы попытались соединить знание механизмов с новообретённой властью над стихиями, вселяя духов земли в механические тела големов как их «души». Малейшая ошибка в ритуале могла обернуться бунтом.',
  king: 'Последний король гномов славился глубоким пониманием жизни и смерти. Он убедил свой двор принять участие в ритуале, который должен был даровать им вечную молодость. В итоге получил её только он сам — и армию нежити в придачу.',
  undead: 'Эти мёртвые гномы, поднятые волей Короля гномов, были членами его двора. Это скелеты с поразительно пышными бородами.',
  succubus: 'Суккубы — демоны в облике соблазнительных (немного в готическом духе) девушек. Своей магией суккуб может очаровать героя, и тот не сможет её атаковать, пока чары не рассеются.',
  eye: 'Другое имя этого демона — «сфера ненависти»: увидев врага, он бездумно пускает в ход смертоносный взгляд, нередко раня и своих.',
  scorpio: 'Эти огромные паукообразные демонические создания всеми силами избегают ближнего боя и издалека стреляют калечащими зазубренными шипами.',
  yog: 'Йог-Дзева — Древний бог, могущественная сущность из царства хаоса. Век назад гномы едва выиграли войну с его армией демонов, но убить самого бога не смогли. Вместо этого они заточили его в чертогах под своим городом, веря, что он слишком слаб, чтобы когда-нибудь подняться.',
  mimic: 'Мимики — магические существа, способные принять любой облик. В подземельях они почти всегда выбирают облик сундука с сокровищами: так легче всего заманить искателя приключений.',
  statue: 'Можно подумать, что это ещё одна уродливая статуя, но её выдают горящие красные глаза. Сама статуя каменная, но оружие у неё в руках выглядит настоящим.',
  piranha: 'Эти хищные рыбы — не исконные обитатели подземных водоёмов. Их вывели специально для охраны затопленных сокровищниц.',
  imp: 'Бесы — младшие демоны, не отличающиеся ни силой, ни магическим даром, зато они умны и общительны. Многие бесы предпочитают жить среди не-демонов.',
  sheep: 'Это волшебная овца. Что в ней волшебного? Её нельзя убить. Она будет стоять здесь, пока волшебным образом не исчезнет, и жевать жвачку с отсутствующим видом.',
  blacksmith: 'Этот тролль-кузнец выглядит как все тролли: высокий и худой, с кожей, похожей на камень и цветом, и на ощупь. Он возится с несоразмерно мелкими инструментами.',
  mirror: 'Эта иллюзия очень похожа на вас, только бледнее и слегка подрагивает.',
  fetidRat: 'Эта сумчатая крыса гораздо крупнее обычной. Её окутывает зловонное облако.',
  curse: 'Это существо напоминает печальное привидение, но клубится тьмой. На его лице застыло отчаяние.',
  ratKing: 'Эта крыса чуть крупнее обычной сумчатой, и на голове у неё крошечная корона.',
  wraith: 'Призрак — мстительный дух грешника, чью могилу или гробницу потревожили. Бесплотного, его очень трудно задеть обычным оружием.',
  bee: 'Несмотря на малый размер, золотые пчёлы яростно защищают хозяина. Правда, живут они недолго.',
  impShopkeeper: 'Бесы — младшие демоны, не отличающиеся ни силой, ни магическим даром. Зато они умны и общительны, и многие бесы предпочитают жить и торговать среди не-демонов.',
};

/** Rare variants and a boss's parts are described as what they are a version or part of. */
const SAME_AS: Partial<Record<MobKind, MobKind>> = {
  albino: 'rat', bandit: 'thief', shielded: 'brute', senior: 'monk', acidic: 'scorpio', larva: 'yog', rottingFist: 'yog', burningFist: 'yog',
};

export function mobDescription(mob: Mob): string {
  // Shattered's wands' creatures: what they can do, as strong as the wand that made them.
  if (mob.kind === 'ward') {
    const { tier, level } = mob.ward ?? { tier: 1, level: 0 };
    return t.wardInfo(tier, 2 + level, 8 + 4 * level, tier);
  }
  if (mob.kind === 'guardian') {
    const level = Math.max(0, mob.guardian?.level ?? 0);
    return t.guardianInfo(level, 3 + 3 * level);
  }
  if (mob.kind === 'lotus') {
    const level = mob.lotus?.level ?? 0;
    return t.lotusInfo(level, Math.round(Math.min(1, 0.4 + 0.04 * level) * 100));
  }
  const table = lang === 'ru' ? RU_MOBS : EN_MOBS;
  const own = table[mob.kind] ?? table[SAME_AS[mob.kind] ?? mob.kind] ?? '';
  return mob.corrupted ? `${own}\n\n${t.corruptedInfo}` : own;
}

/** A creature's name, a ward's by its tier (Ward.name). */
export function mobName(mob: Mob): string {
  if (mob.kind === 'ward') return t.wardNames[(mob.ward?.tier ?? 1) - 1] ?? t.mobs.ward;
  return t.mobs[mob.kind];
}

const EN_PLANTS: Record<PlantKind, readonly [string, string]> = {
  firebloom: ['Firebloom', 'When something touches a Firebloom, it bursts into flames.'],
  icecap: ['Icecap', 'Touched, an Icecap lets out a pollen that freezes everything around.'],
  sorrowmoss: ['Sorrowmoss', 'A Sorrowmoss is a flower (not a moss) with razor-sharp petals, coated with a deadly venom.'],
  dreamweed: ['Dreamweed', 'Touched, a Dreamweed lets out a glittering cloud of confusing gas.'],
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

type Tile =
  | 'chasm' | 'floor' | 'grass' | 'water' | 'wall' | 'door' | 'openDoor' | 'entrance' | 'exit' | 'embers' | 'lockedDoor' | 'pedestal'
  | 'barricade' | 'highGrass' | 'lockedExit' | 'unlockedExit' | 'sign' | 'well' | 'emptyWell' | 'statue' | 'trap' | 'spentTrap'
  | 'bookshelf' | 'alchemy';

const EN_TILES: Record<Tile, readonly [string, string]> = {
  chasm: ['Chasm', 'You cannot see the bottom.'],
  floor: ['Floor', ''],
  grass: ['Grass', ''],
  water: ['Water', 'If you are on fire, step into the water to put it out.'],
  wall: ['Wall', ''],
  door: ['Closed door', ''],
  openDoor: ['Open door', ''],
  entrance: ['Depth entrance', 'Stairs lead up to the depth above.'],
  exit: ['Depth exit', 'Stairs lead down to the depth below.'],
  embers: ['Embers', 'Embers cover the floor.'],
  lockedDoor: ['Locked door', 'This door is locked: you need the matching key to open it.'],
  pedestal: ['Pedestal', ''],
  barricade: ['Barricade', 'The wooden barricade is firmly set but has dried over the years. Might it burn?'],
  highGrass: ['High grass', 'Dense vegetation blocks the view.'],
  lockedExit: ['Locked depth exit', 'Heavy bars block the stairs leading down.'],
  unlockedExit: ['Unlocked depth exit', 'Stairs lead down to the depth below.'],
  sign: ['Sign', 'You cannot read the text from here.'],
  well: ['Well', 'Its water may hold some power.'],
  emptyWell: ['Empty well', 'The well has run dry.'],
  statue: ['Statue', 'Someone wanted to adorn this place, but failed, obviously.'],
  trap: ['Trap', 'Stepping onto a hidden pressure plate will set off the trap.'],
  spentTrap: ['Triggered trap', 'The trap has been set off before, and is not dangerous any more.'],
  bookshelf: ['Bookshelf', ''],
  alchemy: ['Alchemy pot', 'Drop some seeds here to brew a potion.'],
};

const RU_TILES: Record<Tile, readonly [string, string]> = {
  chasm: ['Пропасть', 'Дна не видно.'],
  floor: ['Пол', ''],
  grass: ['Трава', ''],
  water: ['Вода', 'Если вы горите, шагните в воду, чтобы потушить огонь.'],
  wall: ['Стена', ''],
  door: ['Закрытая дверь', ''],
  openDoor: ['Открытая дверь', ''],
  entrance: ['Вход на уровень', 'Лестница ведёт наверх, на уровень выше.'],
  exit: ['Выход с уровня', 'Лестница ведёт вниз, на уровень ниже.'],
  embers: ['Угли', 'Пол покрыт углями.'],
  lockedDoor: ['Запертая дверь', 'Дверь заперта: чтобы открыть её, нужен подходящий ключ.'],
  pedestal: ['Пьедестал', ''],
  barricade: ['Баррикада', 'Деревянная баррикада прочно стоит, но за годы рассохлась. Может, она горит?'],
  highGrass: ['Высокая трава', 'Густая растительность закрывает обзор.'],
  lockedExit: ['Запертый выход', 'Тяжёлая решётка перекрывает лестницу вниз.'],
  unlockedExit: ['Открытый выход', 'Лестница ведёт вниз, на уровень ниже.'],
  sign: ['Табличка', 'Отсюда не прочесть, что на ней написано.'],
  well: ['Колодец', 'В его воде, возможно, есть какая-то сила.'],
  emptyWell: ['Пустой колодец', 'Колодец пересох.'],
  statue: ['Статуя', 'Кто-то хотел украсить это место, но, очевидно, не преуспел.'],
  trap: ['Ловушка', 'Если наступить на скрытую нажимную плиту, ловушка сработает.'],
  spentTrap: ['Сработавшая ловушка', 'Ловушка уже срабатывала и больше не опасна.'],
  bookshelf: ['Книжная полка', ''],
  alchemy: ['Алхимический котёл', 'Бросьте сюда семена, чтобы сварить зелье.'],
};

function tileOf(terrain: number): Tile {
  if (terrain >= T.WATER_TILES) return 'water';
  if (trapAt(terrain) && !hasFlag(terrain, F.SECRET)) return 'trap';
  if (hasFlag(terrain, F.PIT)) return 'chasm';
  switch (terrain) {
    case T.GRASS: return 'grass';
    case T.WALL: case T.WALL_DECO: case T.SECRET_DOOR: return 'wall';
    case T.DOOR: return 'door';
    case T.OPEN_DOOR: return 'openDoor';
    case T.ENTRANCE: return 'entrance';
    case T.EXIT: return 'exit';
    case T.EMBERS: return 'embers';
    case T.LOCKED_DOOR: return 'lockedDoor';
    case T.PEDESTAL: return 'pedestal';
    case T.BARRICADE: return 'barricade';
    case T.HIGH_GRASS: return 'highGrass';
    case T.LOCKED_EXIT: return 'lockedExit';
    case T.UNLOCKED_EXIT: return 'unlockedExit';
    case T.SIGN: return 'sign';
    case T.WELL: return 'well';
    case T.EMPTY_WELL: return 'emptyWell';
    case T.STATUE: case T.STATUE_SP: return 'statue';
    case T.INACTIVE_TRAP: return 'spentTrap';
    case T.BOOKSHELF: return 'bookshelf';
    case T.ALCHEMY: return 'alchemy';
    default: return 'floor';
  }
}

/** Level.tileName and tileDesc: what a cell's terrain is called, and what there is to know about it. */
export function tileText(terrain: number): { name: string; desc: string } {
  const [name, desc] = (lang === 'ru' ? RU_TILES : EN_TILES)[tileOf(terrain)];
  return { name, desc };
}
