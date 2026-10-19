import { type ContextBuilding, type LonLat, type MarketId, MARKETS, buildingsCredit } from '../engine';
import { buildDistrict, type District, type DistrictRoad, type DistrictZone } from '../game/district';
import { zoneFamily } from '../game/plu';
import type { Poi, PoiKind } from '../game/location';
import { fetchNearbyBuildings, fetchWfsPage } from './services';
import { deriveMarketAdjust, fetchMarketStats, marketMix } from './dvf';

const API = 'https://apicarto.ign.fr/api/cadastre/parcelle';
const PAGE = 500;
/** Marge autour du rayon : les parcelles du bord doivent voir leurs voisines pour reconnaître leurs façades sur rue. */
const MARGIN = 35;

async function getJson(url: string): Promise<any> {
  let last: unknown = null;
  for (const wait of [0, 1500, 5500]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
      last = new Error(`HTTP ${r.status}`);
      if (r.status < 500 && r.status !== 429) break;
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error('réseau');
}

/** Pages du cadastre demandées en même temps (chaque page de 1 000 parcelles met plusieurs secondes à répondre). */
const PAGE_CONCURRENCY = 4;

/** Lit toutes les pages d'un service paginé, par lots de `PAGE_CONCURRENCY` pages à la fois, jusqu'à la première page incomplète. */
async function getAllPages(urlAt: (start: number) => string, maxPages: number): Promise<any[]> {
  const features: any[] = [];
  for (let page = 0; page < maxPages; page += PAGE_CONCURRENCY) {
    const batch = await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, maxPages - page) }, (_, k) => getJson(urlAt((page + k) * PAGE))));
    let full = true;
    for (const j of batch) {
      const got: any[] = j.features ?? [];
      features.push(...got);
      if (got.length < PAGE) full = false;
    }
    if (!full) break;
  }
  return features;
}

/** Toutes les parcelles cadastrales (API Carto IGN, Licence Ouverte 2.0) d'un carré autour du centre, par pages. */
export async function fetchCadastreBox(center: LonLat, radius: number): Promise<{ type: 'FeatureCollection'; features: any[] }> {
  const dLat = radius / 110574;
  const dLon = radius / (111320 * Math.cos((center.lat * Math.PI) / 180));
  const box = [center.lon - dLon, center.lat - dLat, center.lon + dLon, center.lat + dLat];
  const geom = { type: 'Polygon', coordinates: [[[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]], [box[0], box[1]]]] };
  const features = await getAllPages((start) => `${API}?geom=${encodeURIComponent(JSON.stringify(geom))}&_limit=${PAGE}&_start=${start}`, 20);
  return { type: 'FeatureCollection', features };
}

/** Télécharge un quartier (cadastre + bâti BD TOPO) et en fait un instantané jouable hors ligne. */
export async function fetchDistrict(opts: { name: string; center: LonLat; radius: number; market: MarketId }): Promise<District> {
  const { center, radius } = opts;
  const cadastre = await fetchCadastreBox(center, radius + MARGIN);
  const b = await fetchNearbyBuildings(center.lon, center.lat, radius + MARGIN);
  const pois = await fetchPois(center, radius);
  const roads = await fetchRoads(center, radius);
  const zones = await fetchZones(center, radius);
  const fetchedAt = new Date().toISOString().slice(0, 10);
  const buildings: ContextBuilding[] = b.buildings;
  return buildDistrict({
    ...opts,
    cadastre,
    buildings,
    pois,
    roads,
    zones,
    credits: ['Parcelles : IGN / DGFiP, cadastre Etalab (Licence Ouverte 2.0)', buildingsCredit(buildings, fetchedAt), 'Équipements : IGN, BD TOPO® (Licence Ouverte 2.0)', 'Zonage : Géoportail de l’Urbanisme (PLUi, Licence Ouverte 2.0)'],
    fetchedAt,
  });
}

/** Toutes les parcelles cadastrales d'une commune (code INSEE), par pages. */
export async function fetchCadastreCommune(insee: string, arr?: string): Promise<{ type: 'FeatureCollection'; features: any[] }> {
  const features = await getAllPages((start) => `${API}?code_insee=${insee}${arr ? `&code_arr=${arr}` : ''}&_limit=${PAGE}&_start=${start}`, 60);
  return { type: 'FeatureCollection', features };
}

