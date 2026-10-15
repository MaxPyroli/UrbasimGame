import {
  FLOOR_FALLBACK,
  LocalProjection,
  bbox,
  cleanRing,
  distToSegment,
  intersection,
  multiArea,
  ringArea,
  toMulti,
  type ContextBuilding,
  type LonLat,
  type MarketId,
  type Ring,
} from '../engine';
import { DEFAULT_CONFIG, appraise, defaultAskingPrice, plotIssue, ruleOf, type PlotSeed } from './game';
import { mergeParcels } from './merge';
import { ZONE_RULES, adaptToDensity } from './plu';
import type { Density, PlotIssue, ZoneFamily } from './types';
import { locationFactors, type Poi } from './location';
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
  /** Hauteur du plus haut bâtiment existant sur la parcelle (m), 0 si aucun. */
  existingHeight: number;
  /** Famille et code de la zone du PLU au centre de la parcelle (absent si le zonage n'est pas connu). */
  zone?: ZoneFamily;
  zoneCode?: string;
  /** Densité du bâti dans les 70 m alentour (voir `withDensity`). */
  density?: Density;
  /** Coefficient de situation sur les prix de vente (1 = parcelle médiane du quartier) : transports, centre, équipements. */
  locationFactor: number;
  /** Résultat de l'analyse : `null` = constructible seul, sinon la raison. Absent tant que le quartier n'a pas été analysé (`withBasePrices`). */
  issue?: PlotIssue | null;
  /** Prix de référence du terrain avec la configuration par défaut (calcul long, donc mémorisé dans l'instantané). */
  basePrice?: number;
}

/** Bâtiment existant, pour l'affichage de la carte (BD TOPO). */
export interface DistrictBuilding {
  /** Contour extérieur [lon, lat], 6 décimales. */
  ring: [number, number][];
  /** Hauteur (m). */
  height: number;
  /** Vrai si la hauteur est estimée (non renseignée dans la donnée). */
  estimated: boolean;
}

/** Tronçon de route pour le fond de carte hors ligne (BD TOPO). */
export interface DistrictRoad {
  /** Points [lon, lat], 5 décimales. */
  line: [number, number][];
  /** Importance IGN : 1 (axe majeur) à 6 (desserte locale). */
  importance: number;
}

/** Zone du PLU, pour la carte : contours extérieurs simplifiés [lon, lat]. */
export interface DistrictZone {
  code: string;
  /** Libellé long du Géoportail de l'Urbanisme (ex. « Centralité »). */
  label: string;
  family: ZoneFamily;
  rings: [number, number][][];
}

/** Un quartier jouable : instantané de données ouvertes, utilisable hors ligne. */
export interface District {
  name: string;
  center: LonLat;
  radius: number;
  /** Marché de référence du bilan. */
  market: MarketId;
  parcels: DistrictParcel[];
  buildings: DistrictBuilding[];
  /** Équipements qui valorisent les terrains alentour (y compris juste hors du quartier). */
  pois: Poi[];
  /** Voies autour du quartier, pour dessiner la carte sans fond de plan (facultatif dans les anciens instantanés). */
  roads?: DistrictRoad[];
  /** Zonage du PLU (facultatif dans les anciens instantanés). */
  zones?: DistrictZone[];
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
  pois: Poi[];
  roads?: DistrictRoad[];
  zones?: DistrictZone[];
  credits: string[];
  fetchedAt: string;
}

