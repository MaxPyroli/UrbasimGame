import type { LonLat, Market } from '../engine';

/** Équipements dont la proximité valorise un terrain (données IGN BD TOPO). */
export type PoiKind = 'metro' | 'gare' | 'tram' | 'mairie' | 'ecole' | 'superieur' | 'parc' | 'sante';

export interface Poi {
  kind: PoiKind;
  name: string;
  lon: number;
  lat: number;
}

export interface LocationRule {
  label: string;
  /** Hausse des prix de vente quand on est au pied de l'équipement (0,10 = +10 %). */
  bonus: number;
  /** Distance (m) à laquelle l'effet est divisé par e ≈ 2,7. */
  scale: number;
}

/**
 * Ordres de grandeur : la desserte lourde pèse le plus (métro, RER/gare), puis le centre-ville (mairie), puis les
 * équipements du quotidien. Seul l'équipement le plus proche de chaque type compte ; l'effet décroît avec la distance.
 * À calibrer avec des prix réels (DVF) avant d'en tirer des conclusions.
 */
export const LOCATION_RULES: Record<PoiKind, LocationRule> = {
  metro: { label: 'Station de métro', bonus: 0.14, scale: 350 },
  gare: { label: 'Gare', bonus: 0.14, scale: 450 },
  tram: { label: 'Station de tramway', bonus: 0.05, scale: 250 },
  mairie: { label: 'Centre-ville (mairie)', bonus: 0.08, scale: 350 },
  ecole: { label: 'École, collège, lycée', bonus: 0.02, scale: 250 },
  superieur: { label: 'Enseignement supérieur', bonus: 0.01, scale: 400 },
  parc: { label: 'Espace public, parc', bonus: 0.02, scale: 200 },
  sante: { label: 'Hôpital', bonus: 0.02, scale: 400 },
};

/** Au-delà de cette distance (m), un équipement n'a plus d'effet. */
const MAX_DISTANCE = 1200;
/** Bornes du coefficient final. */
export const MIN_LOCATION_FACTOR = 0.85;
export const MAX_LOCATION_FACTOR = 1.3;

/** Distance en mètres (projection équirectangulaire, suffisante à l'échelle d'un quartier). */
export function distanceM(a: LonLat, b: LonLat): number {
  const k = 111319.49; // mètres par degré, comme LocalProjection
  const dx = (a.lon - b.lon) * k * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const dy = (a.lat - b.lat) * k;
  return Math.hypot(dx, dy);
}

export interface LocationPart {
  kind: PoiKind;
  name: string;
  distance: number;
  /** Contribution à la hausse des prix (0,03 = +3 %). */
  bonus: number;
}

/** Contributions de chaque type d'équipement en un point (le plus proche de chaque type), de la plus forte à la plus faible. */
export function locationParts(point: LonLat, pois: Poi[]): LocationPart[] {
  const nearest = new Map<PoiKind, { poi: Poi; d: number }>();
  for (const poi of pois) {
    const d = distanceM(point, poi);
    if (d > MAX_DISTANCE) continue;
    const cur = nearest.get(poi.kind);
    if (!cur || d < cur.d) nearest.set(poi.kind, { poi, d });
  }
  const parts: LocationPart[] = [];
  for (const [kind, { poi, d }] of nearest) {
    const r = LOCATION_RULES[kind];
    parts.push({ kind, name: poi.name, distance: Math.round(d), bonus: r.bonus * Math.exp(-d / r.scale) });
  }
  return parts.sort((a, b) => b.bonus - a.bonus);
}

/** Hausse brute des prix de vente (somme des contributions). */
export const rawLocationBonus = (point: LonLat, pois: Poi[]) => locationParts(point, pois).reduce((s, p) => s + p.bonus, 0);

/**
 * Coefficient de situation de chaque point, normalisé pour que le terrain médian du quartier vaille 1 : le marché
 * (prix de référence) décrit le quartier moyen, la situation écarte au-dessus ou en dessous.
 */
export function locationFactors(points: LonLat[], pois: Poi[]): number[] {
  if (points.length === 0) return [];
  const raw = points.map((p) => rawLocationBonus(p, pois));
  const sorted = [...raw].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return raw.map((r) => Math.min(MAX_LOCATION_FACTOR, Math.max(MIN_LOCATION_FACTOR, (1 + r) / (1 + median))));
}

/** Marché ajusté à la situation d'un terrain : seuls les prix de vente suivent, pas les coûts de construction. */
export function marketAt(market: Market, factor: number): Market {
  if (factor === 1) return market;
  return {
    ...market,
    housingPerShab: market.housingPerShab * factor,
    commercePerSdp: market.commercePerSdp * factor,
    officePerSdp: market.officePerSdp * factor,
    parkingBasementSpace: market.parkingBasementSpace * factor,
    parkingOtherSpace: market.parkingOtherSpace * factor,
  };
}
