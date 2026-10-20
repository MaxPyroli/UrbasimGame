import type { District } from '../../moteur/src/game';
import { isCustomId, loadCustomDistrict } from './customMaps';

/** Une carte jouable. Les données (instantané du cadastre, du bâti, du PLU, des ventes) se téléchargent une fois puis restent sur l'appareil. */
export interface DistrictInfo {
  id: string;
  /** Nom court affiché partout. */
  title: string;
  /** Ce qui caractérise la carte, en une phrase. */
  blurb: string;
  tag: string;
}

/** Catalogue des cartes proposées (pour l'instant quelques villes choisies pour leur contraste, à tester). */
export const DISTRICTS: DistrictInfo[] = [
  {
    id: 'montreuil-mairie',
    title: 'Montreuil · centre',
    blurb: 'Hyper-centre dense autour de la mairie : peu de terrains, des parcelles étroites, des règles serrées. Chaque projet est un casse-tête.',
    tag: 'Dense',
  },
  {
    id: 'sucy-en-brie',
    title: 'Sucy-en-Brie',
    blurb: 'Banlieue du Val-de-Marne, toute la commune : quartiers pavillonnaires, grands terrains, gare RER. Beaucoup de place, des prix plus bas et des projets à plusieurs bâtiments.',
    tag: 'Banlieue',
  },
  {
    id: 'paris-11e',
    title: 'Paris 11e',
    blurb: 'Le tissu le plus dense et le plus cher : parcelles minuscules, immeubles continus, presque rien de libre. Une affaire de patience et de prix.',
    tag: 'Hyper-dense',
  },
  {
    id: 'villeurbanne',
    title: 'Villeurbanne',
    blurb: 'Grande ville dense de la métropole de Lyon : renouvellement urbain, quartiers mixtes, des opérations de taille moyenne.',
    tag: 'Grande ville',
  },
  {
    id: 'brie-comte-robert',
    title: 'Brie-Comte-Robert',
    blurb: 'Seine-et-Marne, plus loin de Paris que Sucy : pavillons, grands jardins, centre ancien. Des terrains à diviser et des prix modérés.',
    tag: 'Banlieue éloignée',
  },
  {
    id: 'biarritz',
    title: 'Biarritz',
    blurb: 'Station balnéaire : des prix parmi les plus élevés de France hors Paris, une forte pression touristique, des terrains contraints par le relief et le littoral.',
    tag: 'Littoral',
  },
  {
    id: 'bourges-centre',
    title: 'Bourges · centre',
    blurb: 'Ville moyenne au marché très bas : le prix de vente couvre à peine le coût de construction, les projets sont souvent déficitaires. Il faut viser juste.',
    tag: 'Marché bas',
  },
  {
    id: 'murat',
    title: 'Murat',
    blurb: 'Petite ville rurale du Cantal : presque pas de ventes d’appartements, un marché minuscule. Teste le jeu sans données de marché.',
    tag: 'Rural',
  },
];

export const DEFAULT_DISTRICT = DISTRICTS[0].id;
const KEY = 'urbasim-district-v1';

/** Carte choisie (mémorisée dans le navigateur). */
export function chosenDistrictId(): string {
  try {
    const id = localStorage.getItem(KEY);
    if (id && (DISTRICTS.some((d) => d.id === id) || isCustomId(id))) return id;
  } catch {
    /* stockage indisponible */
  }
  return DEFAULT_DISTRICT;
}

export function chooseDistrict(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* stockage indisponible : la carte par défaut reste */
  }
}

/** Ce que l'on sait d'une carte disponible au téléchargement (calculé à la construction du site à partir des données). */
export interface MapEntry {
  id: string;
  name: string;
  parcels: number;
  buildings: number;
  /** Taille du fichier (octets, non compressé) : sert à la barre de progression. */
  bytes: number;
  /** Date de l'instantané : fait changer la version, donc le fichier en mémoire est remplacé. */
  fetchedAt: string;
  marketName: string;
  /** Prix médian des appartements dans la commune (€/m²) et nombre de ventes, s'ils sont connus. */
  pricePerM2?: number;
  sales?: number;
  /** Nombre de zones de PLU dans la carte (0 = pas de PLU numérisé : règles par défaut). */
  zones: number;
}