/** Point dans un contour [lon, lat] (lancer de rayon). */
export function pointInRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const MIN_PARCEL_AREA = 20;
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
 * (aucune façade sur rue) sont conservées avec une liste de façades vide. Seules celles dont le centre est dans le rayon sont conservées ; les autres
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
    const ring = cleanRing(raw, 0.2);
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
    return { outer, holes: b.holes.map((h) => h.map((q) => proj.toLocal(q))), box: bbox(outer), floors: Math.max(1, Math.round(b.height / FLOOR_FALLBACK)), height: b.height };
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
    let sdp = 0;
    let tallest = 0;
    const pMulti = toMulti(it.ring);
    const pb = boxes[i];
    for (const b of blds) {
      if (b.box.maxX < pb.minX || b.box.minX > pb.maxX || b.box.maxY < pb.minY || b.box.minY > pb.maxY) continue;
      try {
        const overlap = multiArea(intersection(pMulti, [[b.outer, ...b.holes]]));
        if (overlap >= 5) {
          sdp += overlap * b.floors;
          tallest = Math.max(tallest, b.height);
        }
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
      existingHeight: Math.round(tallest * 10) / 10,
      locationFactor: 1,
    });
  });

  parcels.sort((a, b) => (a.id < b.id ? -1 : 1));
  const factors = locationFactors(
    parcels.map((p) => ({ lon: p.ring.reduce((t, q) => t + q.lon, 0) / p.ring.length, lat: p.ring.reduce((t, q) => t + q.lat, 0) / p.ring.length })),
    src.pois,
  );
  parcels.forEach((p, i) => (p.locationFactor = Math.round(factors[i] * 1000) / 1000));
  // Zone du PLU : celle qui contient le centre de la parcelle (sinon la plus proche en contenance : rien).
  for (const p of parcels) {
    const c = { lon: p.ring.reduce((t, q) => t + q.lon, 0) / p.ring.length, lat: p.ring.reduce((t, q) => t + q.lat, 0) / p.ring.length };
    const z = (src.zones ?? []).find((zone) => zone.rings.some((r) => pointInRing(c.lon, c.lat, r)));
    if (z) {
      p.zone = z.family;
      p.zoneCode = z.code;
    }
  }
  const buildings: DistrictBuilding[] = [];
  for (const b of src.buildings) {
    if (b.outer.length < 3) continue;
    const loc = b.outer.map((q) => proj.toLocal(q));
    const cx = loc.reduce((t, q) => t + q[0], 0) / loc.length;
    const cy = loc.reduce((t, q) => t + q[1], 0) / loc.length;
    if (Math.hypot(cx, cy) > src.radius + 15) continue;
    buildings.push({ ring: b.outer.map((q) => [Math.round(q.lon * 1e6) / 1e6, Math.round(q.lat * 1e6) / 1e6]), height: Math.round(b.height * 10) / 10, estimated: b.estimated });
  }
  return { name: src.name, center: src.center, radius: src.radius, market: src.market, parcels, buildings, pois: src.pois, ...(src.roads ? { roads: src.roads } : {}), ...(src.zones ? { zones: src.zones } : {}), credits: src.credits, fetchedAt: src.fetchedAt };
}

/** Rayon (m) sur lequel on mesure la densité du bâti autour d'une parcelle, et seuils de part d'emprise bâtie. */
const DENSITY_RADIUS = 70;
const DENSE_COVER = 0.35;
const DIFFUSE_COVER = 0.26;

/** Règle du PLU d'une parcelle du quartier, adaptée à la densité de son environnement. */
const parcelRule = (p: DistrictParcel) => (p.zone ? adaptToDensity(ZONE_RULES[p.zone], p.density) : null);

/**
 * Densité du tissu bâti autour de chaque parcelle : part de la surface (rayon de 70 m) couverte par des bâtiments. Les
 * îlots continus du centre-ville sont « denses » (bâtiments mitoyens, construction en limite), les quartiers aérés
 * « diffus ». Déterministe, calculé à partir des bâtiments de l'instantané.
 */
export function withDensity(d: District): District {
  const kx = 111320 * Math.cos((d.center.lat * Math.PI) / 180);
  const ky = 110540;
  const local = (lon: number, lat: number): [number, number] => [(lon - d.center.lon) * kx, (lat - d.center.lat) * ky];
  const blds = d.buildings.map((b) => {
    const pts = b.ring.map(([lon, lat]) => local(lon, lat));
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return { x: pts.reduce((t, p) => t + p[0], 0) / pts.length, y: pts.reduce((t, p) => t + p[1], 0) / pts.length, area: Math.abs(a) / 2 };
  });
  return {
    ...d,
    parcels: d.parcels.map((p) => {
      const [cx, cy] = [p.ring.reduce((t, q) => t + local(q.lon, q.lat)[0], 0) / p.ring.length, p.ring.reduce((t, q) => t + local(q.lon, q.lat)[1], 0) / p.ring.length];
      const built = blds.filter((b) => Math.hypot(b.x - cx, b.y - cy) <= DENSITY_RADIUS).reduce((t, b) => t + b.area, 0);
      const cover = built / (Math.PI * DENSITY_RADIUS * DENSITY_RADIUS);
      const density: Density = cover >= DENSE_COVER ? 'dense' : cover < DIFFUSE_COVER ? 'diffuse' : 'moyenne';
      return { ...p, density };
    }),
  };
}

