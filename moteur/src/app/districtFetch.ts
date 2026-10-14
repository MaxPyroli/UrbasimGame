import { type ContextBuilding, type LonLat, type MarketId, buildingsCredit } from '../engine';
import { buildDistrict, type District } from '../game/district';
import { fetchNearbyBuildings } from './services';

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
  const fetchedAt = new Date().toISOString().slice(0, 10);
  const buildings: ContextBuilding[] = b.buildings;
  return buildDistrict({
    ...opts,
    cadastre,
    buildings,
    credits: ['Parcelles : IGN / DGFiP, cadastre Etalab (Licence Ouverte 2.0)', buildingsCredit(buildings, fetchedAt)],
    fetchedAt,
  });
}
