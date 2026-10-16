import { Frame, bbox, difference, intersection, minWidth, polygonArea, rectRing, ringArea, toMulti } from './geometry';
import { generateFootprint } from './footprint';
import { classifyFootprintEdges } from './layout';
import { computeProgram, type ProgramResult } from './program';
import type { Assumptions, Criteria, EdgeInfo, FootprintEdge, MultiPolygon, Ring } from './types';

/** Largeur de l'allée (ou du porche) qui mène au bâtiment arrière : passage des pompiers et des habitants. */
export const ACCESS_WIDTH = 3.5;

export interface RearBuilding {
  ring: Ring;
  fpEdges: FootprintEdge[];
  program: ProgramResult;
  /** Allée de 3,5 m le long du bâtiment sur rue, ou porche qui le traverse (surface perdue au rez-de-chaussée). */
  access: 'allee' | 'porche';
  porchArea: number;
}

export interface RearInput {
  envelope: MultiPolygon;
  /** Contour du terrain (repère local), pour mesurer la bande libre le long du bâtiment sur rue. */
  parcel: Ring;
  frame: Frame;
  /** Emprise du bâtiment sur rue (repère local). */
  front: Ring;
  frontHeight: number;
  edges: EdgeInfo[];
  criteria: Criteria;
  assumptions: Assumptions;
  /** Emprise au sol encore disponible sous le plafond d'emprise (null = pas de plafond). */
  areaCap: number | null;
}

/**
 * Deuxième bâtiment au fond du terrain, derrière celui qui donne sur la rue. Il se pose dans ce qui reste de l'enveloppe
 * constructible une fois laissée la distance réglementaire entre bâtiments (au moins la moitié de la hauteur du bâtiment
 * sur rue). Il lui faut un accès : une allée de 3,5 m le long du bâtiment sur rue si le terrain est assez large, sinon un
 * porche qui coupe le rez-de-chaussée. Retourne la raison quand il n'y a pas de place.
 */
export function buildRear(input: RearInput): { rear: RearBuilding | null; reason?: string } {
  const { frame, front, edges, criteria: c, assumptions: a } = input;
  const fr = frame.toRing(front);
  const frb = bbox(fr);
  const gap = Math.max(c.buildingGap, input.frontHeight / 2);
  const env = frame.toMulti(input.envelope);
  if (env.length === 0) return { rear: null, reason: 'plus rien de constructible' };
  const all = env.flatMap((poly) => poly[0]);
  const eb = bbox(all);
  const start = frb.maxY + gap;
  if (eb.maxY - start < c.minWidth + 1) {
    return { rear: null, reason: `il faut au moins ${(gap + c.minWidth + 1).toFixed(0)} m derrière le bâtiment sur rue (dont ${gap.toFixed(1)} m entre les deux bâtiments), le terrain n’est pas assez profond` };
  }
  const zone = intersection(env, toMulti(rectRing(eb.minX - 1, start, eb.maxX + 1, eb.maxY + 1)));
  const usable = zone.filter((p) => polygonArea(p) >= 30);
  if (usable.length === 0) return { rear: null, reason: 'le fond du terrain est trop petit une fois les retraits et la distance entre bâtiments laissés' };
  const local: MultiPolygon = usable.map((poly) => poly.map((r) => frame.fromRing(r)));
  const cap = input.areaCap;
  if (cap !== null && cap < 30) return { rear: null, reason: 'l’emprise au sol maximale est déjà atteinte par le bâtiment sur rue' };
  const gen = generateFootprint(local, frame, { shape: c.footprintShape, maxDepth: c.maxDepth, minWidth: c.minWidth, areaCap: capBuilding(cap, c), placement: 'fond', compact: c.maxBuildingArea != null });
  if (!gen.ring || ringArea(gen.ring) < 30 || minWidth(gen.ring) < c.minWidth) return { rear: null, reason: gen.reason ?? 'emprise arrière trop étroite' };
  // Accès : une allée libre de 3,5 m le long du bâtiment sur rue (d'un côté ou de l'autre), sinon un porche.
  const pb = bbox(frame.toRing(input.parcel));
  const freeLeft = Math.max(0, frb.minX - pb.minX);
  const freeRight = Math.max(0, pb.maxX - frb.maxX);
  const access: 'allee' | 'porche' = Math.max(freeLeft, freeRight) >= ACCESS_WIDTH ? 'allee' : 'porche';
  const porchArea = access === 'porche' ? ACCESS_WIDTH * (frb.maxY - frb.minY) : 0;
  const { fpEdges, program } = secondaryProgram(gen.ring, 2, edges, c, a);
  return { rear: { ring: gen.ring, fpEdges, program, access, porchArea } };
}

