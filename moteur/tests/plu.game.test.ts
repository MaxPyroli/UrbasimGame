import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA, LocalProjection, MARKETS, computeProject, type Parcel, type Vec2 } from '../src/engine';
import {
  ISSUE_MESSAGE,
  ZONE_RULES,
  allowedLevels,
  applyAction,
  applyRule,
  appraise,
  buildDistrict,
  combineRules,
  createGame,
  DEFAULT_CONFIG,
  districtToSeeds,
  pointInRing,
  ruleOf,
  zoneFamily,
  type Action,
  type GameState,
  type ZoneFamily,
} from '../src/game';

const O = new LocalProjection(2.35, 48.85);
const rect = (x: number, y: number, w: number, h: number): Parcel => ({
  ring: ([[x, y], [x + w, y], [x + w, y + h], [x, y + h]] as Vec2[]).map((p) => O.toLonLat(p)),
  streetEdges: [0],
});
const cfg = { ...DEFAULT_CONFIG, market: MARKETS['petite-couronne'] };
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
const game = (zones: ZoneFamily[], extra: Partial<Parameters<typeof createGame>[0]['plots'][number]> = {}) =>
  createGame({
    players: [{ id: 'a', name: 'Alice' }],
    plots: [{ id: 'T1', parcel: rect(0, 0, 14, 30), zones, ...extra }, { id: 'T2', parcel: rect(14, 0, 14, 30), zones: ['preservation'] }],
    config: { market: MARKETS['petite-couronne'], startCash: 20_000_000, eventChance: 0, salesDemand: 1000 },
  });

