import { perimeter, ringArea } from './geometry';
import type {
  Assumptions,
  Criteria,
  DwellingUnit,
  FootprintEdge,
  LevelPlan,
  Ring,
  Typology,
  Use,
} from './types';
import { TYPOLOGIES } from './types';

export interface ProgramInput {
  footprint: Ring;
  footprintEdges: FootprintEdge[];
  atticFootprint: Ring | null;
  criteria: Criteria;
  assumptions: Assumptions;
  /** Surface perdue en rez-de-chaussée pour la rampe d'accès au sous-sol. */
  rampLoss: number;
}

export interface ProgramResult {
  levels: LevelPlan[];
  dwellings: DwellingUnit[];
  typologyCounts: Record<Typology, number>;
  hasLift: boolean;
  bikeRoom: number;
  glazedLength: number;
  /** Capacité de stationnement du rez-de-chaussée si celui-ci est affecté au parking. */
  groundParkingCapacity: number;
}

export function effectiveGroundUse(c: Criteria): Use {
  return c.parkingStrategy === 'rdc' ? 'parking' : c.groundFloorUse;
}

export function totalLevelCount(c: Criteria): number {
  return c.levels + 1 + (c.attic ? 1 : 0);
}

export function buildingHeight(c: Criteria): number {
  return c.groundFloorHeight + c.levels * c.floorHeight + (c.attic ? c.floorHeight : 0);
}

/** Surface intérieure d'un plateau = emprise − épaisseur des murs sur le périmètre. */
export function innerArea(ring: Ring, wall: number): number {
  return Math.max(0, ringArea(ring) - perimeter(ring) * wall);
}

function normalizedMix(mix: Record<Typology, number>): Record<Typology, number> {
  const sum = TYPOLOGIES.reduce((s, t) => s + Math.max(0, mix[t] ?? 0), 0);
  const out = {} as Record<Typology, number>;
  for (const t of TYPOLOGIES) out[t] = sum > 0 ? Math.max(0, mix[t] ?? 0) / sum : t === 'T3' ? 1 : 0;
  return out;
}

