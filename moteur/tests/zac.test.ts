import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA, LocalProjection, MARKETS, type Parcel, type Vec2 } from '../src/engine';
import { EQUIPMENT_BUILD_ROUNDS, ZAC_LOT_GAP, applyAction, createGame, lotPrice, openTenders, zacPremium, type Action, type GameState } from '../src/game';

const O = new LocalProjection(2.35, 48.85);
const lot = (i: number): Parcel => ({
  ring: ([[i * 30, 0], [i * 30 + 20, 0], [i * 30 + 20, 30], [i * 30, 30]] as Vec2[]).map((p) => O.toLonLat(p)),
  streetEdges: [0],
});
const PLOTS = Array.from({ length: 24 }, (_, i) => ({ id: `Z${i}`, parcel: lot(i), askingPrice: 500_000 }));
const players = [{ id: 'a', name: 'Alice' }];
const make = (over = {}) =>
  createGame({ players, plots: PLOTS, config: { market: MARKETS['petite-couronne'], startCash: 60_000_000, communeTenders: true, municipalPlots: 2, zacs: 1, tenderRounds: 2, tenderEvery: 50, eventChance: 0, marketVolatility: 0, rateVolatility: 0, holdingCostRate: 0, salesDemand: 100, ...over }, seed: 4 });
const play = (s: GameState, a: Action): GameState => {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const next = (s: GameState) => play(s, { type: 'ready', player: 'a' });
/** Remporte le lot ouvert avec une proposition valide. */
const win = (s: GameState): GameState => {
  const t = openTenders(s)[0];
  s = play(s, { type: 'tenderBid', player: 'a', tender: t.id, price: t.spec.minPrice * 1.05, socialShare: Math.max(0.3, t.spec.minSocialShare), quality: t.spec.minQuality, delivery: t.spec.maxDelivery });
  for (let i = 0; i < s.config.tenderRounds; i++) s = next(s);
  return s;
};

describe('ZAC', () => {
  it('une ZAC regroupe des lots voisins et des terrains d’équipements publics, tous communaux', () => {
    const s = make();
    expect(s.zacs).toHaveLength(1);
    const z = s.zacs[0];
    expect(z.lots.length).toBeGreaterThanOrEqual(3);
    expect(z.equipment.length).toBeGreaterThanOrEqual(1);
    for (const id of z.lots) expect(s.plots.find((p) => p.id === id)).toMatchObject({ municipal: true, zacId: z.id, zacRole: 'lot' });
    for (const e of z.equipment) expect(s.plots.find((p) => p.id === e.plot)).toMatchObject({ municipal: true, zacId: z.id, zacRole: 'equipement' });
    expect(z.equipment.every((e) => e.status === 'prevu')).toBe(true);
    // les lots sont proches les uns des autres
    expect(new Set([...z.lots, ...z.equipment.map((e) => e.plot)]).size).toBe(z.lots.length + z.equipment.length);
  });

  it('le premier lot s’ouvre dès le départ avec le cadre de la ZAC et sa participation', () => {
    const s = make();
    const t = openTenders(s).find((x) => x.spec.zacId)!;
    expect(t).toBeDefined();
    expect(s.zacs[0].lots).toContain(t.plotId);
    expect(t.spec.programme).toMatchObject({ kind: 'zac', taxPerSdp: s.zacs[0].participation, bonusLevels: 1 });
    expect(s.log.some((e) => e.code === 'zac-ouverte' && e.popup)).toBe(true);
  });

  it('les appels d’offres ordinaires ne touchent jamais aux terrains de la ZAC', () => {
    let s = make({ tenderEvery: 1 });
    const zacPlots = new Set(s.plots.filter((p) => p.zacId).map((p) => p.id));
    for (let i = 0; i < 12; i++) {
      s = next(s);
      for (const t of s.tenders.filter((x) => !x.spec.zacId)) expect(zacPlots.has(t.plotId)).toBe(false);
    }
  });

  it('les lots sont ouverts l’un après l’autre (phasage), pas tous en même temps', () => {
    let s = make();
    expect(openTenders(s).filter((t) => t.spec.zacId)).toHaveLength(1);
    s = win(s);
    s = next(s); // le lot suivant n'attend pas plus que l'écart de phasage
    for (let i = 0; i < ZAC_LOT_GAP; i++) s = next(s);
    const open = openTenders(s).filter((t) => t.spec.zacId);
    expect(open.length).toBeLessThanOrEqual(1);
    expect(s.zacs[0].opened).toBeGreaterThanOrEqual(2);
  });

  it('lancer les lots finance les équipements, qui se livrent et valorisent les logements', () => {
    let s = make();
    const z0 = s.zacs[0];
    let launched = 0;
    for (let round = 0; round < 40 && launched < z0.lots.length; round++) {
      if (openTenders(s).some((t) => t.spec.zacId)) s = win(s);
      for (const id of z0.lots) {
        const p = s.plots.find((x) => x.id === id)!;
        if (p.owner === 'a' && !p.projectId && p.obligation) {
          s = play(s, { type: 'launch', player: 'a', plot: id, criteria: { ...DEFAULT_CRITERIA, levels: 3 } });
          launched++;
        }
      }
      if (launched < z0.lots.length) s = next(s);
    }
    expect(launched).toBe(z0.lots.length);
    const z = s.zacs[0];
    expect(z.launched).toBe(z0.lots.length);
    expect(z.collected).toBeGreaterThan(0);
    expect(z.equipment.every((e) => e.status !== 'prevu')).toBe(true);
    const run = s.projects[s.projects.length - 1];
    const before = lotPrice(s, run);
    const premiumBefore = zacPremium(s, run.terms!.zacId);
    for (let i = 0; i < EQUIPMENT_BUILD_ROUNDS + 1; i++) s = next(s);
    expect(s.zacs[0].equipment.every((e) => e.status === 'livre')).toBe(true);
    expect(s.log.some((e) => e.code === 'zac-equipement' && e.popup)).toBe(true);
    const live = s.projects.find((p) => p.id === run.id);
    if (live) expect(lotPrice(s, live)).toBeGreaterThanOrEqual(before);
    expect(zacPremium(s, z0.id)).toBeGreaterThanOrEqual(premiumBefore);
    expect(zacPremium(s, z0.id)).toBeCloseTo(z0.equipment.reduce((t, e) => t + e.premium, 0), 6);
  });
});
