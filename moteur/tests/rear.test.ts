import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA, LocalProjection, computeBilan, computeProject, MARKETS, type Parcel, type Vec2 } from '../src/engine';
import { ZONE_RULES, criteriaFor, ruleOf } from '../src/game';

const O = new LocalProjection(2.35, 48.85);
const rect = (w: number, d: number): Parcel => ({ ring: ([[0, 0], [w, 0], [w, d], [0, d]] as Vec2[]).map((p) => O.toLonLat(p)), streetEdges: [0] });
const base = { ...DEFAULT_CRITERIA, setbackFond: 3, setbackLateral: 0, maxDepth: 12, levels: 3, secondLevels: 2 };

describe('deuxième bâtiment au fond du terrain', () => {
  it('sur un terrain profond, un bâtiment arrière s’ajoute au bâtiment sur rue', () => {
    const one = computeProject(rect(20, 60), base);
    const two = computeProject(rect(20, 60), { ...base, secondBuilding: true });
    expect(one.rearFootprint).toBeNull();
    expect(one.indicators.buildings).toBe(1);
    expect(two.rearFootprint).not.toBeNull();
    expect(two.indicators.buildings).toBe(2);
    expect(two.indicators.sdpTotal).toBeGreaterThan(one.indicators.sdpTotal * 1.3);
    expect(two.indicators.dwellings).toBeGreaterThan(one.indicators.dwellings);
    expect(two.indicators.footprintArea).toBeGreaterThan(one.indicators.footprintArea);
    expect(two.levels.some((l) => l.building === 2)).toBe(true);
    expect(two.checks.find((c) => c.id === 'rear')?.status).toBe('info');
  });

  it('les deux bâtiments sont séparés d’au moins la distance réglementaire (moitié de la hauteur, 6 m au moins)', () => {
    const two = computeProject(rect(20, 60), { ...base, secondBuilding: true, buildingGap: 6 });
    const frontMaxY = Math.max(...two.footprint!.map((p) => p[1]));
    const rearMinY = Math.min(...two.rearFootprint!.map((p) => p[1]));
    const height = two.indicators.height;
    expect(rearMinY - frontMaxY).toBeGreaterThanOrEqual(Math.max(6, height / 2) - 0.05);
    // plus le bâtiment sur rue est haut, plus la distance augmente
    const gapOf = (levels: number) => {
      const p = computeProject(rect(20, 32), { ...base, levels, secondBuilding: true });
      return Math.min(...p.rearFootprint!.map((q) => q[1])) - Math.max(...p.footprint!.map((q) => q[1]));
    };
    expect(gapOf(5)).toBeGreaterThan(gapOf(3) + 1);
  });

  it('le bâtiment arrière est plus bas que celui sur rue', () => {
    const two = computeProject(rect(20, 60), { ...base, levels: 4, secondLevels: 1, secondBuilding: true });
    const rearLevels = two.levels.filter((l) => l.building === 2);
    const frontLevels = two.levels.filter((l) => (l.building ?? 1) === 1);
    expect(rearLevels).toHaveLength(2); // RDC + 1 étage
    expect(frontLevels.length).toBeGreaterThan(rearLevels.length);
  });

  it('un terrain trop peu profond ne reçoit pas de deuxième bâtiment, et on dit pourquoi', () => {
    const p = computeProject(rect(20, 24), { ...base, secondBuilding: true });
    expect(p.rearFootprint).toBeNull();
    const c = p.checks.find((x) => x.id === 'rear')!;
    expect(c.status).toBe('warn');
    expect(c.detail).toMatch(/profond|petit/);
  });

  it('l’accès se fait par une allée si le terrain est assez large, sinon par un porche qui coupe le rez-de-chaussée', () => {
    const wide = computeProject(rect(24, 60), { ...base, setbackLateral: 5, secondBuilding: true });
    expect(wide.rearAccess).toBe('allee');
    const narrow = computeProject(rect(16, 60), { ...base, secondBuilding: true });
    expect(narrow.rearAccess).toBe('porche');
    expect(narrow.checks.find((c) => c.id === 'rear')!.detail).toMatch(/porche/);
    const noRear = computeProject(rect(16, 60), base);
    const rdc = (p: typeof narrow) => p.levels.find((l) => (l.building ?? 1) === 1 && l.kind === 'rdc')!.sdp;
    expect(rdc(narrow)).toBeLessThan(rdc(noRear));
  });

  it('l’emprise au sol maximale s’applique à l’ensemble des deux bâtiments', () => {
    const p = computeProject(rect(20, 60), { ...base, maxCoverage: 0.3, secondBuilding: true });
    expect(p.indicators.coverage).toBeLessThanOrEqual(0.3 + 1e-3);
    expect(p.checks.find((c) => c.id === 'ces')?.status).toBe('ok');
  });

  it('la densité maximale écarte le deuxième bâtiment s’il la dépasse', () => {
    const p = computeProject(rect(20, 60), { ...base, maxFAR: 0.5, secondBuilding: true });
    expect(p.indicators.sdpTotal).toBeLessThanOrEqual(0.5 * 1200 + 1);
  });

  it('le bilan compte les deux bâtiments (surface vendue, durée du chantier du plus haut)', () => {
    const market = MARKETS['petite-couronne'];
    const one = computeProject(rect(20, 60), base);
    const two = computeProject(rect(20, 60), { ...base, secondBuilding: true });
    const b1 = computeBilan({ project: one, market, landPrice: 500_000 });
    const b2 = computeBilan({ project: two, market, landPrice: 500_000 });
    expect(b2.revenue.housing).toBeGreaterThan(b1.revenue.housing * 1.3);
    expect(b2.costs.works).toBeGreaterThan(b1.costs.works);
    expect(b2.months).toBeLessThanOrEqual(b1.months + 3);
  });
});

describe('PLU et deuxième bâtiment', () => {
  it('seules les zones qui l’autorisent le permettent ; le bâtiment arrière reste plus bas', () => {
    const want = { ...base, secondBuilding: true, secondLevels: 5 };
    expect(criteriaFor({ zones: ['mixte'] }, want).secondBuilding).toBe(true);
    expect(criteriaFor({ zones: ['centre'] }, want).secondBuilding).toBe(true);
    expect(criteriaFor({ zones: ['preservation'] }, want).secondBuilding).toBe(false);
    expect(criteriaFor({ zones: ['mixte', 'preservation'] }, want).secondBuilding).toBe(false);
    const c = criteriaFor({ zones: ['mixte'] }, want);
    expect(c.secondLevels).toBeLessThanOrEqual(ZONE_RULES.mixte.maxLevels - 1);
    expect(c.buildingGap).toBeGreaterThanOrEqual(ZONE_RULES.mixte.buildingGap);
    expect(ruleOf({ zones: ['centre'] })!.maxBuildings).toBe(2);
  });
});
