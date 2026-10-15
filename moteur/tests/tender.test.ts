import { describe, expect, it } from 'vitest';
import { DEFAULT_BILAN_PARAMS as DEFAULT_PARAMS, DEFAULT_CRITERIA, buildDuration, LocalProjection, MARKETS, SOCIAL_PRICE_RATIO, QUALITY_COST, computeBilan, computeProject, type Parcel, type Vec2 } from '../src/engine';
import {
  LAUNCH_GRACE,
  PROGRAMMES,
  applyAction,
  programmeParams,
  bidProblem,
  campaignConfig,
  committedTenderCash,
  createGame,
  netWorth,
  openTenders,
  playBots,
  scoreBid,
  tenderBidOf,
  type Action,
  type GameState,
  type TenderSpec,
} from '../src/game';

const O = new LocalProjection(2.35, 48.85);
const lot = (i: number): Parcel => ({
  ring: ([[i * 30, 0], [i * 30 + 20, 0], [i * 30 + 20, 30], [i * 30, 30]] as Vec2[]).map((p) => O.toLonLat(p)),
  streetEdges: [0],
});
const PLOTS = Array.from({ length: 8 }, (_, i) => ({ id: `T${i}`, parcel: lot(i), askingPrice: 500_000 }));
const players = [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }];
const make = (over: Parameters<typeof createGame>[0]['config'] = {}) =>
  createGame({
    players,
    plots: PLOTS,
    config: { market: MARKETS['petite-couronne'], startCash: 6_000_000, communeTenders: true, municipalPlots: 2, tenderRounds: 3, tenderEvery: 3, eventChance: 0, marketVolatility: 0, rateVolatility: 0, holdingCostRate: 0, salesDemand: 100, ...over },
    seed: 5,
  });
