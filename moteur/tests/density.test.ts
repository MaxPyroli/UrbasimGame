import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA, LocalProjection, computeProject, type Parcel, type Vec2 } from '../src/engine';
import { ZONE_RULES, adaptToDensity, criteriaFor, plotIssue, ruleOf, withDensity, type District } from '../src/game';

const O = new LocalProjection(2.35, 48.85);
const rect = (w: number, d: number): Parcel => ({ ring: ([[0, 0], [w, 0], [w, d], [0, d]] as Vec2[]).map((p) => O.toLonLat(p)), streetEdges: [0] });

describe('règles adaptées à la densité du tissu bâti', () => {
  it('en tissu dense : pas de retrait latéral, retrait de fond réduit, plus d’emprise', () => {
    const base = ZONE_RULES.preservation;
    const dense = adaptToDensity(base, 'dense');
    expect(dense.setbackLateral).toBe(0);
    expect(dense.setbackFond).toBeLessThanOrEqual(2);
    expect(dense.maxCoverage).toBeGreaterThan(base.maxCoverage);
    expect(dense.minOpenGround).toBeLessThan(base.minOpenGround);
    expect(dense.maxLevels).toBe(base.maxLevels);
    expect(adaptToDensity(base, 'diffuse')).toBe(base);
    expect(adaptToDensity(base, undefined)).toBe(base);
    expect(adaptToDensity(ZONE_RULES.nature, 'dense')).toBe(ZONE_RULES.nature);
  });

  it('les critères du projet suivent la règle adaptée, et le retrait de la zone remplace celui du moteur', () => {
    const dense = criteriaFor({ zones: ['preservation'], density: 'dense' }, DEFAULT_CRITERIA);
    const diffuse = criteriaFor({ zones: ['preservation'], density: 'diffuse' }, DEFAULT_CRITERIA);
    expect(dense.setbackLateral).toBe(0);
    expect(diffuse.setbackLateral).toBe(3);
    expect(criteriaFor({ zones: ['centre'] }, DEFAULT_CRITERIA).setbackFond).toBe(0);
    expect(ruleOf({ zones: ['preservation'], density: 'dense' })!.summary).toMatch(/Tissu dense/);
  });

  it('une parcelle étroite de tissu ancien devient constructible quand le quartier est dense', () => {
    const parcel = rect(9, 25);
    const diffuse = ruleOf({ zones: ['preservation'], density: 'diffuse' });
    const dense = ruleOf({ zones: ['preservation'], density: 'dense' });
    expect(plotIssue(parcel, undefined, 1, diffuse)).toBeDefined();
    expect(plotIssue(parcel, undefined, 1, dense)).toBeUndefined();
  });

  it('la densité se mesure sur la part de surface bâtie alentour', () => {
    const lat = 48.85;
    const lonStep = 1 / (111320 * Math.cos((lat * Math.PI) / 180));
    const latStep = 1 / 110540;
    const block = (x: number, y: number, s: number): [number, number][] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]].map(([a, b]) => [2.35 + a * lonStep, lat + b * latStep] as [number, number]);
    const parcelAt = (x: number, y: number) => ({ id: `p${x}`, label: '', ring: block(x, y, 10).map(([lon, lat2]) => ({ lon, lat: lat2 })), streetEdges: [0], area: 100, existingSdp: 0, existingHeight: 0, locationFactor: 1 });
    // un bloc très bâti à l'ouest, rien à l'est
    const buildings = Array.from({ length: 36 }, (_, i) => ({ ring: block(-90 + (i % 6) * 25, -60 + Math.floor(i / 6) * 22, 20), height: 12, estimated: false }));
    const d = { name: 't', center: { lon: 2.35, lat }, radius: 500, market: 'petite-couronne', parcels: [parcelAt(-60, -20), parcelAt(400, 0)], buildings, pois: [], credits: [], fetchedAt: '2026-01-01' } as unknown as District;
    const r = withDensity(d);
    expect(r.parcels[0].density).toBe('dense');
    expect(r.parcels[1].density).toBe('diffuse');
  });
});

describe('emprises plus réalistes', () => {
  it('un terrain en peigne donne un bâtiment simple, pas une dentelle', () => {
    // contour très découpé : crêneaux de 1,5 m sur la rue et en fond
    const pts: Vec2[] = [[0, 0]];
    for (let x = 0; x < 20; x += 3) pts.push([x + 1.5, 0], [x + 1.5, -1.2], [x + 3, -1.2], [x + 3, 0]);
    const wiggly: Vec2[] = [[0, 0], [20, 0], [20, 14], [17, 14], [17, 12.6], [14, 12.6], [14, 14], [11, 14], [11, 12.6], [8, 12.6], [8, 14], [5, 14], [5, 12.6], [2, 12.6], [2, 14], [0, 14]];
    const parcel: Parcel = { ring: wiggly.map((p) => O.toLonLat(p)), streetEdges: [0] };
    const project = computeProject(parcel, { ...DEFAULT_CRITERIA, setbackFond: 0, maxDepth: 14 });
    expect(project.footprint).not.toBeNull();
    expect(project.footprint!.length).toBeLessThanOrEqual(8);
    expect(project.indicators.footprintArea).toBeGreaterThan(150);
    void pts;
  });

  it('un terrain d’angle garde son L', () => {
    const l: Vec2[] = [[0, 0], [30, 0], [30, 30], [18, 30], [18, 12], [0, 12]];
    const parcel: Parcel = { ring: l.map((p) => O.toLonLat(p)), streetEdges: [0, 1] };
    const project = computeProject(parcel, { ...DEFAULT_CRITERIA, setbackFond: 0, setbackLateral: 0, maxDepth: 12 });
    expect(project.footprint).not.toBeNull();
    expect(project.footprint!.length).toBeGreaterThanOrEqual(4);
  });
});