/** Contour de la commune (anneaux extérieurs [lon, lat], simplifiés à 3 m) : sert à n'afficher que ce qui est dans la commune. */
export async function fetchCommuneOutline(insee: string): Promise<[number, number][][]> {
  const j = await getJson(`https://apicarto.ign.fr/api/cadastre/commune?code_insee=${insee}`);
  const rings: [number, number][][] = [];
  for (const f of j.features ?? []) {
    const polys: number[][][][] = f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates : f.geometry?.type === 'Polygon' ? [f.geometry.coordinates] : [];
    for (const poly of polys) {
      const ring = poly[0].map((q) => [Math.round(q[0] * 1e5) / 1e5, Math.round(q[1] * 1e5) / 1e5] as [number, number]);
      const lat = ring.reduce((s, q) => s + q[1], 0) / ring.length;
      const simple = simplifyRing(ring, 3, lat);
      if (simple.length >= 4) rings.push(simple);
    }
  }
  return rings;
}

/** Rectangle englobant (lon/lat) d'une commune, d'après le contour de l'API Carto cadastre. */
export async function fetchCommuneBounds(insee: string): Promise<{ minLon: number; maxLon: number; minLat: number; maxLat: number }> {
  const j = await getJson(`https://apicarto.ign.fr/api/cadastre/commune?code_insee=${insee}`);
  let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
  for (const f of j.features ?? []) {
    const polys: number[][][][] = f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry?.coordinates];
    for (const poly of polys) for (const q of poly?.[0] ?? []) {
      minLon = Math.min(minLon, q[0]); maxLon = Math.max(maxLon, q[0]);
      minLat = Math.min(minLat, q[1]); maxLat = Math.max(maxLat, q[1]);
    }
  }
  return { minLon, maxLon, minLat, maxLat };
}

/**
 * Télécharge toute une commune : parcelles par code INSEE, puis bâti, voies, équipements et zonage par carreaux d'environ
 * 1 km (les services plafonnent le nombre d'objets par requête). Les objets à cheval sur deux carreaux sont dédoublonnés.
 */
export interface CommuneOptions {
  name: string;
  insee: string;
  market: MarketId;
  /** Arrondissement (Paris, Lyon, Marseille) : code d'arrondissement du cadastre (ex. « 111 » pour Paris 11e). */
  arr?: string;
  /** Secteur autour d'un point plutôt que la commune entière (grandes communes, ou service qui refuse la requête par commune). */
  sector?: { center: LonLat; radius: number };
  /** Côté des carreaux de téléchargement (m) : 1 000 par défaut, moins en tissu très dense (le service plafonne les objets par requête). */
  tile?: number;
  /** Adapte les prix du marché de référence au niveau des ventes réelles de la commune. */
  adjustMarket?: boolean;
  /** Code des ventes réelles (DVF) si différent du code INSEE : arrondissement (75111 pour Paris 11e). Par défaut déduit de `arr`. */
  dvfInsee?: string;
  log?: (m: string) => void;
}

/** Rectangle englobant (lon/lat) d'un ensemble de parcelles GeoJSON. */
function boundsOf(features: any[]): { minLon: number; maxLon: number; minLat: number; maxLat: number } {
  let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
  for (const f of features) {
    const polys: number[][][][] = f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates : f.geometry?.type === 'Polygon' ? [f.geometry.coordinates] : [];
    for (const poly of polys) for (const q of poly[0] ?? []) {
      minLon = Math.min(minLon, q[0]); maxLon = Math.max(maxLon, q[0]);
      minLat = Math.min(minLat, q[1]); maxLat = Math.max(maxLat, q[1]);
    }
  }
  return { minLon, maxLon, minLat, maxLat };
}

/** Au-delà de cette surface (m²), une parcelle isolée est un champ ou un bois, pas un terrain à bâtir. */
const COUNTRYSIDE_PARCEL = 5000;

/** Centre (moyenne des sommets du premier contour) d'une parcelle GeoJSON. */
function featureCenter(f: any): { lon: number; lat: number } | null {
  const poly: number[][] | undefined = f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates?.[0]?.[0] : f.geometry?.type === 'Polygon' ? f.geometry.coordinates?.[0] : undefined;
  if (!poly?.length) return null;
  return { lon: poly.reduce((t, q) => t + q[0], 0) / poly.length, lat: poly.reduce((t, q) => t + q[1], 0) / poly.length };
}