const MAPS_CACHE = 'urbasim-maps-v1';
const dataUrl = (name: string) => new URL(`data/districts/${name}`, document.baseURI).href;
const mapUrl = (m: MapEntry) => `${dataUrl(`${m.id}.json`)}?v=${encodeURIComponent(`${m.bytes}-${m.fetchedAt}`)}`;

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(MAPS_CACHE);
  } catch {
    return null;
  }
}

/** Cartes proposées : liste intégrée à la page (version autonome), sinon téléchargée (et gardée pour l'usage hors ligne). */
export async function listMaps(): Promise<MapEntry[]> {
  const embedded = document.getElementById('districts-index');
  if (embedded?.textContent) return JSON.parse(embedded.textContent) as MapEntry[];
  const url = dataUrl('index.json');
  const cache = await openCache();
  try {
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const copy = res.clone();
    if (cache) await cache.put(url, copy).catch(() => undefined);
    return (await res.json()) as MapEntry[];
  } catch (e) {
    const hit = cache ? await cache.match(url) : undefined;
    if (hit) return (await hit.json()) as MapEntry[];
    throw e;
  }
}

/** Cartes déjà téléchargées sur cet appareil (ou intégrées à la page). */
export async function downloadedMaps(maps: MapEntry[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const m of maps) if (document.getElementById(`district-${m.id}`)) out.add(m.id);
  const cache = await openCache();
  if (cache) for (const m of maps) if (await cache.match(mapUrl(m))) out.add(m.id);
  return out;
}

/** Télécharge une carte (avec progression 0 à 1) et la garde sur l'appareil. */
export async function downloadMap(m: MapEntry, onProgress: (done: number) => void): Promise<void> {
  if (document.getElementById(`district-${m.id}`)) return;
  const res = await fetch(mapUrl(m));
  if (!res.ok || !res.body) throw new Error(`Carte indisponible (HTTP ${res.status})`);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(Math.min(0.99, got / Math.max(1, m.bytes)));
  }
  const blob = new Blob(chunks as BlobPart[], { type: 'application/json' });
  const cache = await openCache();
  if (cache) await cache.put(mapUrl(m), new Response(blob, { headers: { 'Content-Type': 'application/json' } })).catch(() => undefined);
  onProgress(1);
}

/** Supprime une carte téléchargée (la place est rendue ; elle pourra être retéléchargée). */
export async function deleteMap(m: MapEntry): Promise<void> {
  const cache = await openCache();
  if (cache) await cache.delete(mapUrl(m));
}

async function readEmbedded(id: string): Promise<District | null> {
  const embedded = document.getElementById(`district-${id}`);
  if (!embedded?.textContent) return null;
  const bin = Uint8Array.from(atob(embedded.textContent.trim()), (c) => c.charCodeAt(0));
  const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text()) as District;
}

/** Instantané de la carte : intégré à la page, sinon en mémoire sur l'appareil, sinon téléchargé d'abord (avec progression). */
export async function loadDistrict(id: string, onProgress: (done: number) => void = () => {}): Promise<District> {
  if (isCustomId(id)) return loadCustomDistrict(id);
  const embedded = await readEmbedded(id);
  if (embedded) return embedded;
  const maps = await listMaps();
  const entry = maps.find((m) => m.id === id);
  if (!entry) throw new Error('Cette carte n’est pas disponible.');
  const cache = await openCache();
  let hit = cache ? await cache.match(mapUrl(entry)) : undefined;
  if (!hit) {
    await downloadMap(entry, onProgress);
    hit = cache ? await cache.match(mapUrl(entry)) : undefined;
  }
  if (hit) return (await hit.json()) as District;
  // Pas de stockage disponible : lecture directe.
  const res = await fetch(mapUrl(entry));
  if (!res.ok) throw new Error(`Carte indisponible (HTTP ${res.status})`);
  return (await res.json()) as District;
}
