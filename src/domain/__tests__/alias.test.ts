import { findAlias, stableText, type AliasTemplate } from '../alias';

const paypal = 'PayPal Europe S.a.r.l. et Cie S.C.A';
const tpl = (over: Partial<AliasTemplate> = {}): AliasTemplate => ({
  counterparty: paypal,
  purpose: '1041234567890 PP.5555.PP . ALDI TALK, Ihr Einkauf bei ALDI TALK',
  amountCents: -799,
  alias: 'AldiTalk Flat',
  bookingDate: '2026-09-15',
  ...over,
});

describe('stableText', () => {
  it('entfernt Referenznummern und PayPal-Kennungen', () => {
    expect(stableText('1041234567890 PP.5555.PP . ALDI TALK, Ihr Einkauf bei ALDI TALK')).toBe(
      'aldi talk ihr einkauf bei aldi talk',
    );
  });
});

describe('findAlias', () => {
  const next = { counterparty: paypal, purpose: '1049876543210 PP.5555.PP . ALDI TALK, Ihr Einkauf bei ALDI TALK', amountCents: -799 };

  it('übernimmt den Namen bei gleichem Empfänger, Zweck und Betrag', () => {
    expect(findAlias(next, [tpl()])).toBe('AldiTalk Flat');
  });

  it('toleriert bis zu 10 % Betragsabweichung', () => {
    expect(findAlias({ ...next, amountCents: -870 }, [tpl()])).toBe('AldiTalk Flat');
    expect(findAlias({ ...next, amountCents: -1000 }, [tpl()])).toBeNull();
    expect(findAlias({ ...next, amountCents: 799 }, [tpl()])).toBeNull();
  });

  it('greift nicht bei anderem Zweck oder Empfänger', () => {
    expect(findAlias({ ...next, purpose: 'PP.1.PP . Spotify AB' }, [tpl()])).toBeNull();
    expect(findAlias({ ...next, counterparty: 'Klarna' }, [tpl()])).toBeNull();
  });

  it('greift nicht, wenn der Zweck nur aus Nummern besteht', () => {
    const bare = { ...next, purpose: '1049876543210 PP.5555.PP' };
    expect(findAlias(bare, [tpl({ purpose: '1041111111111 PP.5555.PP' })])).toBeNull();
  });

  it('nimmt bei mehreren Treffern den neuesten Namen', () => {
    expect(findAlias(next, [tpl(), tpl({ alias: 'Handy', bookingDate: '2026-10-15' })])).toBe('Handy');
  });
});
