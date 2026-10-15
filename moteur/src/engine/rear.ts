import { Frame, bbox, intersection, minWidth, polygonArea, rectRing, ringArea, toMulti } from './geometry';
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
  const gen = generateFootprint(local, frame, { shape: c.footprintShape, maxDepth: c.maxDepth, minWidth: c.minWidth, areaCap: cap, placement: 'fond' });
  if (!gen.ring || ringArea(gen.ring) < 30 || minWidth(gen.ring) < c.minWidth) return { rear: null, reason: gen.reason ?? 'emprise arrière trop étroite' };
  // Accès : une allée libre de 3,5 m le long du bâtiment sur rue (d'un côté ou de l'autre), sinon un porche.
  const pb = bbox(frame.toRing(input.parcel));
  const freeLeft = Math.max(0, frb.minX - pb.minX);
  const freeRight = Math.max(0, pb.maxX - frb.maxX);
  const access: 'allee' | 'porche' = Math.max(freeLeft, freeRight) >= ACCESS_WIDTH ? 'allee' : 'porche';
  const porchArea = access === 'porche' ? ACCESS_WIDTH * (frb.maxY - frb.minY) : 0;
  const levels = Math.max(0, Math.min(c.secondLevels, c.levels));
  const rc: Criteria = { ...c, levels, attic: false, groundFloorUse: c.upperUse === 'bureaux' ? 'commerce' : 'logement' };
  const fpEdges = classifyFootprintEdges(gen.ring, edges);
  const program = computeProgram({ footprint: gen.ring, footprintEdges: fpEdges, atticFootprint: null, criteria: rc, assumptions: a, rampLoss: 0 });
  // Niveaux et logements du bâtiment arrière : identifiants distincts de ceux du bâtiment sur rue.
  const levelsPlan = program.levels.map((l) => ({ ...l, building: 2 as const, id: `B2-${l.id}`, label: `Bât. arrière · ${l.label}` }));
  const dwellings = program.dwellings.map((d) => ({ ...d, levelId: `B2-${d.levelId}` }));
  return { rear: { ring: gen.ring, fpEdges, program: { ...program, levels: levelsPlan, dwellings }, access, porchArea } };
}
