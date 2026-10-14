import {
  FLOOR_FALLBACK,
  LocalProjection,
  bbox,
  cleanRing,
  computeProject,
  distToSegment,
  intersection,
  multiArea,
  ringArea,
  toMulti,
  DEFAULT_CRITERIA,
  type ContextBuilding,
  type LonLat,
  type MarketId,
  type Ring,
} from '../engine';
import { DEFAULT_CONFIG, defaultAskingPrice, type PlotSeed } from './game';
import { MARKETS } from '../engine';

/** Parcelle cadastrale prête pour le jeu. */
export interface DistrictParcel {
  /** Identifiant unique de parcelle (IDU cadastral). */
  id: string;
  /** Libellé lisible : section, numéro, surface. */
  label: string;
  ring: LonLat[];
  /** Arêtes donnant sur le domaine public (aucune parcelle voisine). */
  streetEdges: number[];
  area: number;
  /** Surface de plancher du bâti existant (emprise × niveaux, BD TOPO), m². */
  existingSdp: number;
  /** Prix de référence du terrain avec la configuration par défaut (calcul long, donc mémorisé dans l'instantané). */
  basePrice?: number;
}

/** Un quartier jouable : instantané de données ouvertes, utilisable hors ligne. */
export interface District {
  name: string;
  center: LonLat;
  radius: number;
  /** Marché de référence du bilan. */
  market: MarketId;
  parcels: DistrictParcel[];
  /** Mentions de licence à afficher (IGN, Licence Ouverte 2.0). */
  credits: string[];
  /** Date de l'instantané (AAAA-MM-JJ). */
  fetchedAt: string;
}

export interface DistrictSource {
  name: string;
  center: LonLat;
  radius: number;
  market: MarketId;
  /** FeatureCollection de l'API Carto cadastre (parcelles autour du quartier, marge comprise). */
  cadastre: unknown;
  buildings: ContextBuilding[];
  credits: string[];
  fetchedAt: string;
}

export const MIN_PARCEL_AREA = 60;
export const MAX_PARCEL_AREA = 3000;
/** Deux arêtes à moins de cette distance (m) sont considérées comme mitoyennes. */
const SHARED_TOLERANCE = 0.6;

const outerOf = (g: any): number[][] | null => {
  if (g?.type === 'Polygon') return g.coordinates[0];
  if (g?.type === 'MultiPolygon') {
    // plus grand polygone du multipolygone
    let best: number[][] | null = null;
    let bestA = -1;
    for (const poly of g.coordinates) {
      const r = poly[0] as number[][];
      let a = 0;
      for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
      if (Math.abs(a) > bestA) {
        bestA = Math.abs(a);
        best = r;
      }
    }
    return best;
  }
  return null;
};

/**
 * Transforme les parcelles cadastrales et le bâti IGN en parcelles de jeu : contour simplifié, façades sur rue
 * (arêtes sans parcelle voisine) et surface bâtie existante. Les parcelles trop petites, trop grandes ou enclavées
 * (aucune façade sur rue) sont écartées. Seules celles dont le centre est dans le rayon sont conservées ; les autres
 * ne servent qu'à reconnaître les voisines. Pure et déterministe.
 */
