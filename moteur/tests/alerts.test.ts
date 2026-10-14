import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA, LocalProjection, MARKETS, type Parcel, type Vec2 } from '../src/engine';
import { applyAction, createGame, openTenders, relevantEvents, roundsToDelivery, watchList, type Action, type GameState } from '../src/game';

const O = new LocalProjection(2.35, 48.85);
const lot = (i: number): Parcel => ({
  ring: ([[i * 30, 0], [i * 30 + 20, 0], [i * 30 + 20, 30], [i * 30, 30]] as Vec2[]).map((p) => O.toLonLat(p)),
  streetEdges: [0],
});
const PLOTS = Array.from({ length: 8 }, (_, i) => ({ id: `T${i}`, parcel: lot(i), askingPrice: 500_000 }));
const players = [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }];
const make = (over = {}) =>
  createGame({ players, plots: PLOTS, config: { market: MARKETS['petite-couronne'], startCash: 6_000_000, communeTenders: true, municipalPlots: 2, tenderRounds: 3, tenderEvery: 3, eventChance: 0, marketVolatility: 0, rateVolatility: 0, holdingCostRate: 0, salesDemand: 100, ...over }, seed: 5 });
const play = (s: GameState, a: Action): GameState => {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const next = (s: GameState) => players.reduce((st, p) => (st.over ? st : play(st, { type: 'ready', player: p.id })), s);

describe('notifications', () => {
  it('les aléas portent leur famille, leur code et demandent une fenêtre', () => {
    let s = make({ eventChance: 1, landMarket: 'instant', communeTenders: false });
    s = play(s, { type: 'buy', player: 'a', plot: 'T0' });
    s = play(s, { type: 'launch', player: 'a', plot: 'T0', criteria: { ...DEFAULT_CRITERIA, levels: 3 } });
    for (let i = 0; i < 30 && !s.over; i++) s = next(s);
    const alea = s.log.filter((e) => e.kind === 'alea');
    expect(alea.length).toBeGreaterThan(3);
    expect(alea.every((e) => e.popup && e.code && (e.tone === 'good' || e.tone === 'bad'))).toBe(true);
    expect(new Set(alea.map((e) => e.code)).size).toBeGreaterThan(1);
    expect(alea.filter((e) => e.player).every((e) => e.ref?.project)).toBe(true);
  });

  it('seuls les événements du joueur et les annonces publiques le concernent', () => {
    let s = make();
    const t = openTenders(s)[0];
    s = play(s, { type: 'tenderBid', player: 'a', tender: t.id, price: t.spec.minPrice * 1.05, socialShare: 0.4, quality: 0, delivery: t.spec.maxDelivery });
    s = next(next(next(s)));
    const mineA = relevantEvents(s, 'a');
    const mineB = relevantEvents(s, 'b');
    expect(mineA.some((e) => e.code === 'ao-gagne' && e.popup)).toBe(true);
    expect(mineB.some((e) => e.code === 'ao-gagne')).toBe(true); // annonce publique de la commune
    expect(mineB.some((e) => e.code === 'ao-ouvert')).toBe(true);
    expect(mineB.every((e) => e.player !== 'a' || e.kind === 'commune')).toBe(true);
  });
});

describe('à surveiller', () => {
  it('un appel d’offres ouvert est signalé avec sa barre, puis le délai pour lancer, puis la livraison promise', () => {
    let s = make();
    const t = openTenders(s)[0];
    let w = watchList(s, 'a');
    expect(w.find((x) => x.id === `tender:${t.id}`)?.progress).toMatchObject({ value: 0, max: 3 });
    s = play(s, { type: 'tenderBid', player: 'a', tender: t.id, price: t.spec.minPrice * 1.05, socialShare: 0.4, quality: 0, delivery: t.spec.maxDelivery });
    expect(watchList(s, 'a').find((x) => x.id === `tender:${t.id}`)?.detail).toMatch(/déposée/);
    s = next(next(next(s)));
    w = watchList(s, 'a');
    const launch = w.find((x) => x.id === `launch:${t.plotId}`)!;
    expect(launch.progress).toMatchObject({ value: 0, max: 3 });
    expect(launch.tone).toBe('info');
    s = next(s);
    expect(watchList(s, 'a').find((x) => x.id === `launch:${t.plotId}`)!.progress!.value).toBe(1);
    expect(watchList(s, 'a').find((x) => x.id === `launch:${t.plotId}`)!.tone).toBe('warn');
    s = next(s);
    expect(watchList(s, 'a').find((x) => x.id === `launch:${t.plotId}`)!.tone).toBe('bad');
    s = play(s, { type: 'launch', player: 'a', plot: t.plotId, criteria: { ...DEFAULT_CRITERIA, levels: 3 } });
    w = watchList(s, 'a');
    expect(w.some((x) => x.id.startsWith('launch:'))).toBe(false);
    const d = w.find((x) => x.id.startsWith('delivery:'))!;
    expect(d.progress!.max).toBe(t.spec.maxDelivery);
    expect(d.progress!.value).toBe(0);
    expect(w.find((x) => x.id.startsWith('presales:'))!.progress!.max).toBeGreaterThan(0);
    expect(roundsToDelivery(s.projects[0])).toBeGreaterThan(0);
  });

  it('une livraison qui dépassera le délai promis est annoncée en retard', () => {
    let s = make();
    const t = openTenders(s)[0];
    s = { ...s, tenders: s.tenders.map((x) => ({ ...x, spec: { ...x.spec, minDelivery: 2, maxDelivery: 3 } })) };
    s = play(s, { type: 'tenderBid', player: 'a', tender: t.id, price: t.spec.minPrice * 1.05, socialShare: 0.4, quality: 0, delivery: 3 });
    s = next(next(next(s)));
    s = play(s, { type: 'launch', player: 'a', plot: t.plotId, criteria: { ...DEFAULT_CRITERIA, levels: 3 } });
    const d = watchList(s, 'a').find((x) => x.id.startsWith('delivery:'))!;
    expect(d.tone).toBe('bad');
    expect(d.progress!.late).toBe(true);
  });

  it('un découvert est signalé en premier', () => {
    let s = make();
    s = { ...s, players: s.players.map((p) => (p.id === 'a' ? { ...p, debt: 1000 } : p)) };
    expect(watchList(s, 'a')[0]).toMatchObject({ id: 'debt', tone: 'bad' });
    expect(watchList(s, 'b').some((x) => x.id === 'debt')).toBe(false);
  });
});