/** Surface approximative (m²) d'une parcelle GeoJSON (premier contour). */
function featureArea(f: any, kx: number): number {
  const poly: number[][] | undefined = f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates?.[0]?.[0] : f.geometry?.type === 'Polygon' ? f.geometry.coordinates?.[0] : undefined;
  if (!poly || poly.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * kx * (y2 * 110574) - x2 * kx * (y1 * 110574);
  }
  return Math.abs(a) / 2;
}

/** Nombre de carreaux téléchargés en même temps. */
const TILE_CONCURRENCY = 4;

/** Exécute `fn` sur chaque élément, `limit` à la fois ; la première erreur interrompt le tout. */
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export async function fetchCommune(opts: CommuneOptions): Promise<District> {
  const log = opts.log ?? (() => {});
  // Parcelles : commune (ou arrondissement) par code, ou secteur autour d'un point ; l'étendue se déduit des parcelles.
  const cadastre = opts.sector ? await fetchCadastreBox(opts.sector.center, opts.sector.radius) : await fetchCadastreCommune(opts.insee, opts.arr);
  const bounds = boundsOf(cadastre.features);
  const center = { lon: (bounds.minLon + bounds.maxLon) / 2, lat: (bounds.minLat + bounds.maxLat) / 2 };
  const kx = 111320 * Math.cos((center.lat * Math.PI) / 180);
  const widthM = (bounds.maxLon - bounds.minLon) * kx;
  const heightM = (bounds.maxLat - bounds.minLat) * 110574;
  const radius = Math.ceil(Math.hypot(widthM, heightM) / 2 / 50) * 50;
  log(`${cadastre.features.length} parcelles`);
  const TILE = opts.tile ?? 1000;
  // Commune étendue (rurale) : on ne télécharge que les carreaux qui contiennent du bâti ou de petites parcelles (le village),
  // pas les champs et les bois ; leurs grandes parcelles agricoles sont écartées (rien à y construire).
  const tileOf = (f: any) => {
    const c = featureCenter(f);
    return c ? `${Math.floor(((c.lon - bounds.minLon) * kx) / TILE)}|${Math.floor(((c.lat - bounds.minLat) * 110574) / TILE)}` : null;
  };
  const needed = new Set<string>();
  for (const f of cadastre.features) if (featureArea(f, kx) < COUNTRYSIDE_PARCEL) needed.add(tileOf(f) ?? '');
  const kept = cadastre.features.filter((f) => needed.has(tileOf(f) ?? ''));
  if (kept.length < cadastre.features.length) {
    log(`${cadastre.features.length - kept.length} grandes parcelles de campagne écartées`);
    cadastre.features = kept;
  }
  const tiles: LonLat[] = [];
  for (let i = 0; i * TILE < widthM + TILE / 2; i++)
    for (let j = 0; j * TILE < heightM + TILE / 2; j++)
      if (needed.has(`${i}|${j}`)) tiles.push({ lon: bounds.minLon + (i * TILE + TILE / 2) / kx, lat: bounds.minLat + (j * TILE + TILE / 2) / 110574 });
  const bMap = new Map<string, ContextBuilding>();
  const poiMap = new Map<string, Poi>();
  const roadMap = new Map<string, DistrictRoad>();
  const zoneMap = new Map<string, DistrictZone>();
  let n = 0;
  // Carreaux traités par groupes (le service répond en ~0,6 s par requête : en série, une commune prend des minutes).
  await pool(tiles, TILE_CONCURRENCY, async (t) => {
    const [b, roads, zones] = await Promise.all([fetchNearbyBuildings(t.lon, t.lat, TILE / 2 + 20), fetchRoads(t, TILE / 2), fetchZones(t, TILE / 2)]);
    for (const x of b.buildings) bMap.set(x.id, x);
    for (const r of roads) roadMap.set(`${r.line[0]}|${r.line[r.line.length - 1]}|${r.line.length}`, r);
    for (const z of zones) zoneMap.set(`${z.code}|${z.label}|${z.rings[0][0]}|${z.rings.length}`, z);
    log(`carreau ${++n}/${tiles.length} : ${bMap.size} bâtiments, ${roadMap.size} voies, ${zoneMap.size} zones`);
  });
  await pool(tiles, TILE_CONCURRENCY, async (t) => {
    for (const p of await fetchPois(t, TILE / 2 - 700 > 0 ? TILE / 2 - 700 : 0)) poiMap.set(`${p.kind}|${p.lon}|${p.lat}`, p);
  });
  const fetchedAt = new Date().toISOString().slice(0, 10);
  const buildings = [...bMap.values()];
  // Ventes réelles de la commune : mix de logements et prix par typologie (absent si la commune n'a pas de ventes d'appartements).
  const stats = await fetchMarketStats(opts.dvfInsee ?? (opts.arr ? `${opts.insee.slice(0, 2)}${opts.arr.slice(-3)}` : opts.insee), opts.name, async (url) => {
    try {
      const r = await fetch(url);
      return r.ok ? await r.text() : null;
    } catch {
      return null;
    }
  });
  const district = buildDistrict({
    name: opts.name,
    center,
    radius,
    market: opts.market,
    cadastre,
    buildings,
    pois: [...poiMap.values()],
    roads: [...roadMap.values()],
    zones: [...zoneMap.values()],
    unclipped: true,
    credits: ['Parcelles : IGN / DGFiP, cadastre Etalab (Licence Ouverte 2.0)', buildingsCredit(buildings, fetchedAt), 'Équipements : IGN, BD TOPO® (Licence Ouverte 2.0)', 'Zonage : Géoportail de l’Urbanisme (PLU, Licence Ouverte 2.0)'],
    fetchedAt,
  });
  // Commune entière (ni arrondissement ni secteur) : on garde son contour pour ne montrer que ce qui y est.
  const outline = !opts.sector && !opts.arr ? await fetchCommuneOutline(opts.insee).catch(() => undefined) : undefined;
  const adjust = opts.adjustMarket && stats ? deriveMarketAdjust(MARKETS[opts.market], stats) : undefined;
  const withOutline = outline?.length ? { ...district, outline } : district;
  return stats ? { ...withOutline, marketStats: stats, ...marketMix(stats), ...(adjust ? { marketAdjust: adjust } : {}) } : withOutline;
}

