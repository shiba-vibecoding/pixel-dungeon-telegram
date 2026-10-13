import type { Offer } from '@pd/core';

/*
 * What an invoice says an offer is, in the buyer's language. Written on the
 * server, not taken from the client's request: the invoice is what Telegram
 * shows the buyer and keeps on their receipt, so a client must not be able
 * to put its own words there. The names follow the shop's (client i18n.ts).
 */

export interface InvoiceText {
  title: string;
  description: string;
}

interface Words {
  look: Record<string, string>;
  skin: Record<string, [name: string, info: string]>;
  effect: Record<string, [name: string, info: string]>;
  frame: Record<string, string>;
  camp: Record<string, [name: string, info: string]>;
  campWord: string;
  frameWord: string;
  frameInfo: string;
  effectWord: string;
  patron: InvoiceText;
  tip: InvoiceText;
}

const EN: Words = {
  look: { warrior: 'Warrior look', mage: 'Mage look', rogue: 'Rogue look', huntress: 'Huntress look', duelist: 'Duelist look', cleric: 'Cleric look' },
  skin: {
    ash: ['Ashen', 'Armour gone grey with ash, the hair too.'],
    royal: ['Royal', 'Gold for metal and light cloth, purple for the rest.'],
    shadow: ['Shadow', 'Dark violet, hair near black.'],
  },
  effect: {
    sparks: ['Sparks', 'Your blows strike gold sparks.'],
    fireflies: ['Fireflies', 'Fireflies drift around you.'],
    snow: ['Snowfall', 'Snow falls about you. Winter only.'],
  },
  frame: { bronze: 'Bronze', gold: 'Gold', shadow: 'Shadow', patron: 'Patron' },
  camp: {
    cave: ['Crystal cave', 'Your camp in a cave of glowing crystals.'],
    prison: ['Prison yard', 'Your camp in a prison yard, under a barred window.'],
    hall: ['Dwarven hall', 'Your camp in a hall of the dwarven city.'],
  },
  campWord: 'Camp',
  frameWord: 'Frame',
  frameInfo: 'A frame for your portrait, seen by the party.',
  effectWord: 'Effect',
  patron: { title: 'Patron', description: 'A month’s subscription: a star by your name, the «Patron» portrait frame and the «Patron of the arts» badge. Looks only.' },
  tip: { title: 'Treat the developer', description: 'Thank you for playing! A treat changes nothing in the game, but it keeps it growing.' },
};

const RU: Words = {
  look: { warrior: 'Облик воина', mage: 'Облик мага', rogue: 'Облик разбойника', huntress: 'Облик охотницы', duelist: 'Облик дуэлянтки', cleric: 'Облик клирика' },
  skin: {
    ash: ['Пепельный', 'Броня, посеревшая от пепла, и пепельные волосы.'],
    royal: ['Королевский', 'Металл и светлая ткань в золото, цветное в пурпур.'],
    shadow: ['Теневой', 'Тёмный фиолетовый, волосы почти чёрные.'],
  },
  effect: {
    sparks: ['Искры', 'Ваши удары высекают золотые искры.'],
    fireflies: ['Светлячки', 'Вокруг вас кружат светлячки.'],
    snow: ['Снегопад', 'Вокруг вас падает снег. Только зимой.'],
  },
  frame: { bronze: 'Бронза', gold: 'Золото', shadow: 'Тень', patron: 'Покровитель' },
  camp: {
    cave: ['Пещера с кристаллами', 'Ваш привал в пещере светящихся кристаллов.'],
    prison: ['Тюремный двор', 'Ваш привал во дворе тюрьмы, под окном с решёткой.'],
    hall: ['Зал гномов', 'Ваш привал в зале гномьего города.'],
  },
  campWord: 'Привал',
  frameWord: 'Рамка',
  frameInfo: 'Рамка вашего портрета, её видит отряд.',
  effectWord: 'Эффект',
  patron: { title: 'Покровитель', description: 'Подписка на месяц: звезда у имени, рамка портрета «Покровитель» и значок «Меценат». Только облик.' },
  tip: { title: 'Угостить разработчика', description: 'Спасибо, что играете! Угощение ничего не меняет в игре, но помогает ей расти.' },
};

/** Russian for the languages the client shows in Russian; English otherwise. */
export const speaksRussian = (language?: string): boolean => /^(ru|uk|be|kk)/i.test(language ?? '');

/** The invoice's title (at most 32 characters, Telegram's limit) and description (255). */
export function invoiceText(offer: Offer, language?: string): InvoiceText {
  const w = speaksRussian(language) ? RU : EN;
  const fit = (text: InvoiceText): InvoiceText => ({ title: text.title.slice(0, 32), description: text.description.slice(0, 255) });
  switch (offer.kind) {
    case 'skin': {
      const [name, info] = w.skin[offer.skin!] ?? [offer.sku, ''];
      return fit({ title: `${w.look[offer.heroClass!] ?? offer.heroClass}: ${name}`, description: info || name });
    }
    case 'effect': {
      const [name, info] = w.effect[offer.effect!] ?? [offer.sku, ''];
      return fit({ title: `${w.effectWord}: ${name}`, description: info || name });
    }
    case 'frame':
      return fit({ title: `${w.frameWord}: ${w.frame[offer.frame!] ?? offer.sku}`, description: w.frameInfo });
    case 'camp': {
      const [name, info] = w.camp[offer.camp!] ?? [offer.sku, ''];
      return fit({ title: `${w.campWord}: ${name}`, description: info || name });
    }
    case 'patron':
      return fit(w.patron);
    case 'tip':
      return fit({ title: `${w.tip.title} ${offer.stars}★`, description: w.tip.description });
  }
}
