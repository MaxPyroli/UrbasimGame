import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA, LocalProjection, MARKETS, computeProject, type Parcel, type Vec2 } from '../src/engine';
import {
  LOCATION_RULES,
  MAX_LOCATION_FACTOR,
  MIN_LOCATION_FACTOR,
  applyAction,
  createGame,
  distanceM,
  locationFactors,
  locationParts,
  marketAt,
  type Poi,
} from '../src/game';

const O = new LocalProjection(2.35, 48.85);
const at = (x: number, y: number) => O.toLonLat([x, y]);
const poi = (kind: Poi['kind'], x: number, y: number, name: string = kind): Poi => ({ kind, name, ...at(x, y) });
const rect = (x: number, y: number, w: number, h: number): Parcel => ({
  ring: ([[x, y], [x + w, y], [x + w, y + h], [x, y + h]] as Vec2[]).map((p) => O.toLonLat(p)),
  streetEdges: [0],
});

describe('valeur selon le lieu', () => {
  it('la distance est en mètres', () => {
    expect(distanceM(at(0, 0), at(300, 400))).toBeCloseTo(500, 0);
  });

  it('l’effet est maximal au pied de l’équipement, décroît avec la distance, et s’annule au loin', () => {
    const pois = [poi('metro', 0, 0)];
    const here = locationParts(at(0, 0), pois)[0].bonus;
    const near = locationParts(at(350, 0), pois)[0].bonus;
    expect(here).toBeCloseTo(LOCATION_RULES.metro.bonus, 6);
    expect(near).toBeCloseTo(here / Math.E, 2);
    expect(locationParts(at(1500, 0), pois)).toEqual([]);
  });

  it('seul l’équipement le plus proche de chaque type compte', () => {
    const parts = locationParts(at(0, 0), [poi('metro', 100, 0, 'proche'), poi('metro', 800, 0, 'loin'), poi('mairie', 50, 0)]);
    expect(parts.filter((p) => p.kind === 'metro')).toHaveLength(1);
    expect(parts.find((p) => p.kind === 'metro')!.name).toBe('proche');
    expect(parts).toHaveLength(2);
  });

  it('les coefficients sont normalisés : la parcelle médiane vaut 1, bornés, plus haut près d’un métro', () => {
    const points = [0, 100, 200, 400, 800, 1500].map((x) => at(x, 0));
    const f = locationFactors(points, [poi('metro', 0, 0)]);
    expect(f[0]).toBeGreaterThan(f[1]);
    expect(f[1]).toBeGreaterThan(f[3]);
    expect(f.every((x) => x >= MIN_LOCATION_FACTOR && x <= MAX_LOCATION_FACTOR)).toBe(true);
    const odd = locationFactors([at(0, 0), at(0, 10), at(5000, 0)], [poi('metro', 0, 0)]);
    expect(odd[1]).toBeCloseTo(1, 1); // médian (3 points : le 2e en valeur)
    expect(locationFactors([], [])).toEqual([]);
  });

  it('marketAt ne touche que les prix de vente', () => {
    const m = MARKETS['petite-couronne'];
    const x = marketAt(m, 1.1);
    expect(x.housingPerShab).toBeCloseTo(m.housingPerShab * 1.1, 6);
    expect(x.parkingBasementSpace).toBeCloseTo(m.parkingBasementSpace * 1.1, 6);
    expect(x.buildHousingPerSdp).toBe(m.buildHousingPerSdp);
    expect(x.fixedCostPerOperation).toBe(m.fixedCostPerOperation);
    expect(marketAt(m, 1)).toBe(m);
  });

  const game = (f: number) =>
    createGame({
      players: [{ id: 'a', name: 'A' }],
      plots: [{ id: 'X', parcel: rect(0, 0, 12, 30), locationFactor: f }, { id: 'Y', parcel: rect(12, 0, 12, 30), locationFactor: f }],
      config: { market: MARKETS['petite-couronne'], startCash: 10_000_000, eventChance: 0 },
    });

  it('un meilleur emplacement renchérit le terrain (la hausse des prix de vente se reporte sur le foncier, en l’amplifiant)', () => {
    const base = game(1).plots[0].askingPrice;
    const better = game(1.08).plots[0].askingPrice;
    expect(better).toBeGreaterThan(base * 1.15);
  });

  it('le bilan d’un projet suit l’emplacement : chiffre d’affaires proportionnel, coûts inchangés', () => {
    const run = (f: number) => {
      let s = game(f);
      const bought = applyAction(s, { type: 'buy', player: 'a', plot: 'X' });
      if (!bought.ok) throw new Error(bought.error);
      const r = applyAction(bought.state, { type: 'launch', player: 'a', plot: 'X', criteria: { ...DEFAULT_CRITERIA, levels: 3 } });
      if (!r.ok) throw new Error(r.error);
      s = r.state;
      return s.projects[0].bilan;
    };
    const lo = run(1);
    const hi = run(1.1);
    expect(hi.revenue.total).toBeCloseTo(lo.revenue.total * 1.1, 0);
    expect(hi.costs.works).toBeCloseTo(lo.costs.works, 4);
  });

  it('l’assemblage moyenne les coefficients, pondérés par la surface', () => {
    let s = createGame({
      players: [{ id: 'a', name: 'A' }],
      plots: [{ id: 'X', parcel: rect(0, 0, 10, 30), locationFactor: 1.1 }, { id: 'Y', parcel: rect(10, 0, 30, 30), locationFactor: 0.9 }],
      config: { market: MARKETS['petite-couronne'], startCash: 10_000_000 },
    });
    for (const id of ['X', 'Y']) {
      const r = applyAction(s, { type: 'buy', player: 'a', plot: id });
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    }
    const m = applyAction(s, { type: 'merge', player: 'a', plots: ['X', 'Y'] });
    if (!m.ok) throw new Error(m.error);
    // 300 m² à 1,1 et 900 m² à 0,9 : (330 + 810) / 1200 = 0,95
    expect(m.state.plots[0].locationFactor).toBeCloseTo(0.95, 2);
    expect(computeProject(m.state.plots[0].parcel, DEFAULT_CRITERIA).parcelArea).toBeCloseTo(1200, 0);
  });
});