const WFS = 'https://data.geopf.fr/wfs/ows';
const POI_MARGIN = 700;

/** Natures BD TOPO qui comptent pour la valeur d'un terrain, par type d'équipement. */
const TRANSPORT: Record<string, PoiKind> = {
  'Station de métro': 'metro',
  'Gare voyageurs uniquement': 'gare',
  'Gare voyageurs et fret': 'gare',
  'Station de tramway': 'tram',
};
const INTEREST: Record<string, PoiKind> = {
  Mairie: 'mairie',
  'Enseignement primaire': 'ecole',
  Collège: 'ecole',
  Lycée: 'ecole',
  'Enseignement supérieur': 'superieur',
  'Espace public': 'parc',
  'Etablissement hospitalier': 'sante',
};

/** Centre d'une géométrie GeoJSON (moyenne des sommets du premier contour) ; null si absente. */
function centerOf(g: any): { lon: number; lat: number } | null {
  if (!g) return null;
  if (g.type === 'Point') return { lon: g.coordinates[0], lat: g.coordinates[1] };
  const ring: number[][] | undefined = g.type === 'Polygon' ? g.coordinates?.[0] : g.type === 'MultiPolygon' ? g.coordinates?.[0]?.[0] : undefined;
  if (!ring?.length) return null;
  return { lon: ring.reduce((t, q) => t + q[0], 0) / ring.length, lat: ring.reduce((t, q) => t + q[1], 0) / ring.length };
}

/** Parse une réponse WFS BD TOPO en équipements, selon la table de natures donnée. */
export function parsePois(geojson: any, natures: Record<string, PoiKind>): Poi[] {
  const out: Poi[] = [];
  for (const f of geojson?.features ?? []) {
    const kind = natures[f.properties?.nature];
    const c = centerOf(f.geometry);
    if (kind && c) out.push({ kind, name: f.properties?.toponyme || f.properties?.nature, lon: Math.round(c.lon * 1e6) / 1e6, lat: Math.round(c.lat * 1e6) / 1e6 });
  }
  return out;
}

/** Équipements autour du quartier (BD TOPO : transports, mairie, écoles, espaces publics, hôpitaux), marge comprise. */
export async function fetchPois(center: LonLat, radius: number): Promise<Poi[]> {
  const r = radius + POI_MARGIN;
  const dLat = r / 110574;
  const dLon = r / (111320 * Math.cos((center.lat * Math.PI) / 180));
  const bbox = `${center.lon - dLon},${center.lat - dLat},${center.lon + dLon},${center.lat + dLat},urn:ogc:def:crs:OGC:1.3:CRS84`;
  const get = async (layer: string, natures: Record<string, PoiKind>) => {
    const url = `${WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:${layer}&OUTPUTFORMAT=application/json&SORTBY=cleabs&COUNT=1000&PROPERTYNAME=geometrie,nature,toponyme&BBOX=${encodeURIComponent(bbox)}`;
    let last: unknown = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return parsePois(await fetchWfsPage(url), natures);
      } catch (e) {
        last = e;
        await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
      }
    }
    throw last instanceof Error ? last : new Error('réseau');
  };
  const [transport, interest] = await Promise.all([get('equipement_de_transport', TRANSPORT), get('zone_d_activite_ou_d_interet', INTEREST)]);
  return [...transport, ...interest];
}

