import { describe, expect, it } from 'vitest';
import { LocalProjection, MARKETS, type Parcel, type Vec2 } from '../src/engine';
import { applyAction, createGame, type Action, type GameState } from '../src/game';

const O = new LocalProjection(2.35, 48.85);
/** Parcelles contiguës de 20 m de large : elles s'assemblent. */
const lot = (i: number): Parcel => ({
  ring: ([[i * 20, 0], [i * 20 + 20, 0], [i * 20 + 20, 30], [i * 20, 30]] as Vec2[]).map((p) => O.toLonLat(p)),
  streetEdges: [0],
});
const PLOTS = Array.from({ length: 10 }, (_, i) => ({ id: `G${i}`, parcel: lot(i), askingPrice: 300_000 }));
const players = [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }];
const make = () =>
  createGame({ players, plots: PLOTS, config: { market: MARKETS['petite-couronne'], startCash: 6_000_000, landMarket: 'auction', listingShare: 0, reserveSpread: 0, speculatorShare: 0, communeTenders: false, eventChance: 0, marketVolatility: 0, rateVolatility: 0, holdingCostRate: 0 }, seed: 2 });
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
const price = (s: GameState, id: string, k = 1.1) => Math.round(s.plots.find((p) => p.id === id)!.askingPrice * k);
const owner = (s: GameState, id: string) => s.plots.find((p) => p.id === id)?.owner;

