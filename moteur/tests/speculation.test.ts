import { describe, expect, it } from 'vitest';
import { LocalProjection, MARKETS, type Parcel, type Vec2 } from '../src/engine';
import { applyAction, createGame, listPlots, type Action, type GameState } from '../src/game';

const O = new LocalProjection(2.35, 48.85);
const lot = (i: number): Parcel => ({
  ring: ([[i * 30, 0], [i * 30 + 20, 0], [i * 30 + 20, 30], [i * 30, 30]] as Vec2[]).map((p) => O.toLonLat(p)),
  streetEdges: [0],
});
const PLOTS = Array.from({ length: 40 }, (_, i) => ({ id: `S${i}`, parcel: lot(i), askingPrice: 400_000 }));
const players = [{ id: 'a', name: 'Alice' }];
const make = (share: number) =>
  createGame({ players, plots: PLOTS, config: { market: MARKETS['petite-couronne'], startCash: 8_000_000, landMarket: 'auction', speculatorShare: share, listingShare: 0, eventChance: 0, marketVolatility: 0, rateVolatility: 0, holdingCostRate: 0, reserveSpread: 0 }, seed: 3 });
const play = (s: GameState, a: Action): GameState => {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const next = (s: GameState) => play(s, { type: 'ready', player: 'a' });

describe('propriétaires spéculateurs', () => {
  it('sans spéculation configurée, personne ne spécule', () => {
    expect(make(0).plots.some((p) => p.speculator)).toBe(false);
  });

  it('une part des terrains spécule, de façon reproductible', () => {
    const a = make(0.3).plots.filter((p) => p.speculator).map((p) => p.id);
    const b = make(0.3).plots.filter((p) => p.speculator).map((p) => p.id);
    expect(a.length).toBeGreaterThan(3);
    expect(a.length).toBeLessThan(25);
    expect(a).toEqual(b);
  });

  it('leur prix affiché monte chaque trimestre, pas celui des autres ; ils ne sont jamais mis en vente', () => {
    let s = make(0.3);
    const spec = s.plots.find((p) => p.speculator)!;
    const normal = s.plots.find((p) => !p.speculator)!;
    const p0 = spec.askingPrice;
    const n0 = normal.askingPrice;
    for (let i = 0; i < 4; i++) s = next(s);
    expect(s.plots.find((p) => p.id === spec.id)!.askingPrice).toBeGreaterThan(p0 * 1.08);
    expect(s.plots.find((p) => p.id === normal.id)!.askingPrice).toBe(n0);
    s = listPlots(s, 40);
    expect(s.plots.filter((p) => p.speculator).every((p) => !p.listing)).toBe(true);
    expect(s.plots.some((p) => p.listing)).toBe(true);
  });

  it('en prospection, un spéculateur refuse une offre qui suffirait à un propriétaire ordinaire', () => {
    let s = make(0.3);
    const spec = s.plots.find((p) => p.speculator)!;
    const normal = s.plots.find((p) => !p.speculator)!;
    s = play(s, { type: 'offer', player: 'a', plot: spec.id, price: Math.round(spec.askingPrice * 1.1) });
    s = play(s, { type: 'offer', player: 'a', plot: normal.id, price: Math.round(normal.askingPrice * 1.1) });
    s = next(s);
    expect(s.plots.find((p) => p.id === normal.id)!.owner).toBe('a');
    expect(s.plots.find((p) => p.id === spec.id)!.owner).toBeNull();
    expect(s.log.some((e) => /spécule/.test(e.text))).toBe(true);
  });
});