/** Plafond de surface d'un bâtiment : le plus petit du plafond restant (emprise, densité) et de la taille maximale d'un bâtiment (maisons). */
export const capBuilding = (cap: number | null, c: Pick<Criteria, 'maxBuildingArea'>): number | null => (c.maxBuildingArea == null ? cap : cap === null ? c.maxBuildingArea : Math.min(cap, c.maxBuildingArea));

/** Niveaux (R+x) des bâtiments autres que celui sur rue. */
export const secondaryLevels = (c: Criteria) => Math.max(0, c.secondLevels === null ? c.levels : Math.min(c.secondLevels, c.levels));

/** Programme d'un bâtiment secondaire (n° 2, 3…) : identifiants distincts de ceux du bâtiment sur rue, pas d'attique. */
function secondaryProgram(ring: Ring, n: number, edges: EdgeInfo[], c: Criteria, a: Assumptions): { fpEdges: FootprintEdge[]; program: ProgramResult } {
  const rc: Criteria = { ...c, levels: secondaryLevels(c), attic: false, groundFloorUse: c.upperUse === 'bureaux' ? 'commerce' : 'logement' };
  const fpEdges = classifyFootprintEdges(ring, edges);
  const program = computeProgram({ footprint: ring, footprintEdges: fpEdges, atticFootprint: null, criteria: rc, assumptions: a, rampLoss: 0 });
  const label = n === 2 ? 'Bât. arrière' : `Bât. ${n}`;
  const levelsPlan = program.levels.map((l) => ({ ...l, building: n, id: `B${n}-${l.id}`, label: `${label} · ${l.label}` }));
  const dwellings = program.dwellings.map((d) => ({ ...d, levelId: `B${n}-${d.levelId}` }));
  return { fpEdges, program: { ...program, levels: levelsPlan, dwellings } };
}

/** Surface minimale d'un bâtiment supplémentaire (m²). */
const MIN_EXTRA_AREA = 60;

/**
 * Tous les bâtiments autres que celui sur rue : d'abord le bâtiment arrière (accès par allée ou porche), puis, sur les grands
 * terrains, d'autres bâtiments dans ce qui reste libre une fois laissée la distance réglementaire entre bâtiments.
 */
export function buildSecondary(input: RearInput & { maxBuildings: number }): { buildings: RearBuilding[]; reason?: string } {
  const first = buildRear(input);
  if (!first.rear) return { buildings: [], reason: first.reason };
  const { frame, criteria: c, assumptions: a, edges } = input;
  const buildings: RearBuilding[] = [first.rear];
  const gap = Math.max(c.buildingGap, input.frontHeight / 2);
  let used = ringArea(first.rear.ring);
  for (let n = 3; n <= input.maxBuildings; n++) {
    let free = frame.toMulti(input.envelope);
    for (const r of [input.front, ...buildings.map((b) => b.ring)]) {
      const b = bbox(frame.toRing(r));
      free = difference(free, toMulti(rectRing(b.minX - gap, b.minY - gap, b.maxX + gap, b.maxY + gap)));
    }
    const usable = free.filter((p) => polygonArea(p) >= MIN_EXTRA_AREA);
    const cap = input.areaCap === null ? null : input.areaCap - used;
    if (usable.length === 0 || (cap !== null && cap < MIN_EXTRA_AREA)) break;
    const local: MultiPolygon = usable.map((poly) => poly.map((r) => frame.fromRing(r)));
    const gen = generateFootprint(local, frame, { shape: c.footprintShape, maxDepth: c.maxDepth, minWidth: c.minWidth, areaCap: capBuilding(cap, c), placement: 'auto', compact: c.maxBuildingArea != null });
    if (!gen.ring || ringArea(gen.ring) < MIN_EXTRA_AREA || minWidth(gen.ring) < c.minWidth) break;
    const { fpEdges, program } = secondaryProgram(gen.ring, n, edges, c, a);
    buildings.push({ ring: gen.ring, fpEdges, program, access: 'allee', porchArea: 0 });
    used += ringArea(gen.ring);
  }
  return { buildings };
}