export function buildDistrict(src: DistrictSource): District {
  const proj = new LocalProjection(src.center.lon, src.center.lat);
  const features: any[] = (src.cadastre as any)?.features ?? [];

  interface Item {
    id: string;
    label: string;
    ring: Ring;
    props: any;
  }
  const items: Item[] = [];
  for (const f of features) {
    const c = outerOf(f.geometry);
    if (!c || c.length < 4) continue;
    const raw = c.slice(0, -1).map(([x, y]) => proj.toLocal({ lon: x, lat: y }));
    const ring = cleanRing(raw, 0.08);
    if (ring.length < 3) continue;
    const p = f.properties ?? {};
    const id = String(p.idu ?? f.id ?? `${p.section}${p.numero}`);
    items.push({ id, label: [p.section && p.numero ? `${p.section} ${p.numero}` : id, p.nom_com ?? ''].filter(Boolean).join(' · '), ring, props: p });
  }

  const boxes = items.map((it) => bbox(it.ring));
  const near = (i: number, j: number) => {
    const a = boxes[i];
    const b = boxes[j];
    const m = SHARED_TOLERANCE + 0.5;
    return !(a.maxX + m < b.minX || b.maxX + m < a.minX || a.maxY + m < b.minY || b.maxY + m < a.minY);
  };

  // Bâtiments projetés une fois.
  const blds = src.buildings.map((b) => {
    const outer = b.outer.map((q) => proj.toLocal(q));
    return { outer, holes: b.holes.map((h) => h.map((q) => proj.toLocal(q))), box: bbox(outer), floors: Math.max(1, Math.round(b.height / FLOOR_FALLBACK)) };
  });

  const parcels: DistrictParcel[] = [];
  const seen = new Set<string>();
  items.forEach((it, i) => {
    if (seen.has(it.id)) return;
    seen.add(it.id);
    const area = ringArea(it.ring);
    if (area < MIN_PARCEL_AREA || area > MAX_PARCEL_AREA) return;
    const cx = it.ring.reduce((s, q) => s + q[0], 0) / it.ring.length;
    const cy = it.ring.reduce((s, q) => s + q[1], 0) / it.ring.length;
    if (Math.hypot(cx, cy) > src.radius) return;

    const neighbours = items.filter((o, j) => j !== i && o.id !== it.id && near(i, j));
    const streetEdges: number[] = [];
    it.ring.forEach((a, k) => {
      const b = it.ring[(k + 1) % it.ring.length];
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const shared = neighbours.some((n) => n.ring.some((q, m) => distToSegment(mid, q, n.ring[(m + 1) % n.ring.length]) < SHARED_TOLERANCE));
      if (!shared) streetEdges.push(k);
    });
    if (streetEdges.length === 0) return;

    let sdp = 0;
    const pMulti = toMulti(it.ring);
    const pb = boxes[i];
    for (const b of blds) {
      if (b.box.maxX < pb.minX || b.box.minX > pb.maxX || b.box.maxY < pb.minY || b.box.minY > pb.maxY) continue;
      try {
        const overlap = multiArea(intersection(pMulti, [[b.outer, ...b.holes]]));
        if (overlap >= 5) sdp += overlap * b.floors;
      } catch {
        /* géométrie dégénérée : ce bâtiment est ignoré */
      }
    }

    parcels.push({
      id: it.id,
      label: `${it.label} · ${Math.round(area)} m²`,
      ring: it.ring.map((q) => proj.toLonLat(q)),
      streetEdges,
      area: Math.round(area),
      existingSdp: Math.round(sdp),
    });
  });

  parcels.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { name: src.name, center: src.center, radius: src.radius, market: src.market, parcels, credits: src.credits, fetchedAt: src.fetchedAt };
}

/**
 * Parcelles du quartier pour une partie. On écarte celles où rien n'est constructible (même un R+0) :
 * personne ne doit pouvoir acheter un terrain mort.
 */
export function districtToSeeds(d: District): PlotSeed[] {
  const seeds: PlotSeed[] = [];
  for (const p of d.parcels) {
    const parcel = { ring: p.ring, streetEdges: p.streetEdges };
    const ok = [1, 3].some((levels) => {
      const pr = computeProject(parcel, { ...DEFAULT_CRITERIA, levels });
      return pr.footprint !== null && pr.checks.every((c) => c.status !== 'error');
    });
    if (ok) seeds.push({ id: p.id, parcel, existingSdp: p.existingSdp, label: p.label, ...(p.basePrice ? { askingPrice: p.basePrice } : {}) });
  }
  return seeds;
}

/** Calcule et mémorise le prix de référence de chaque parcelle (configuration par défaut du marché du quartier). */
export function withBasePrices(d: District): District {
  const config = { ...DEFAULT_CONFIG, market: MARKETS[d.market] };
  return { ...d, parcels: d.parcels.map((p) => ({ ...p, basePrice: defaultAskingPrice(p.id, { ring: p.ring, streetEdges: p.streetEdges }, p.existingSdp, config) })) };
}