describe('PLU simplifié', () => {
  it('traduit les vraies familles du Géoportail de l’Urbanisme (Montreuil) en 7 familles de jeu', () => {
    expect(zoneFamily('U', 'UC91Jb2', 'Centralite')).toBe('centre');
    expect(zoneFamily('U', 'UM91E13', 'Zone mixte')).toBe('mixte');
    expect(zoneFamily('U', 'UA91E13-3', 'Activites economiques')).toBe('activites');
    expect(zoneFamily('U', 'UH91E10', 'Secteur de preservation')).toBe('preservation');
    expect(zoneFamily('U', 'UR91D19', 'Secteur de renouvellement')).toBe('renouvellement');
    expect(zoneFamily('U', 'UE91Anr', 'Equipement')).toBe('equipement');
    expect(zoneFamily('N', 'Nc', 'Zone naturelle cimetiere')).toBe('nature');
    expect(zoneFamily('A', 'A', 'Agricole')).toBe('nature');
    expect(zoneFamily('U', 'UXYZ', '')).toBe('mixte'); // inconnu : zone mixte par défaut
  });

  it('chaque famille a 5 règles lisibles, de la plus dense à la plus protectrice', () => {
    const r = ZONE_RULES;
    expect(r.renouvellement.maxLevels).toBeGreaterThan(r.centre.maxLevels);
    expect(r.centre.maxLevels).toBeGreaterThan(r.mixte.maxLevels);
    expect(r.mixte.maxLevels).toBeGreaterThan(r.preservation.maxLevels);
    expect(r.preservation.minOpenGround).toBeGreaterThan(r.centre.minOpenGround);
    expect(r.equipement.buildable).toBe(false);
    expect(r.nature.buildable).toBe(false);
    expect(r.activites.use).toBe('bureaux');
  });

  it('la hauteur est bornée : l’attique compte comme un niveau', () => {
    expect(allowedLevels(ZONE_RULES.mixte, false)).toBe(4);
    expect(allowedLevels(ZONE_RULES.mixte, true)).toBe(3);
    const base = { ...DEFAULT_CRITERIA };
    const ok = computeProject(rect(0, 0, 14, 30), applyRule({ ...base, levels: 4 }, ZONE_RULES.mixte));
    const tooHigh = computeProject(rect(0, 0, 14, 30), applyRule({ ...base, levels: 5 }, ZONE_RULES.mixte));
    const atticTooMuch = computeProject(rect(0, 0, 14, 30), applyRule({ ...base, levels: 4, attic: true }, ZONE_RULES.mixte));
    expect(ok.checks.some((c) => c.status === 'error' && /hauteur/i.test(c.label))).toBe(false);
    expect(tooHigh.checks.some((c) => c.status === 'error' && /hauteur/i.test(c.label))).toBe(true);
    expect(atticTooMuch.checks.some((c) => c.status === 'error' && /hauteur/i.test(c.label))).toBe(true);
  });

  it('l’emprise, la pleine terre et les retraits de la zone s’imposent au projet', () => {
    const p = computeProject(rect(0, 0, 14, 40), applyRule({ ...DEFAULT_CRITERIA, levels: 2 }, ZONE_RULES.preservation));
    expect(p.indicators.coverage).toBeLessThanOrEqual(ZONE_RULES.preservation.maxCoverage + 1e-6);
    expect(p.indicators.openGround).toBeGreaterThanOrEqual(ZONE_RULES.preservation.minOpenGround - 1e-6);
  });

  it('un terrain à cheval sur deux zones suit la règle la plus restrictive ; une zone inconstructible l’emporte', () => {
    const c = combineRules(['centre', 'preservation']);
    expect(c.maxLevels).toBe(2);
    expect(c.minOpenGround).toBe(0.35);
    expect(c.maxCoverage).toBe(0.45);
    expect(combineRules(['centre', 'nature']).buildable).toBe(false);
    expect(combineRules(['centre', 'activites']).use).toBe('bureaux');
  });

  it('dans le jeu : un projet trop haut pour la zone est refusé avec la raison, un projet conforme passe', () => {
    let s = play(game(['preservation']), { type: 'buy', player: 'a', plot: 'T1' });
    const refused = err(s, { type: 'launch', player: 'a', plot: 'T1', criteria: { ...DEFAULT_CRITERIA, levels: 5 } });
    expect(refused).toMatch(/projet non conforme/i);
    expect(refused).toMatch(/hauteur/i);
    s = play(s, { type: 'launch', player: 'a', plot: 'T1', criteria: { ...DEFAULT_CRITERIA, levels: 2 } });
    expect(s.projects).toHaveLength(1);
    // le PLU est appliqué aux critères mémorisés
    expect(s.projects[0].criteria.maxCoverage).toBe(ZONE_RULES.preservation.maxCoverage);
  });

  it('le joueur ne peut pas contourner le PLU en envoyant ses propres limites', () => {
    let s = play(game(['preservation']), { type: 'buy', player: 'a', plot: 'T1' });
    expect(err(s, { type: 'launch', player: 'a', plot: 'T1', criteria: { ...DEFAULT_CRITERIA, levels: 6, maxHeight: null, maxCoverage: null, minOpenGround: 0 } })).toMatch(/hauteur/i);
  });

  it('une zone d’équipement ou naturelle est inconstructible pour un promoteur', () => {
    const s0 = createGame({
      players: [{ id: 'a', name: 'A' }],
      plots: [{ id: 'E', parcel: rect(0, 0, 20, 30), zones: ['equipement'], issue: 'zone' }],
      config: { market: MARKETS['petite-couronne'], startCash: 5_000_000 },
    });
    const s = play(s0, { type: 'buy', player: 'a', plot: 'E' });
    expect(err(s, { type: 'launch', player: 'a', plot: 'E', criteria: DEFAULT_CRITERIA })).toBe(ISSUE_MESSAGE.zone);
  });

  it('en zone d’activités, on ne construit que des bureaux : pas de logements', () => {
    const p = computeProject(rect(0, 0, 20, 30), applyRule({ ...DEFAULT_CRITERIA, levels: 2 }, ZONE_RULES.activites));
    expect(p.indicators.dwellings).toBe(0);
    expect(p.indicators.sdpOffice).toBeGreaterThan(0);
  });

  it('le prix du terrain reflète la constructibilité : une zone de préservation vaut moins qu’une zone de centralité', () => {
    const parcel = rect(0, 0, 16, 32);
    const centre = appraise(parcel, 0, cfg, 1, ZONE_RULES.centre).best;
    const pres = appraise(parcel, 0, cfg, 1, ZONE_RULES.preservation).best;
    expect(centre).toBeGreaterThan(pres * 1.5);
    expect(appraise(parcel, 0, cfg, 1, ZONE_RULES.nature).best).toBe(0);
  });

  it('l’assemblage de deux zones donne la règle la plus restrictive', () => {
    let s = createGame({
      players: [{ id: 'a', name: 'A' }],
      plots: [{ id: 'X', parcel: rect(0, 0, 14, 30), zones: ['centre'], zoneCode: 'UC' }, { id: 'Y', parcel: rect(14, 0, 14, 30), zones: ['preservation'], zoneCode: 'UH' }],
      config: { market: MARKETS['petite-couronne'], startCash: 20_000_000, eventChance: 0 },
    });
    s = play(play(s, { type: 'buy', player: 'a', plot: 'X' }), { type: 'buy', player: 'a', plot: 'Y' });
    s = play(s, { type: 'merge', player: 'a', plots: ['X', 'Y'] });
    expect(new Set(s.plots[0].zones)).toEqual(new Set(['centre', 'preservation']));
    expect(ruleOf(s.plots[0])!.maxLevels).toBe(2);
  });

  it('les bots respectent le PLU : aucune opération ne dépasse la hauteur de sa zone', async () => {
    const { playBots } = await import('../src/game');
    const plots = Array.from({ length: 8 }, (_, i) => ({
      id: `T${i}`,
      parcel: rect((i % 4) * 16, Math.floor(i / 4) * 40, 14, 30),
      zones: [(['centre', 'mixte', 'preservation', 'renouvellement'] as ZoneFamily[])[i % 4]],
      askingPrice: 300_000,
    }));
    let s = createGame({ players: [{ id: 'e', name: 'E', bot: true }, { id: 'a', name: 'A', bot: true, profile: 'agressif' }], plots, config: { market: MARKETS['petite-couronne'], startCash: 6_000_000 }, seed: 2 });
    for (let i = 0; i < 12; i++) {
      s = playBots(s);
      for (const run of s.projects) {
        const plot = s.plots.find((p) => p.id === run.plotId)!;
        const rule = ruleOf(plot)!;
        expect(run.criteria.levels + (run.criteria.attic ? 1 : 0)).toBeLessThanOrEqual(rule.maxLevels);
      }
    }
  });
});

