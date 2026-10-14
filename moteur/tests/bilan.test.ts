import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA, LocalProjection, MARKETS, computeBilan, computeProject, suggestLandPrice, type Parcel, type Vec2 } from '../src/engine';

const O = new LocalProjection(2.35, 48.85);
const strip = (): Parcel => ({
  ring: ([[0, 0], [10, 0], [10, 30], [0, 30]] as Vec2[]).map((p) => O.toLonLat(p)),
  streetEdges: [0],
});
const project = (levels = 4) => computeProject(strip(), { ...DEFAULT_CRITERIA, levels });

describe('bilan du promoteur', () => {
  const pr = project();

  it('le chiffre d’affaires et les coûts sont cohérents avec le projet', () => {
    const b = computeBilan({ project: pr, market: MARKETS['petite-couronne'], landPrice: 800_000 });
    expect(b.revenue.housing).toBeCloseTo(pr.indicators.shab * MARKETS['petite-couronne'].housingPerShab, 0);
    const c = b.costs;
    const sum = c.land + c.acquisitionFees + c.demolition + c.works + c.fixed + c.design + c.insurance + c.contingency + c.taxes + c.salesFees + c.overhead + c.financing;
    expect(c.total).toBeCloseTo(sum, 4);
    expect(b.margin).toBeCloseTo(b.revenue.total - c.total, 4);
    expect(b.quarters).toBe(Math.ceil(b.months / 3));
  });

  it('un terrain plus cher réduit la marge, un marché plus cher l’augmente', () => {
    const m = MARKETS['grande-ville'];
    const cheap = computeBilan({ project: pr, market: m, landPrice: 300_000 });
    const dear = computeBilan({ project: pr, market: m, landPrice: 600_000 });
    expect(dear.margin).toBeLessThan(cheap.margin);
    const richer = computeBilan({ project: pr, market: { ...m, housingPerShab: m.housingPerShab * 1.2 }, landPrice: 300_000 });
    expect(richer.margin).toBeGreaterThan(cheap.margin);
  });

  it('la démolition coûte, les frais financiers croissent avec le taux', () => {
    const m = MARKETS['grande-ville'];
    const base = computeBilan({ project: pr, market: m, landPrice: 400_000 });
    const demol = computeBilan({ project: pr, market: m, landPrice: 400_000, existingSdp: 300 });
    expect(demol.costs.demolition).toBeCloseTo(300 * m.demolitionPerSdp, 4);
    expect(demol.margin).toBeLessThan(base.margin);
    const hi = computeBilan({ project: pr, market: m, landPrice: 400_000, params: { interestRate: 0.09 } });
    expect(hi.costs.financing).toBeCloseTo(base.costs.financing * 2, 3);
  });

  it('le prix de terrain maximal donne exactement la marge visée', () => {
    const m = MARKETS['petite-couronne'];
    const probe = computeBilan({ project: pr, market: m, landPrice: 0 });
    const at = computeBilan({ project: pr, market: m, landPrice: probe.maxLandPrice });
    expect(at.marginRate).toBeCloseTo(0.1, 3);
    expect(at.viable).toBe(true);
    expect(computeBilan({ project: pr, market: m, landPrice: probe.maxLandPrice + 100_000 }).viable).toBe(false);
  });

  it('le seuil de rentabilité annule la marge', () => {
    const m = MARKETS['grande-ville'];
    const b = computeBilan({ project: pr, market: m, landPrice: 500_000 });
    const be = computeBilan({ project: pr, market: { ...m, housingPerShab: b.breakEvenHousingPerShab }, landPrice: 500_000 });
    expect(be.margin / be.revenue.total).toBeCloseTo(0, 6);
  });

  it('le sous-sol allonge le chantier ; un terrain sans bâtiment constructible ne rapporte rien', () => {
    const m = MARKETS['grande-ville'];
    const tall = computeBilan({ project: project(6), market: m, landPrice: 0 });
    const low = computeBilan({ project: project(1), market: m, landPrice: 0 });
    expect(tall.months).toBeGreaterThan(low.months);
    const none = computeProject(strip(), { ...DEFAULT_CRITERIA, setbackLateral: 6 });
    const b = computeBilan({ project: none, market: m, landPrice: 100_000 });
    expect(b.revenue.total).toBe(0);
    expect(b.viable).toBe(false);
  });

  it('ordres de grandeur : le prix suggéré du terrain donne une marge plausible', () => {
    for (const id of ['paris', 'petite-couronne', 'grande-ville', 'ville-moyenne'] as const) {
      const m = MARKETS[id];
      const b = computeBilan({ project: pr, market: m, landPrice: suggestLandPrice(pr, m) });
      expect(b.marginRate).toBeGreaterThan(-0.1);
      expect(b.marginRate).toBeLessThan(0.25);
    }
  });

  it('les coûts fixes pèsent d’autant plus que l’opération est petite (raison économique des micro-projets déficitaires)', () => {
    const m = MARKETS['petite-couronne'];
    const lot = (w: number): Parcel => ({ ring: ([[0, 0], [w, 0], [w, 20], [0, 20]] as Vec2[]).map((p) => O.toLonLat(p)), streetEdges: [0] });
    const small = computeProject(lot(6), { ...DEFAULT_CRITERIA, levels: 1, parkingStrategy: 'aucun' });
    const large = computeProject(lot(30), { ...DEFAULT_CRITERIA, levels: 4, parkingStrategy: 'aucun' });
    const bs = computeBilan({ project: small, market: m, landPrice: 0 });
    const bl = computeBilan({ project: large, market: m, landPrice: 0 });
    expect(bs.costs.fixed).toBe(m.fixedCostPerOperation);
    expect(bl.costs.fixed).toBe(m.fixedCostPerOperation);
    // Une petite opération peut payer beaucoup moins cher son terrain, au m² de plancher construit.
    expect(bs.maxLandPrice / small.indicators.sdpTotal).toBeLessThan(0.5 * (bl.maxLandPrice / large.indicators.sdpTotal));
    expect(bl.margin).toBeGreaterThan(0);
    expect(bs.costs.fixed / bs.revenue.total).toBeGreaterThan(5 * (bl.costs.fixed / bl.revenue.total));
    // Sans bâtiment, pas de coûts fixes.
    const none = computeProject(lot(6), { ...DEFAULT_CRITERIA, setbackLateral: 4 });
    expect(computeBilan({ project: none, market: m, landPrice: 0 }).costs.fixed).toBe(0);
  });
});