const play = (s: GameState, a: Action): GameState => {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const err = (s: GameState, a: Action) => {
  const r = applyAction(s, a);
  if (r.ok) throw new Error('action acceptée à tort');
  return r.error;
};
const next = (s: GameState) => players.reduce((st, p) => (st.over ? st : play(st, { type: 'ready', player: p.id })), s);
const cash = (s: GameState, id: string) => s.players.find((p) => p.id === id)!.cash;

const SPEC: TenderSpec = { minSocialShare: 0.25, groundCommerce: false, maxLevels: 4, minQuality: 0, minDelivery: 5, maxDelivery: 8, minPrice: 500_000, programme: PROGRAMMES.pup, weights: { price: 0.3, social: 0.4, quality: 0.15, delay: 0.15 } };

describe('appels d’offres de la commune : notation', () => {
  it('chaque critère est noté seul de 0 à 1, puis pondéré selon l’annonce', () => {
    const min = scoreBid(SPEC, { price: 500_000, socialShare: 0.25, quality: 0, delivery: 8 });
    expect(min.total).toBe(0);
    const max = scoreBid(SPEC, { price: 750_000, socialShare: 0.5, quality: 2, delivery: 5 });
    expect(max.total).toBeCloseTo(1, 6);
    const mid = scoreBid(SPEC, { price: 625_000, socialShare: 0.375, quality: 1, delivery: 6.5 });
    expect(mid.price).toBeCloseTo(0.5, 6);
    expect(mid.social).toBeCloseTo(0.5, 6);
    expect(mid.quality).toBe(0.5);
    expect(mid.delay).toBeCloseTo(0.5, 6);
    expect(mid.total).toBeCloseTo(0.5, 6);
    // au-delà des plafonds, pas de points en plus
    expect(scoreBid(SPEC, { price: 2_000_000, socialShare: 0.5, quality: 2, delivery: 5 }).total).toBeCloseTo(1, 6);
  });

  it('la pondération change le gagnant : à prix égal, le critère le plus lourd décide', () => {
    const priceLover: TenderSpec = { ...SPEC, weights: { price: 0.7, social: 0.1, quality: 0.1, delay: 0.1 } };
    const socialLover: TenderSpec = { ...SPEC, weights: { price: 0.1, social: 0.7, quality: 0.1, delay: 0.1 } };
    const rich = { price: 700_000, socialShare: 0.25, quality: 0 as const, delivery: 8 };
    const kind = { price: 520_000, socialShare: 0.5, quality: 0 as const, delivery: 8 };
    expect(scoreBid(priceLover, rich).total).toBeGreaterThan(scoreBid(priceLover, kind).total);
    expect(scoreBid(socialLover, kind).total).toBeGreaterThan(scoreBid(socialLover, rich).total);
  });

  it('refuse les propositions hors cahier des charges, avec la raison', () => {
    const ok = { price: 520_000, socialShare: 0.3, quality: 0 as const, delivery: 6 };
    expect(bidProblem(SPEC, ok)).toBeNull();
    expect(bidProblem(SPEC, { ...ok, price: 400_000 })).toMatch(/prix/);
    expect(bidProblem(SPEC, { ...ok, socialShare: 0.1 })).toMatch(/sociaux/);
    expect(bidProblem(SPEC, { ...ok, socialShare: 0.9 })).toMatch(/sociaux/);
    expect(bidProblem({ ...SPEC, minQuality: 1 }, ok)).toMatch(/qualité/);
    expect(bidProblem(SPEC, { ...ok, delivery: 3 })).toMatch(/délai/);
    expect(bidProblem(SPEC, { ...ok, delivery: 12 })).toMatch(/délai/);
    expect(bidProblem(SPEC, { ...ok, price: Number.NaN })).toMatch(/invalide/);
  });
});

describe('appels d’offres de la commune : déroulement', () => {
  it('la commune garde des terrains et ouvre un appel d’offres dès le départ ; ces terrains ne s’achètent pas autrement', () => {
    const s = make();
    const communal = s.plots.filter((p) => p.municipal);
    expect(communal).toHaveLength(2);
    expect(openTenders(s)).toHaveLength(1);
    const t = openTenders(s)[0];
    expect(communal.some((p) => p.id === t.plotId)).toBe(true);
    expect(t.closesAt).toBe(3);
    expect(t.spec.weights.price + t.spec.weights.social + t.spec.weights.quality + t.spec.weights.delay).toBeCloseTo(1, 6);
    expect(err(make({ landMarket: 'instant' }), { type: 'buy', player: 'a', plot: communal[0].id })).toMatch(/appel d’offres/);
    const auction = make({ landMarket: 'auction', listingShare: 1 });
    expect(auction.plots.filter((p) => p.municipal).every((p) => !p.listing)).toBe(true);
    expect(err(auction, { type: 'offer', player: 'a', plot: communal[0].id, price: 900_000 })).toMatch(/appel d’offres/);
  });

  it('une proposition bloque l’argent ; la remplacer ou la retirer ajuste ou rend la somme', () => {
    let s = make();
    const t = openTenders(s)[0];
    const start = cash(s, 'a');
    s = play(s, { type: 'tenderBid', player: 'a', tender: t.id, price: t.spec.minPrice * 1.1, socialShare: 0.4, quality: 1, delivery: 6 });
    expect(committedTenderCash(s, 'a')).toBeCloseTo(t.spec.minPrice * 1.1 * 1.075, -0.5);
    expect(cash(s, 'a')).toBeCloseTo(start - t.spec.minPrice * 1.1 * 1.075, -0.5);
    s = play(s, { type: 'tenderBid', player: 'a', tender: t.id, price: t.spec.minPrice * 1.3, socialShare: 0.4, quality: 1, delivery: 6 });
    expect(openTenders(s)[0].bids).toHaveLength(1);
    expect(committedTenderCash(s, 'a')).toBeCloseTo(t.spec.minPrice * 1.3 * 1.075, -0.5);
    s = play(s, { type: 'tenderWithdraw', player: 'a', tender: t.id });
    expect(cash(s, 'a')).toBeCloseTo(start, -0.5);
    expect(err(s, { type: 'tenderWithdraw', player: 'a', tender: t.id })).toMatch(/pas de proposition/);
    expect(err(s, { type: 'tenderBid', player: 'a', tender: t.id, price: 1000, socialShare: 0.4, quality: 1, delivery: 6 })).toMatch(/prix/);
    expect(err(s, { type: 'tenderBid', player: 'a', tender: 'AO99', price: 900_000, socialShare: 0.4, quality: 1, delivery: 6 })).toMatch(/pas ouvert/);
  });

  it('la meilleure note l’emporte, pas le meilleur prix ; le perdant est remboursé ; le lauréat devient propriétaire avec ses engagements', () => {
    let s = make();
    const t = openTenders(s)[0];
    const m = t.spec.minPrice;
    // Alice : prix élevé mais strict minimum ; Bob : prix plus bas, mais bien plus de logements sociaux et de qualité
    s = play(s, { type: 'tenderBid', player: 'a', tender: t.id, price: m * 1.4, socialShare: t.spec.minSocialShare, quality: t.spec.minQuality, delivery: t.spec.maxDelivery });
    s = play(s, { type: 'tenderBid', player: 'b', tender: t.id, price: m * 1.02, socialShare: 0.5, quality: 2, delivery: t.spec.minDelivery });
    const startA = cash(s, 'a') + committedTenderCash(s, 'a');
    const sa = scoreBid(t.spec, tenderBidOf(openTenders(s)[0], 'a')!);
    const sb = scoreBid(t.spec, tenderBidOf(openTenders(s)[0], 'b')!);
    expect(sb.total).toBeGreaterThan(sa.total);
    s = next(next(next(s)));
    const plot = s.plots.find((p) => p.id === t.plotId)!;
    expect(plot.owner).toBe('b');
    expect(plot.municipal).toBe(false);
    expect(plot.obligation).toMatchObject({ tenderId: t.id, socialShare: 0.5, quality: 2, delivery: t.spec.minDelivery, maxLevels: t.spec.maxLevels, launchBy: 3 + LAUNCH_GRACE });
    expect(cash(s, 'a')).toBeCloseTo(startA, 0);
    expect(s.tenders.find((x) => x.id === t.id)).toMatchObject({ status: 'awarded', winner: 'b' });
    expect(s.log.some((e) => /remporte l’appel d’offres/.test(e.text) && /2 propositions/.test(e.text))).toBe(true);
    expect(s.log.some((e) => e.player === 'a' && /Vous perdez l’appel d’offres/.test(e.text))).toBe(true);
  });

  it('sans proposition l’appel d’offres est infructueux ; la commune en ouvre de nouveaux, deux au plus à la fois', () => {
    let s = make();
    const first = openTenders(s)[0];
    for (let i = 0; i < 3; i++) s = next(s);
    expect(s.tenders.find((t) => t.id === first.id)!.status).toBe('void');
    expect(s.log.some((e) => /infructueux/.test(e.text))).toBe(true);
    for (let i = 0; i < 9; i++) {
      s = next(s);
      expect(openTenders(s).length).toBeLessThanOrEqual(2);
    }
    expect(s.tenders.length).toBeGreaterThan(2);
  });
});

describe('engagements du lauréat', () => {
  const withProgramme = (s: GameState, kind: keyof typeof PROGRAMMES): GameState => ({
    ...s,
    tenders: s.tenders.map((t) => ({ ...t, spec: { ...t.spec, programme: PROGRAMMES[kind], maxLevels: Math.max(t.spec.maxLevels, 3) } })),
  });
  const won = (spec?: Partial<{ social: number; quality: 0 | 1 | 2; delivery: number; programme: keyof typeof PROGRAMMES }>) => {
    let s = withProgramme(make(), spec?.programme ?? 'npnru');
    const t = openTenders(s)[0];
    s = play(s, { type: 'tenderBid', player: 'a', tender: t.id, price: t.spec.minPrice * 1.05, socialShare: spec?.social ?? Math.max(0.3, t.spec.minSocialShare), quality: spec?.quality ?? t.spec.minQuality, delivery: spec?.delivery ?? t.spec.maxDelivery });
    s = next(next(next(s)));
    return { s, plot: s.plots.find((p) => p.id === t.plotId)!, t };
  };

  it('la hauteur de l’appel d’offres s’impose, le rez-de-chaussée commerçant aussi, et le terrain ne se revend ni ne s’assemble', () => {
    const { s, plot, t } = won();
    expect(plot.owner).toBe('a');
    const tooHigh = { ...DEFAULT_CRITERIA, levels: t.spec.maxLevels + 1 };
    expect(err(s, { type: 'launch', player: 'a', plot: plot.id, criteria: tooHigh })).toMatch(/limite la hauteur/);
    expect(err(s, { type: 'sellPlot', player: 'a', plot: plot.id })).toMatch(/engagé auprès de la commune/);
    const other = s.plots.find((p) => p.id !== plot.id && !p.municipal && !p.obligation)!;
    expect(err(s, { type: 'merge', player: 'a', plots: [plot.id, other.id] })).toBeDefined();
    const launched = play(s, { type: 'launch', player: 'a', plot: plot.id, criteria: { ...DEFAULT_CRITERIA, levels: Math.min(3, t.spec.maxLevels) } });
    expect(launched.projects[0].terms).toMatchObject({ socialShare: plot.obligation!.socialShare });
    if (t.spec.groundCommerce) expect(launched.projects[0].criteria.groundFloorUse).toBe('commerce');
  });

  it('les logements sociaux sont cédés en bloc au lancement : ils comptent dans les préventes et rapportent moins', () => {
    const { s, plot } = won({ social: 0.4 });
    const free = make();
    // même projet, terrain libre : pas de logements sociaux
    const launched = play(s, { type: 'launch', player: 'a', plot: plot.id, criteria: { ...DEFAULT_CRITERIA, levels: 3 } });
    const run = launched.projects[0];
    expect(run.socialLots).toBeGreaterThan(0);
    expect(run.lotsSold).toBe(run.socialLots);
    expect(run.soldRevenue).toBeCloseTo(run.socialRevenue, 4);
    expect(run.socialRevenue).toBeGreaterThan(0);
    const project = computeProject(plot.parcel, { ...DEFAULT_CRITERIA, levels: 3 });
    const mkt = MARKETS['petite-couronne'];
    const noSocial = computeBilan({ project, market: { ...mkt }, landPrice: 0 });
    const withSocial = computeBilan({ project, market: { ...mkt }, landPrice: 0, socialShare: 0.4 });
    expect(withSocial.revenue.housing).toBeCloseTo(noSocial.revenue.housing * (0.6 + 0.4 * SOCIAL_PRICE_RATIO), 0);
    expect(free.projects).toHaveLength(0);
  });

  it('la qualité coûte plus cher à construire mais se vend mieux', () => {
    const lotted = computeProject(lot(0), { ...DEFAULT_CRITERIA, levels: 3 });
    const m = MARKETS['petite-couronne'];
    const std = computeBilan({ project: lotted, market: m, landPrice: 0, quality: 0 });
    const eco = computeBilan({ project: lotted, market: m, landPrice: 0, quality: 2 });
    expect(eco.costs.works).toBeCloseTo(std.costs.works * QUALITY_COST[2], 0);
    expect(eco.revenue.housing).toBeCloseTo(std.revenue.housing * 1.04, 0);
  });

  it('ne pas lancer à temps : la commune reprend le terrain et garde 10 % du prix', () => {
    const { s, plot } = won();
    const price = plot.obligation!.price;
    const before = cash(s, 'a');
    let t = s;
    for (let i = 0; i < LAUNCH_GRACE; i++) t = next(t);
    const back = t.plots.find((p) => p.id === plot.id)!;
    expect(back.owner).toBeNull();
    expect(back.municipal).toBe(true);
    expect(back.obligation).toBeUndefined();
    expect(cash(t, 'a')).toBeCloseTo(before + price * 0.9, 0);
    expect(t.log.some((e) => /pas lancé son opération à temps/.test(e.text))).toBe(true);
  });

  it('livrer en retard sur le délai promis coûte des pénalités', () => {
    // promesse très serrée (5 trimestres) : permis 2 + chantier + attente de préventes la dépassent
    const { s, plot } = won({ delivery: 5 });
    let g = play(s, { type: 'launch', player: 'a', plot: plot.id, criteria: { ...DEFAULT_CRITERIA, levels: 3 } });
    let guard = 0;
    while (g.projects.length && guard++ < 40) g = next(g);
    expect(g.log.some((e) => /retard sur l’engagement pris auprès de la commune/.test(e.text))).toBe(true);
    expect(g.plots.find((p) => p.id === plot.id)!.obligation).toBeUndefined(); // engagement tenu, terrain libre
  });

  it('en cas de faillite, les propositions en cours sont rendues', () => {
    let s = make();
    const t = openTenders(s)[0];
    s = play(s, { type: 'tenderBid', player: 'a', tender: t.id, price: t.spec.minPrice * 1.2, socialShare: 0.4, quality: 1, delivery: 6 });
    s = { ...s, players: s.players.map((p) => (p.id === 'a' ? { ...p, debt: 99_000_000 } : p)) };
    s = next(s);
    expect(s.players.find((p) => p.id === 'a')!.bankrupt).toBe(true);
    expect(tenderBidOf(s.tenders.find((x) => x.id === t.id)!, 'a')).toBeUndefined();
    expect(netWorth(s, 'a')).toBe(0);
  });

  it('un terrain saisi à un lauréat en faillite retourne à la commune', () => {
    const { s, plot } = (() => {
      let g = make();
      const t = openTenders(g)[0];
      g = play(g, { type: 'tenderBid', player: 'a', tender: t.id, price: t.spec.minPrice * 1.05, socialShare: 0.4, quality: 0, delivery: t.spec.maxDelivery });
      g = next(next(next(g)));
      return { s: g, plot: g.plots.find((p) => p.id === t.plotId)! };
    })();
    expect(plot.owner).toBe('a');
    const broke = next({ ...s, players: s.players.map((p) => (p.id === 'a' ? { ...p, debt: 99_000_000 } : p)) });
    const back = broke.plots.find((p) => p.id === plot.id)!;
    expect(back.owner).toBeNull();
    expect(back.municipal).toBe(true);
    expect(back.obligation).toBeUndefined();
  });

  it('un terrain obtenu à bas prix auprès de la commune ne gonfle pas le patrimoine', () => {
    let g = make();
    const t = openTenders(g)[0];
    g = play(g, { type: 'tenderBid', player: 'a', tender: t.id, price: t.spec.minPrice * 1.05, socialShare: 0.4, quality: 0, delivery: t.spec.maxDelivery });
    const before = netWorth(g, 'a');
    g = next(next(next(g)));
    const plot = g.plots.find((p) => p.id === t.plotId)!;
    expect(plot.owner).toBe('a');
    expect(netWorth(g, 'a')).toBeLessThanOrEqual(before + 1);
  });

  it('les propositions bloquées comptent dans le patrimoine', () => {
    let s = make();
    const t = openTenders(s)[0];
    const w = netWorth(s, 'a');
    s = play(s, { type: 'tenderBid', player: 'a', tender: t.id, price: t.spec.minPrice * 1.2, socialShare: 0.4, quality: 1, delivery: 6 });
    expect(netWorth(s, 'a')).toBeCloseTo(w, 0);
  });
});

describe('concurrents et appels d’offres', () => {
  it('les bots répondent aux appels d’offres, les lauréats lancent leur opération et la partie va au bout', () => {
    const plots = Array.from({ length: 30 }, (_, i) => ({ id: `P${i}`, parcel: lot(i), askingPrice: 450_000 + (i % 5) * 30_000 }));
    let s = createGame({
      players: [{ id: 'p', name: 'P', bot: true, profile: 'prudent' }, { id: 'e', name: 'E', bot: true }, { id: 'a', name: 'A', bot: true, profile: 'agressif' }],
      plots,
      config: { market: MARKETS['petite-couronne'], rounds: 24, ...campaignConfig('normal'), startCash: 6_000_000 },
      seed: 3,
    });
    let sawBid = false;
    while (!s.over) {
      s = playBots(s);
      if (openTenders(s).some((t) => t.bids.length)) sawBid = true;
      for (const p of s.players) expect(p.cash).toBeGreaterThanOrEqual(-1e-6);
    }
    expect(sawBid).toBe(true);
    expect(s.tenders.some((t) => t.status === 'awarded')).toBe(true);
    expect(s.log.some((e) => /remporte l’appel d’offres/.test(e.text))).toBe(true);
    expect(s.projects.every((p) => !p.terms || p.terms.socialShare >= 0.2)).toBe(true);
  });
});

describe('cadres d’opération : ZAC, PUP, renouvellement urbain', () => {
  const lotted = computeProject(lot(0), { ...DEFAULT_CRITERIA, levels: 3 });
  const m = MARKETS['petite-couronne'];

  it('chaque appel d’offres annonce son cadre ; un lauréat le conserve dans ses engagements', () => {
    const s = make();
    const t = openTenders(s)[0];
    expect(['zac', 'pup', 'npnru']).toContain(t.spec.programme.kind);
    let g = play(s, { type: 'tenderBid', player: 'a', tender: t.id, price: t.spec.minPrice * 1.05, socialShare: 0.4, quality: 0, delivery: t.spec.maxDelivery });
    g = next(next(next(g)));
    expect(g.plots.find((p) => p.id === t.plotId)!.obligation!.programme).toEqual(t.spec.programme);
  });

  it('le prix de cession minimal est décoté selon le cadre : la ZAC est la moins chère', () => {
    expect(PROGRAMMES.zac.landDiscount).toBeLessThan(PROGRAMMES.npnru.landDiscount);
    expect(PROGRAMMES.npnru.landDiscount).toBeLessThan(PROGRAMMES.pup.landDiscount);
    expect(PROGRAMMES.zac.taxPerSdp).toBe(0);
  });

  it('ZAC et PUP allègent la taxe d’aménagement, le PUP accélère le permis', () => {
    const base = computeBilan({ project: lotted, market: m, landPrice: 0 });
    const zac = computeBilan({ project: lotted, market: m, landPrice: 0, params: programmeParams(DEFAULT_PARAMS, PROGRAMMES.zac) });
    const pup = computeBilan({ project: lotted, market: m, landPrice: 0, params: programmeParams(DEFAULT_PARAMS, PROGRAMMES.pup) });
    expect(zac.costs.taxes).toBe(0);
    expect(base.costs.taxes).toBeGreaterThan(pup.costs.taxes);
    expect(pup.costs.taxes).toBeGreaterThan(0);
    expect(buildDuration(lotted, programmeParams(DEFAULT_PARAMS, PROGRAMMES.pup)).permit).toBe(3);
    expect(zac.maxLandPrice).toBeGreaterThan(base.maxLandPrice);
  });

  it('la TVA réduite du renouvellement urbain fait monter les prix de vente du libre', () => {
    const base = computeBilan({ project: lotted, market: m, landPrice: 0 });
    const tva = computeBilan({ project: lotted, market: m, landPrice: 0, salesPremium: PROGRAMMES.npnru.salesPremium });
    expect(tva.revenue.housing).toBeCloseTo(base.revenue.housing * 1.05, 0);
  });

  it('en ZAC, le lauréat peut construire un étage au-dessus du PLU', () => {
    const run = (kind: keyof typeof PROGRAMMES, levels: number) => {
      let s = make();
      s = { ...s, plots: s.plots.map((p) => ({ ...p, zones: ['mixte' as const] })) };
      const t = openTenders(s)[0];
      s = { ...s, tenders: s.tenders.map((x) => ({ ...x, spec: { ...x.spec, programme: PROGRAMMES[kind], maxLevels: 5 } })) };
      s = play(s, { type: 'tenderBid', player: 'a', tender: t.id, price: s.tenders[0].spec.minPrice * 1.05, socialShare: 0.4, quality: 0, delivery: t.spec.maxDelivery });
      s = next(next(next(s)));
      return applyAction(s, { type: 'launch', player: 'a', plot: t.plotId, criteria: { ...DEFAULT_CRITERIA, levels } });
    };
    expect(run('zac', 5).ok).toBe(true); // PLU mixte : R+4 + 1 niveau de bonus
    const noBonus = run('pup', 5);
    expect(noBonus.ok).toBe(false);
  });
});