describe('offre groupée « tout ou rien »', () => {
  it('une offre groupée bloque la somme de toutes les offres et les lie', () => {
    let s = make();
    const start = s.players[0].cash;
    s = play(s, { type: 'bundleOffer', player: 'a', offers: [{ plot: 'G0', price: price(s, 'G0') }, { plot: 'G1', price: price(s, 'G1') }] });
    const mine = s.offers.filter((o) => o.player === 'a');
    expect(mine).toHaveLength(2);
    expect(new Set(mine.map((o) => o.bundle)).size).toBe(1);
    expect(mine[0].bundle).toBeDefined();
    expect(s.players[0].cash).toBeLessThan(start - 600_000);
  });

  it('si toutes les offres sont remportées, les parcelles sont assemblées d’office', () => {
    let s = make();
    s = play(s, { type: 'bundleOffer', player: 'a', offers: [{ plot: 'G0', price: price(s, 'G0') }, { plot: 'G1', price: price(s, 'G1') }, { plot: 'G2', price: price(s, 'G2') }] });
    s = next(s);
    expect(s.plots.find((p) => p.id === 'G0+G1+G2')).toMatchObject({ owner: 'a' });
    expect(s.plots.some((p) => ['G0', 'G1', 'G2'].includes(p.id))).toBe(false);
    expect(s.offers).toHaveLength(0);
    expect(s.log.some((e) => e.code === 'groupe-remporte' && e.popup)).toBe(true);
    expect(s.log.some((e) => /assemblées en un seul terrain/.test(e.text))).toBe(true);
  });

  it('si un concurrent l’emporte sur une parcelle, aucune n’est achetée et tout est remboursé', () => {
    let s = make();
    const start = s.players[0].cash;
    s = play(s, { type: 'bundleOffer', player: 'a', offers: [{ plot: 'G0', price: price(s, 'G0') }, { plot: 'G1', price: price(s, 'G1') }] });
    s = play(s, { type: 'offer', player: 'b', plot: 'G1', price: price(s, 'G1', 1.5) });
    s = next(s);
    expect(owner(s, 'G0')).toBeNull();
    expect(owner(s, 'G1')).toBe('b');
    expect(s.offers).toHaveLength(0);
    // seuls les frais de prospection (non remboursés) sont perdus
    expect(s.players[0].cash).toBeGreaterThan(start - 20_000);
    expect(s.players[0].cash).toBeLessThan(start);
    expect(s.log.some((e) => e.code === 'groupe-perdu' && e.popup && e.player === 'a')).toBe(true);
  });

  it('une parcelle abandonnée par une offre groupée tombée revient à l’autre offrant', () => {
    let s = make();
    s = play(s, { type: 'bundleOffer', player: 'a', offers: [{ plot: 'G0', price: price(s, 'G0', 1.4) }, { plot: 'G1', price: price(s, 'G1', 1.4) }] });
    // Bob offre peu sur G0 (suffisant seul) et beaucoup sur G1 : il emporte G1, donc le groupe d'Alice tombe et il récupère G0 aussi
    s = play(s, { type: 'offer', player: 'b', plot: 'G0', price: price(s, 'G0', 1.05) });
    s = play(s, { type: 'offer', player: 'b', plot: 'G1', price: price(s, 'G1', 1.8) });
    s = next(s);
    expect(owner(s, 'G0')).toBe('b');
    expect(owner(s, 'G1')).toBe('b');
  });

  it('retirer une offre du groupe retire tout le groupe', () => {
    let s = make();
    const start = s.players[0].cash;
    s = play(s, { type: 'bundleOffer', player: 'a', offers: [{ plot: 'G0', price: price(s, 'G0') }, { plot: 'G1', price: price(s, 'G1') }] });
    s = play(s, { type: 'withdraw', player: 'a', plot: 'G0' });
    expect(s.offers).toHaveLength(0);
    expect(s.players[0].cash).toBeGreaterThan(start - 20_000);
  });

  it('refuse les groupes mal formés', () => {
    const s = make();
    expect(err(s, { type: 'bundleOffer', player: 'a', offers: [{ plot: 'G0', price: price(s, 'G0') }] })).toMatch(/au moins deux/);
    expect(err(s, { type: 'bundleOffer', player: 'a', offers: [{ plot: 'G0', price: 1000 }, { plot: 'G1', price: price(s, 'G1') }] })).toMatch(/G0/);
    const one = play(s, { type: 'offer', player: 'a', plot: 'G0', price: price(s, 'G0') });
    expect(err(one, { type: 'bundleOffer', player: 'a', offers: [{ plot: 'G0', price: price(s, 'G0') }, { plot: 'G1', price: price(s, 'G1') }] })).toMatch(/déjà une offre/);
  });

  it('les terrains d’un groupe doivent être tranchés en même temps', () => {
    let s = make();
    s = { ...s, plots: s.plots.map((p) => (p.id === 'G1' ? { ...p, listing: { until: s.round + 3, minPrice: p.askingPrice } } : p)) };
    expect(err(s, { type: 'bundleOffer', player: 'a', offers: [{ plot: 'G0', price: price(s, 'G0') }, { plot: 'G1', price: price(s, 'G1') }] })).toMatch(/même moment/);
  });
});

describe('offre groupée avec des parcelles déjà possédées', () => {
  it('une parcelle déjà à moi est assemblée avec celles remportées', () => {
    let s = make();
    s = play(s, { type: 'offer', player: 'a', plot: 'G0', price: price(s, 'G0') });
    s = next(s);
    expect(owner(s, 'G0')).toBe('a');
    s = play(s, { type: 'bundleOffer', player: 'a', offers: [{ plot: 'G1', price: price(s, 'G1') }], extra: ['G0'] });
    s = next(s);
    expect(s.plots.find((p) => p.id === 'G0+G1')).toMatchObject({ owner: 'a' });
  });

  it('refuse une parcelle supplémentaire qui n’est pas à moi, et une seule parcelle sans rien d’autre', () => {
    const s = make();
    expect(err(s, { type: 'bundleOffer', player: 'a', offers: [{ plot: 'G1', price: price(s, 'G1') }], extra: ['G0'] })).toMatch(/posséder/);
    expect(err(s, { type: 'bundleOffer', player: 'a', offers: [{ plot: 'G1', price: price(s, 'G1') }] })).toMatch(/au moins deux/);
  });
});
