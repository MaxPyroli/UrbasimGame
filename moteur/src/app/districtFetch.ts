import { type ContextBuilding, type LonLat, type MarketId, buildingsCredit } from '../engine';
import { buildDistrict, type District, type DistrictRoad } from '../game/district';
import type { Poi, PoiKind } from '../game/location';
import { fetchNearbyBuildings, fetchWfsPage } from './services';

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

/** Toutes les parcelles cadastrales (API Carto IGN, Licence Ouverte 2.0) d'un carré autour du centre, par pages. */
export async function fetchCadastreBox(center: LonLat, radius: number): Promise<{ type: 'FeatureCollection'; features: any[] }> {
  const dLat = radius / 110574;
  const dLon = radius / (111320 * Math.cos((center.lat * Math.PI) / 180));
  const box = [center.lon - dLon, center.lat - dLat, center.lon + dLon, center.lat + dLat];
  const geom = { type: 'Polygon', coordinates: [[[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]], [box[0], box[1]]]] };
  const features: any[] = [];
  for (let start = 0; start < 20 * PAGE; start += PAGE) {
    const j = await getJson(`${API}?geom=${encodeURIComponent(JSON.stringify(geom))}&_limit=${PAGE}&_start=${start}`);
    const got: any[] = j.features ?? [];
    features.push(...got);
    if (got.length < PAGE) break;
  }
  return { type: 'FeatureCollection', features };
}

/** Télécharge un quartier (cadastre + bâti BD TOPO) et en fait un instantané jouable hors ligne. */
export async function fetchDistrict(opts: { name: string; center: LonLat; radius: number; market: MarketId }): Promise<District> {
  const { center, radius } = opts;
  const cadastre = await fetchCadastreBox(center, radius + MARGIN);
  const b = await fetchNearbyBuildings(center.lon, center.lat, radius + MARGIN);
  const pois = await fetchPois(center, radius);
  const roads = await fetchRoads(center, radius);
  const fetchedAt = new Date().toISOString().slice(0, 10);
  const buildings: ContextBuilding[] = b.buildings;
  return buildDistrict({
    ...opts,
    cadastre,
    buildings,
    pois,
    roads,
    credits: ['Parcelles : IGN / DGFiP, cadastre Etalab (Licence Ouverte 2.0)', buildingsCredit(buildings, fetchedAt), 'Équipements : IGN, BD TOPO® (Licence Ouverte 2.0)'],
    fetchedAt,
  });
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