/** Voies carrossables autour du quartier (BD TOPO, tronçons de route) : sentiers et escaliers écartés. */
export async function fetchRoads(center: LonLat, radius: number): Promise<DistrictRoad[]> {
  const r = radius + 60;
  const dLat = r / 110574;
  const dLon = r / (111320 * Math.cos((center.lat * Math.PI) / 180));
  const bbox = `${center.lon - dLon},${center.lat - dLat},${center.lon + dLon},${center.lat + dLat},urn:ogc:def:crs:OGC:1.3:CRS84`;
  const out: DistrictRoad[] = [];
  for (let page = 0; page < 4; page++) {
    const url = `${WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:troncon_de_route&OUTPUTFORMAT=application/json&SORTBY=cleabs&COUNT=1000&STARTINDEX=${page * 1000}&PROPERTYNAME=geometrie,nature,importance&BBOX=${encodeURIComponent(bbox)}`;
    let json: any = null;
    for (let attempt = 0; attempt < 4 && !json; attempt++) {
      try {
        json = await fetchWfsPage(url);
      } catch {
        await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
      }
    }
    if (!json) throw new Error('routes indisponibles');
    const feats: any[] = json.features ?? [];
    for (const f of feats) {
      const nature = f.properties?.nature;
      if (nature === 'Sentier' || nature === 'Escalier') continue;
      const g = f.geometry;
      const lines: number[][][] = g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : [];
      for (const l of lines) {
        out.push({ importance: Number(f.properties?.importance) || 5, line: l.map((q) => [Math.round(q[0] * 1e5) / 1e5, Math.round(q[1] * 1e5) / 1e5] as [number, number]) });
      }
    }
    if (feats.length < 1000) break;
  }
  return out;
}

/** Simplification de Douglas-Peucker d'un contour [lon, lat] (tolérance en mètres, projection locale grossière). */
function simplifyRing(ring: [number, number][], tolM: number, lat: number): [number, number][] {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110574;
  const pts = ring.map(([x, y]) => [x * kx, y * ky]);
  const dist = (p: number[], a: number[], b: number[]) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const rec = (i: number, j: number) => {
    let max = 0;
    let idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = dist(pts[k], pts[i], pts[j]);
      if (d > max) (max = d), (idx = k);
    }
    if (max > tolM && idx > 0) {
      keep[idx] = true;
      rec(i, idx);
      rec(idx, j);
    }
  };
  rec(0, pts.length - 1);
  return ring.filter((_, i) => keep[i]);
}

/** Zonage du PLU (Géoportail de l'Urbanisme, API Carto) autour du quartier, contours simplifiés à 2 m. */
export async function fetchZones(center: LonLat, radius: number): Promise<DistrictZone[]> {
  const r = radius + 60;
  const dLat = r / 110574;
  const dLon = r / (111320 * Math.cos((center.lat * Math.PI) / 180));
  const box = [center.lon - dLon, center.lat - dLat, center.lon + dLon, center.lat + dLat];
  const geom = { type: 'Polygon', coordinates: [[[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]], [box[0], box[1]]]] };
  const json = await getJson(`https://apicarto.ign.fr/api/gpu/zone-urba?geom=${encodeURIComponent(JSON.stringify(geom))}`);
  const out: DistrictZone[] = [];
  for (const f of json.features ?? []) {
    const p = f.properties ?? {};
    const polys: number[][][][] = f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates : f.geometry?.type === 'Polygon' ? [f.geometry.coordinates] : [];
    const rings = polys
      .map((poly) => simplifyRing(poly[0].map((q) => [Math.round(q[0] * 1e5) / 1e5, Math.round(q[1] * 1e5) / 1e5] as [number, number]), 2, center.lat))
      .filter((ring) => ring.length >= 4);
    if (!rings.length) continue;
    out.push({ code: String(p.libelle ?? ''), label: String(p.libelong ?? ''), family: zoneFamily(p.typezone ?? '', p.libelle ?? '', p.libelong ?? ''), rings });
  }
  return out;
}