/**
 * Parcelles du quartier pour une partie. Celles qui ne sont pas constructibles seules (trop petites, enclavées)
 * restent affichées et achetables, marquées d'un `issue` : il faut les assembler avec des voisines.
 */
export function districtToSeeds(d: District): PlotSeed[] {
  const seeds: PlotSeed[] = [];
  for (const p of d.parcels) {
    const parcel = { ring: p.ring, streetEdges: p.streetEdges };
    // Analyse mémorisée dans l'instantané (longue à calculer) ; sinon, contrôle géométrique rapide.
    const issue = p.issue !== undefined ? p.issue ?? undefined : plotIssue(parcel, undefined, 1, parcelRule(p));
    seeds.push({ id: p.id, parcel, existingSdp: p.existingSdp, existingHeight: p.existingHeight, locationFactor: p.locationFactor, label: p.label, ...(issue ? { issue } : {}), ...(p.zone ? { zones: [p.zone], ...(p.zoneCode ? { zoneCode: p.zoneCode } : {}) } : {}), ...(p.density ? { density: p.density } : {}), ...(p.basePrice ? { askingPrice: p.basePrice } : {}) });
  }
  return seeds;
}

/**
 * Repère les « délaissés » : parcelles non constructibles seules qui n'apportent presque rien même assemblées (aucun voisin
 * avec qui les assembler, ou un gain de valeur inférieur à leur propre prix plancher). Elles restent dans le jeu, mais ne sont
 * ni mises en vente ni convoitées par les concurrents. Calcul long, mémorisé dans l'instantané.
 */
export function withWasteland(d: District): District {
  const config = { ...DEFAULT_CONFIG, market: MARKETS[d.market] };
  const kx = 111320 * Math.cos((d.center.lat * Math.PI) / 180);
  const ky = 110540;
  const info = d.parcels.map((p) => {
    const parcel = { ring: p.ring, streetEdges: p.streetEdges };
    const cx = p.ring.reduce((t, q) => t + q.lon, 0) / p.ring.length;
    const cy = p.ring.reduce((t, q) => t + q.lat, 0) / p.ring.length;
    return { p, parcel, cx, cy, rule: parcelRule(p) };
  });
  const alone = info.map((a) => (a.p.issue ? 0 : appraise(a.parcel, a.p.existingSdp, config, a.p.locationFactor, a.rule).best));
  const useless = new Set<string>();
  info.forEach((a, i) => {
    if (!a.p.issue || a.p.issue === 'zone') return;
    let gain = 0;
    let neighbours = 0;
    for (let j = 0; j < info.length; j++) {
      const b = info[j];
      if (j === i || Math.hypot((a.cx - b.cx) * kx, (a.cy - b.cy) * ky) > 90) continue;
      const m = mergeParcels([a.parcel, b.parcel]);
      if (!m.ok) continue;
      neighbours++;
      const zones = [...new Set([...(a.p.zone ? [a.p.zone] : []), ...(b.p.zone ? [b.p.zone] : [])])];
      const rule = ruleOf({ zones, density: b.p.density });
      if (plotIssue(m.parcel, config, b.p.locationFactor, rule)) continue;
      gain = Math.max(gain, appraise(m.parcel, a.p.existingSdp + b.p.existingSdp, config, b.p.locationFactor, rule).best - alone[j]);
    }
    const floor = 0.6 * a.p.area * config.market.landPerSdp * a.p.locationFactor;
    if (neighbours === 0 || gain < floor) useless.add(a.p.id);
  });
  return { ...d, parcels: d.parcels.map((p) => (useless.has(p.id) ? { ...p, issue: 'delaisse' as const } : p)) };
}

/** Analyse chaque parcelle une fois pour toutes : prix de référence et constructibilité seule (long : ~10 s) ; mémorisés dans l'instantané (configuration par défaut du marché du quartier). */
export function withBasePrices(source: District): District {
  const d = withDensity(source);
  const config = { ...DEFAULT_CONFIG, market: MARKETS[d.market] };
  return withWasteland({ ...d, parcels: d.parcels.map((p) => ({ ...p, basePrice: defaultAskingPrice(p.id, { ring: p.ring, streetEdges: p.streetEdges }, p.existingSdp, config, p.locationFactor, parcelRule(p)), issue: plotIssue({ ring: p.ring, streetEdges: p.streetEdges }, config, p.locationFactor, parcelRule(p)) ?? null })) });
}