describe('zonage dans le quartier', () => {
  it('pointInRing', () => {
    const ring: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    expect(pointInRing(5, 5, ring)).toBe(true);
    expect(pointInRing(15, 5, ring)).toBe(false);
  });

  it('chaque parcelle reçoit la zone qui contient son centre, et les graines la transmettent', () => {
    const feat = (idu: string, x: number) => ({
      type: 'Feature',
      id: idu,
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [14, 0], [14, 30], [0, 30], [0, 0]].map(([a, b]) => { const l = O.toLonLat([a + x, b]); return [l.lon, l.lat]; })] },
      properties: { idu, section: 'AB', numero: idu, nom_com: 'T' },
    });
    const zoneRing = (x0: number, x1: number): [number, number][] =>
      ([[x0, -5], [x1, -5], [x1, 40], [x0, 40], [x0, -5]] as Vec2[]).map((p) => { const l = O.toLonLat(p); return [l.lon, l.lat] as [number, number]; });
    const d = buildDistrict({
      name: 'T', center: O.toLonLat([14, 15]), radius: 60, market: 'petite-couronne',
      cadastre: { type: 'FeatureCollection', features: [feat('P1', 0), feat('P2', 14)] },
      buildings: [], pois: [], credits: [], fetchedAt: '2026-01-01',
      zones: [
        { code: 'UC1', label: 'Centralité', family: 'centre', rings: [zoneRing(-1, 14)] },
        { code: 'UH1', label: 'Secteur de préservation', family: 'preservation', rings: [zoneRing(14, 29)] },
      ],
    });
    expect(d.parcels.find((p) => p.id === 'P1')!.zone).toBe('centre');
    expect(d.parcels.find((p) => p.id === 'P2')!.zone).toBe('preservation');
    const seeds = districtToSeeds(d);
    expect(seeds.find((x) => x.id === 'P2')!.zones).toEqual(['preservation']);
    expect(seeds.find((x) => x.id === 'P1')!.zoneCode).toBe('UC1');
  });

  it('l’instantané réel de Montreuil porte le zonage, avec plusieurs familles', () => {
    // vérifié via la lecture du JSON dans district.test ; ici : les règles couvrent toutes les familles
    expect(Object.keys(ZONE_RULES)).toHaveLength(7);
  });
});