/** n logements répartis au plus près du mix cible compte tenu de ce qui est déjà construit (plus fort reste). */
function proportionalCounts(n: number, allowed: Typology[], totals: Record<Typology, number>, mix: Record<Typology, number>): Record<Typology, number> {
  const soFar = TYPOLOGIES.reduce((s, t) => s + totals[t], 0);
  const want = allowed.map((t) => Math.max(0, mix[t] * (soFar + n) - totals[t]));
  const sum = want.reduce((a, b) => a + b, 0) || 1;
  const raw = want.map((w) => (w / sum) * n);
  const counts = Object.fromEntries(TYPOLOGIES.map((t) => [t, 0])) as Record<Typology, number>;
  allowed.forEach((t, i) => (counts[t] = Math.floor(raw[i])));
  let left = n - allowed.reduce((s, t) => s + counts[t], 0);
  const order = allowed.map((t, i) => ({ t, frac: raw[i] - Math.floor(raw[i]) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) counts[order[k].t]++;
  return counts;
}

/** Les logements d'un niveau sont un peu plus petits que la surface type du mix (leurs surfaces s'ajustent pour remplir le niveau) : calé pour retrouver le nombre de logements de l'ancienne recherche de combinaisons. */
const AVERAGE_AREA_FACTOR = 0.88;

/**
 * Répartit la surface habitable d'un niveau en logements par une règle de surface : leur nombre est la surface divisée par la
 * surface moyenne du mix (plafonné par la longueur de façade), la répartition par typologie suit le mix cible compte tenu de
 * ce qui est déjà construit aux autres niveaux, et les surfaces s'ajustent pour remplir exactement le niveau.
 */
function allocateLevel(
  shab: number,
  maxCount: number,
  totals: Record<Typology, number>,
  mix: Record<Typology, number>,
  areas: Record<Typology, number>,
): { typology: Typology; area: number }[] {
  if (shab < 20 || maxCount < 1) return [];
  const allowed = TYPOLOGIES.filter((t) => mix[t] > 0);
  const avg = (allowed.reduce((s, t) => s + mix[t] * areas[t], 0) || 65) * AVERAGE_AREA_FACTOR;
  let n = Math.max(1, Math.min(maxCount, Math.round(shab / avg)));
  const split = (k: number) => {
    const counts = proportionalCounts(k, allowed, totals, mix);
    return { counts, scale: shab / allowed.reduce((s, t) => s + counts[t] * areas[t], 0) };
  };
  let cur = split(n);
  // Logements trop grands (ou trop petits) : un de plus (ou de moins) quand la façade et la surface le permettent.
  if (cur.scale > 1.5 && n < maxCount) cur = split(++n);
  else if (cur.scale < 0.78 && n > 1) cur = split(--n);
  const units: { typology: Typology; area: number }[] = [];
  for (const t of allowed) for (let k = 0; k < cur.counts[t]; k++) units.push({ typology: t, area: areas[t] * cur.scale });
  return units.sort((a, b) => a.area - b.area);
}

function levelLabel(i: number, kind: LevelPlan['kind']): string {
  if (kind === 'attique') return 'Attique';
  return i === 0 ? 'RDC' : `R+${i}`;
}

export function computeProgram(input: ProgramInput): ProgramResult {
  const { footprint, footprintEdges, atticFootprint, criteria: c, assumptions: a, rampLoss } = input;
  const count = totalLevelCount(c);
  // Maisons : un logement par bâtiment, ni escalier commun, ni ascenseur, ni hall, ni local vélos ou poubelles.
  const house = c.housing === 'maison';
  const hasVertical = count > 1 && !house;
  const hasLift = hasVertical && count - 1 >= a.liftFromLevel;
  const coreArea = hasVertical ? a.coreStairs + (hasLift ? a.coreLift : 0) + a.landing : 0;
  const groundUse = effectiveGroundUse(c);
  const mix = normalizedMix(c.mix);
  const glazedLength = footprintEdges.filter((e) => e.role !== 'party').reduce((s, e) => s + e.length, 0);
  const maxPerLevel = Math.max(1, Math.floor(glazedLength / a.minFacadePerDwelling));

  let bike = 0;
  let result!: ProgramResult;
  // Le local vélos dépend du nombre de logements, qui dépend de la surface restante : point fixe en 3 passes.
  for (let pass = 0; pass < 3; pass++) {
    const levels: LevelPlan[] = [];
    const dwellings: DwellingUnit[] = [];
    const totals = Object.fromEntries(TYPOLOGIES.map((t) => [t, 0])) as Record<Typology, number>;
    let groundParkingCapacity = 0;

    for (let i = 0; i < count; i++) {
      const isAttic = c.attic && i === count - 1;
      const kind: LevelPlan['kind'] = isAttic ? 'attique' : i === 0 ? 'rdc' : 'etage';
      const use: Use = house ? 'logement' : i === 0 ? groundUse : c.upperUse;
      const ring = isAttic && atticFootprint ? atticFootprint : footprint;
      const z0 = i === 0 ? 0 : c.groundFloorHeight + (i - 1) * c.floorHeight;
      const z1 = i === 0 ? c.groundFloorHeight : z0 + c.floorHeight;
      const inner = innerArea(ring, a.wallThickness);
      const core = hasVertical ? coreArea : 0;
      const services = i === 0 && hasVertical ? a.hallArea + a.binRoom + bike : 0;
      const ramp = i === 0 && use !== 'parking' ? rampLoss : 0;
      const usable = Math.max(0, inner - core - services - ramp);
      const plan: LevelPlan = {
        id: `n${i}`,
        label: levelLabel(i, kind),
        kind,
        use,
        z0,
        z1,
        footprintArea: ringArea(ring),
        sdp: use === 'parking' ? 0 : inner,
        core,
        services,
        usable: use === 'parking' ? 0 : usable,
        dwellings: 0,
        parkingSpaces: 0,
      };
      if (use === 'parking') {
        plan.parkingSpaces = Math.floor(Math.max(0, inner - core - services) / a.spaceGross);
        groundParkingCapacity = plan.parkingSpaces;
      } else if (use === 'logement' && house) {
        // le logement de la maison est créé après la boucle (surface de tous ses niveaux)
      } else if (use === 'logement') {
        const units = allocateLevel(usable * a.shabRatio, maxPerLevel, totals, mix, a.typologyArea);
        for (const u of units) {
          totals[u.typology]++;
          dwellings.push({ levelId: plan.id, typology: u.typology, area: u.area });
        }
        plan.dwellings = units.length;
      }
      levels.push(plan);
    }

    if (house) {
      const shab = levels.filter((l) => l.use === 'logement').reduce((s, l) => s + l.usable, 0) * a.shabRatio;
      if (shab >= 20) {
        const t = a.typologyArea;
        const typology: Typology = shab < (t.T1 + t.T2) / 2 ? 'T1' : shab < (t.T2 + t.T3) / 2 ? 'T2' : shab < (t.T3 + t.T4) / 2 ? 'T3' : shab < (t.T4 + t.T5) / 2 ? 'T4' : 'T5';
        dwellings.push({ levelId: levels[0].id, typology, area: shab });
        totals[typology]++;
        levels[0].dwellings = 1;
      }
    }
    const nDw = dwellings.length;
    const officeSdp = levels.filter((l) => l.use === 'bureaux').reduce((s, l) => s + l.sdp, 0);
    let nextBike = 0;
    if (hasVertical && nDw > 0) {
      nextBike = Math.max(
        a.bikeMin,
        dwellings.reduce((s, d) => s + (d.typology === 'T1' || d.typology === 'T2' ? a.bikeSmall : a.bikeLarge), 0),
      );
    }
    if (hasVertical && officeSdp > 0) nextBike = Math.max(nextBike, a.bikeOfficeRatio * officeSdp, a.bikeMin);
    result = { levels, dwellings, typologyCounts: totals, hasLift, bikeRoom: bike, glazedLength, groundParkingCapacity };
    if (Math.abs(nextBike - bike) < 0.01) break;
    bike = nextBike;
  }
  return result;
}
