import { describe, expect, it } from 'vitest';
import { CLASS_ORDER, classOffered, emptyWallet, forSale, offerBySku, OFFERS, walletPay, walletRefund } from '../src';

describe('Pixel-Mart camps', () => {
  it('sells the cave, the prison yard and the hall at 100 Stars each', () => {
    const camps = OFFERS.filter((offer) => offer.kind === 'camp');
    expect(camps.map((offer) => offer.sku)).toEqual(['camp.cave', 'camp.prison', 'camp.hall']);
    for (const camp of camps) {
      expect(camp.stars).toBe(100);
      expect(forSale(camp)).toBe(true);
      expect(camp.season).toBeUndefined();
      expect(offerBySku(camp.sku)).toBe(camp);
    }
  });

  it('a camp bought is owned once and goes with a refund', () => {
    let wallet = walletPay(emptyWallet(), 'camp.hall', 'c1', 100, 1);
    wallet = walletPay(wallet, 'camp.hall', 'c1', 100, 2);
    expect(wallet.owned).toEqual(['camp.hall']);
    expect(walletRefund(wallet, 'c1').owned).toEqual([]);
  });

  it('offers looks only for the classes the rules have', () => {
    expect(CLASS_ORDER.slice(0, 4).every(classOffered)).toBe(true);
    const skinned = new Set(OFFERS.filter((offer) => offer.kind === 'skin').map((offer) => offer.heroClass));
    for (const name of CLASS_ORDER) expect(skinned.has(name as never)).toBe(classOffered(name));
  });
});
