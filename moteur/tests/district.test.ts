import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LocalProjection, MARKETS, type ContextBuilding, type Vec2 } from '../src/engine';
import { buildDistrict, createGame, districtToSeeds, playBots, type District } from '../src/game';

const C = { lon: 2.35, lat: 48.85 };
const P = new LocalProjection(C.lon, C.lat);
const feat = (idu: string, pts: Vec2[]) => ({
  type: 'Feature',
  id: `parcelle.${idu}`,
  geometry: { type: 'MultiPolygon', coordinates: [[[...pts, pts[0]].map((p) => { const l = P.toLonLat(p); return [l.lon, l.lat]; })]] },
  properties: { idu, section: 'AB', numero: idu.slice(-4), nom_com: 'Test' },
});
const rect = (x: number, y: number, w: number, h: number): Vec2[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

/** Deux lots côte à côte sur rue (A, B), un lot enclavé derrière (C), une miette (D), un lot lointain (E). */
const cadastre = {
  type: 'FeatureCollection',
  features: [
    feat('A000', rect(0, 0, 10, 20)),
    feat('B000', rect(10, 0, 10, 20)),
    feat('C000', rect(0, 20, 20, 12)),
    feat('D000', rect(30, 0, 2, 3)),
    feat('E000', rect(500, 0, 10, 20)),
  ],
};
const house: ContextBuilding = {
  id: 'b1',
  outer: rect(2, 2, 6, 8).map((p) => P.toLonLat(p)),
  holes: [],
  height: 9,
  estimated: false,
  updated: null,
};
const src = { name: 'Test', center: C, radius: 100, market: 'petite-couronne' as const, cadastre, buildings: [house], credits: ['x'], fetchedAt: '2026-01-01' };

describe('quartier à partir du cadastre', () => {
  const d = buildDistrict(src);
  const byId = (id: string) => d.parcels.find((p) => p.id === id);

  it('écarte les miettes, les lots hors rayon et les lots enclavés', () => {
    expect(byId('D000')).toBeUndefined();
    expect(byId('E000')).toBeUndefined();
    // C touche A et B sur tout un côté mais aussi la rue sur les trois autres : il reste constructible.
    expect(byId('C000')).toBeDefined();
    const enclosed = buildDistrict({ ...src, cadastre: { ...cadastre, features: [feat('A000', rect(0, 0, 10, 10)), feat('N', rect(0, 10, 10, 10)), feat('S', rect(0, -10, 10, 10)), feat('W', rect(-10, 0, 10, 10)), feat('Z', rect(10, 0, 10, 10))] } });
    expect(enclosed.parcels.find((p) => p.id === 'A000')).toBeUndefined();
  });

  it('reconnaît les façades sur rue : les côtés mitoyens n’en sont pas', () => {
    const a = byId('A000')!;
    expect(a.area).toBe(200);
    expect(a.streetEdges.length).toBeGreaterThan(0);
    expect(a.streetEdges.length).toBeLessThan(a.ring.length);
    // A est mitoyen de B : l’arête commune n’est pas une façade, mais les trois autres le sont (C touche le haut).
    expect(byId('B000')!.streetEdges.length).toBeGreaterThan(0);
  });

  it('calcule la surface bâtie existante (emprise × niveaux)', () => {
    // 6×8 = 48 m² d’emprise, 9 m / 2,95 ≈ 3 niveaux
    expect(byId('A000')!.existingSdp).toBeGreaterThan(130);
    expect(byId('A000')!.existingSdp).toBeLessThan(160);
    expect(byId('B000')!.existingSdp).toBe(0);
  });

  it('retient la hauteur du bâti existant et les bâtiments à afficher', () => {
    expect(byId('A000')!.existingHeight).toBeCloseTo(9, 1);
    expect(byId('B000')!.existingHeight).toBe(0);
    expect(d.buildings).toHaveLength(1);
    expect(d.buildings[0].height).toBeCloseTo(9, 1);
    expect(d.buildings[0].ring.length).toBe(4);
    // un bâtiment hors du rayon n'est pas conservé
    const far = { ...house, id: 'far', outer: rect(900, 900, 5, 5).map((p) => P.toLonLat(p)) };
    expect(buildDistrict({ ...src, buildings: [house, far] }).buildings).toHaveLength(1);
  });

  it('est déterministe et sérialisable', () => {
    expect(JSON.stringify(buildDistrict(src))).toBe(JSON.stringify(d));
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
  });

  it('fournit des parcelles jouables', () => {
    const seeds = districtToSeeds(d);
    expect(seeds.length).toBeGreaterThan(0);
    const s = createGame({ players: [{ id: 'a', name: 'A' }], plots: seeds, config: { market: MARKETS[d.market] } });
    expect(s.plots.every((p) => p.label && p.askingPrice >= 20_000)).toBe(true);
  });
});

describe('instantané réel : Montreuil – Mairie (IGN)', () => {
  const real: District = JSON.parse(readFileSync(new URL('../data/districts/montreuil-mairie.json', import.meta.url), 'utf8'));

  it('contient plusieurs centaines de parcelles, avec mentions de licence et prix mémorisés', () => {
    expect(real.parcels.length).toBeGreaterThan(200);
    expect(real.credits.join(' ')).toMatch(/Licence Ouverte/);
    expect(real.parcels.every((p) => p.streetEdges.length > 0 && p.basePrice! >= 20_000)).toBe(true);
    expect(real.buildings.length).toBeGreaterThan(300);
    expect(real.buildings.every((b) => b.height > 0 && b.ring.length >= 3)).toBe(true);
  });

  it('une partie démarre vite et les bots y jouent', () => {
    const t = Date.now();
    let s = createGame({
      players: [{ id: 'p', name: 'P', bot: true, profile: 'prudent' }, { id: 'a', name: 'A', bot: true, profile: 'agressif' }],
      plots: districtToSeeds(real),
      config: { market: MARKETS[real.market], rounds: 6 },
      seed: 1,
    });
    expect(Date.now() - t).toBeLessThan(5000);
    for (let i = 0; i < 6; i++) s = playBots(s);
    expect(s.over).toBe(true);
    expect(s.plots.some((p) => p.owner !== null) || s.log.length > 0).toBe(true);
  }, 60_000);
});
