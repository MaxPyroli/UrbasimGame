import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA, LocalProjection, MARKETS, computeProject, multiArea, toMulti, type Parcel, type Vec2 } from '../src/engine';
import { applyAction, createGame, mergeParcels, type Action, type GameState } from '../src/game';

const O = new LocalProjection(2.35, 48.85);
const rect = (x: number, y: number, w: number, h: number): Parcel => ({
  ring: ([[x, y], [x + w, y], [x + w, y + h], [x, y + h]] as Vec2[]).map((p) => O.toLonLat(p)),
  streetEdges: [0],
});
/** Même rectangle, mais avec un jour de 8 cm avec son voisin (écart de numérisation du cadastre). */
const gap = (x: number, y: number, w: number, h: number) => rect(x + 0.08, y, w - 0.08, h);

describe('assemblage de parcelles', () => {
  it('deux lots mitoyens donnent un seul contour dont la surface est la somme', () => {
    const r = mergeParcels([rect(0, 0, 10, 30), rect(10, 0, 8, 30)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.area).toBeCloseTo(18 * 30, 0);
    expect(r.parcel.ring.length).toBeLessThanOrEqual(6);
    // La façade sur rue (au sud) fait 18 m : la ou les arêtes sur rue totalisent cette longueur.
    expect(r.parcel.streetEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('tolère un jour de quelques centimètres entre les lots', () => {
    const r = mergeParcels([rect(0, 0, 10, 30), gap(10, 0, 8, 30)]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.area).toBeGreaterThan(18 * 30 * 0.98);
  });

  it('refuse des lots qui ne se touchent pas, ou seulement par un coin', () => {
    expect(mergeParcels([rect(0, 0, 10, 30), rect(20, 0, 10, 30)])).toMatchObject({ ok: false });
    expect(mergeParcels([rect(0, 0, 10, 10), rect(10, 10, 10, 10)])).toMatchObject({ ok: false });
    expect(mergeParcels([rect(0, 0, 10, 10)])).toMatchObject({ ok: false });
  });

  it('refuse un assemblage qui enfermerait une cour', () => {
    const ring = [rect(0, 0, 30, 10), rect(0, 10, 10, 10), rect(20, 10, 10, 10), rect(0, 20, 30, 10)];
    expect(mergeParcels(ring)).toMatchObject({ ok: false });
  });

  it('un coin de rue : les deux façades restent des façades sur rue', () => {
    const a = { ...rect(0, 0, 10, 20), streetEdges: [0, 3] }; // sud + ouest
    const b = { ...rect(10, 0, 10, 20), streetEdges: [0, 1] }; // sud + est
    const r = mergeParcels([a, b]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.parcel.streetEdges.length).toBeGreaterThanOrEqual(3);
  });

  it('un grand ensemble se construit mieux qu’une lanière : plus de surface de plancher', () => {
    const strip = computeProject(rect(0, 0, 5, 25), { ...DEFAULT_CRITERIA, levels: 3 });
    const m = mergeParcels([rect(0, 0, 5, 25), rect(5, 0, 5, 25), rect(10, 0, 5, 25), rect(15, 0, 5, 25)]);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    const big = computeProject(m.parcel, { ...DEFAULT_CRITERIA, levels: 3 });
    expect(big.indicators.sdpTotal).toBeGreaterThan(3 * strip.indicators.sdpTotal);
    expect(multiArea(toMulti(big.parcelRing))).toBeCloseTo(20 * 25, 0);
  });
});

describe('action merge', () => {
  const newGame = () =>
    createGame({
      players: [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }],
      plots: [{ id: 'T1', parcel: rect(0, 0, 10, 30) }, { id: 'T2', parcel: rect(10, 0, 10, 30) }, { id: 'T3', parcel: rect(40, 0, 10, 30) }],
      config: { market: MARKETS['petite-couronne'], startCash: 5_000_000, eventChance: 0 },
    });
  const play = (s: GameState, a: Action) => {
    const r = applyAction(s, a);
    if (!r.ok) throw new Error(r.error);
    return r.state;
  };
  const err = (s: GameState, a: Action) => {
    const r = applyAction(s, a);
    if (r.ok) throw new Error('action acceptée à tort');
    return r.error;
  };

  it('remplace les deux parcelles par une seule, au même propriétaire, avec le coût total conservé', () => {
    let s = newGame();
    s = play(play(s, { type: 'buy', player: 'a', plot: 'T1' }), { type: 'buy', player: 'a', plot: 'T2' });
    const paid = s.plots.filter((p) => p.owner === 'a').reduce((t, p) => t + p.paid, 0);
    s = play(s, { type: 'merge', player: 'a', plots: ['T2', 'T1'] });
    expect(s.plots.map((p) => p.id).sort()).toEqual(['T1+T2', 'T3']);
    const m = s.plots.find((p) => p.id === 'T1+T2')!;
    expect(m.owner).toBe('a');
    expect(m.paid).toBeCloseTo(paid, 4);
    expect(m.parts).toEqual(['T1', 'T2']);
    expect(m.askingPrice).toBeGreaterThan(0);
  });

  it('exige de posséder toutes les parcelles, qu’elles se touchent et qu’aucune opération ne soit en cours', () => {
    let s = newGame();
    s = play(play(s, { type: 'buy', player: 'a', plot: 'T1' }), { type: 'buy', player: 'b', plot: 'T2' });
    expect(err(s, { type: 'merge', player: 'a', plots: ['T1', 'T2'] })).toMatch(/posséder/);
    s = play(s, { type: 'buy', player: 'a', plot: 'T3' });
    expect(err(s, { type: 'merge', player: 'a', plots: ['T1', 'T3'] })).toMatch(/toucher/);
    expect(err(s, { type: 'merge', player: 'a', plots: ['T1'] })).toMatch(/deux/);
    const launched = play(s, { type: 'launch', player: 'a', plot: 'T1', criteria: { ...DEFAULT_CRITERIA, levels: 2 } });
    expect(err(launched, { type: 'merge', player: 'a', plots: ['T1', 'T3'] })).toMatch(/en cours/);
  });

  it('on peut lancer une opération sur l’assemblage, et il se réassemble avec d’autres', () => {
    let s = newGame();
    s = play(play(s, { type: 'buy', player: 'a', plot: 'T1' }), { type: 'buy', player: 'a', plot: 'T2' });
    s = play(s, { type: 'merge', player: 'a', plots: ['T1', 'T2'] });
    s = play(s, { type: 'launch', player: 'a', plot: 'T1+T2', criteria: { ...DEFAULT_CRITERIA, levels: 4 } });
    expect(s.projects[0].sdp).toBeGreaterThan(900);
  });

  it('un terrain trop petit ne se lance pas seul ; assemblé avec un voisin il le devient', () => {
    const tiny = (x: number): Parcel => rect(x, 0, 4, 12); // 48 m²
    let s = createGame({
      players: [{ id: 'a', name: 'Alice' }],
      plots: [{ id: 'S1', parcel: tiny(0), issue: 'trop-petite' }, { id: 'S2', parcel: tiny(4), issue: 'trop-petite' }, { id: 'S3', parcel: tiny(8), issue: 'trop-petite' }, { id: 'S4', parcel: tiny(12), issue: 'trop-petite' }],
      config: { market: MARKETS['petite-couronne'], startCash: 5_000_000, eventChance: 0, salesDemand: 1000 },
    });
    for (const id of ['S1', 'S2', 'S3', 'S4']) s = play(s, { type: 'buy', player: 'a', plot: id });
    expect(err(s, { type: 'launch', player: 'a', plot: 'S1', criteria: { ...DEFAULT_CRITERIA, levels: 2 } })).toMatch(/trop petit/);
    s = play(s, { type: 'merge', player: 'a', plots: ['S1', 'S2', 'S3', 'S4'] });
    expect(s.plots[0].issue).toBeUndefined(); // 16 × 12 m : constructible
    s = play(s, { type: 'launch', player: 'a', plot: 'S1+S2+S3+S4', criteria: { ...DEFAULT_CRITERIA, levels: 3 } });
    expect(s.projects).toHaveLength(1);
  });

  it('une parcelle enclavée devient constructible une fois assemblée avec une parcelle sur rue', () => {
    const front = rect(0, 0, 12, 12);
    const back: Parcel = { ...rect(0, 12, 12, 12), streetEdges: [] };
    let s = createGame({
      players: [{ id: 'a', name: 'Alice' }],
      plots: [{ id: 'F', parcel: front }, { id: 'B', parcel: back, issue: 'enclavee' }],
      config: { market: MARKETS['petite-couronne'], startCash: 5_000_000, eventChance: 0 },
    });
    s = play(play(s, { type: 'buy', player: 'a', plot: 'F' }), { type: 'buy', player: 'a', plot: 'B' });
    expect(err(s, { type: 'launch', player: 'a', plot: 'B', criteria: { ...DEFAULT_CRITERIA, levels: 2 } })).toMatch(/enclavée/);
    s = play(s, { type: 'merge', player: 'a', plots: ['F', 'B'] });
    const m = s.plots[0];
    expect(m.issue).toBeUndefined();
    expect(m.parcel.streetEdges.length).toBeGreaterThan(0);
  });
});
