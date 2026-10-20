import type { District } from '../../moteur/src/game';
import { MARKETS } from '../../moteur/src/engine';
import PrepareWorker from './prepareWorker?worker&inline';
import type { PrepareMessage, PrepareRequest } from './prepareWorker';

/** Une commune préparée par le joueur : gardée sur l'appareil, comme les cartes téléchargées. */
export interface CustomMap {
  id: string;
  name: string;
  insee: string;
  arr?: string;
  parcels: number;
  buildings: number;
  bytes: number;
  createdAt: string;
  marketName: string;
  pricePerM2?: number;
  sales?: number;
  zones: number;
}

// Le nom commence par « urbasim-maps » : le service worker ne purge pas ce cache.
const CACHE = 'urbasim-maps-custom-v1';
const INDEX_URL = 'https://urbasim.local/custom/index.json';
const mapUrl = (id: string) => `https://urbasim.local/custom/${id}.json`;

/** Les cartes préparées par le joueur ont toutes un identifiant qui commence par « libre- ». */
export const isCustomId = (id: string) => id.startsWith('libre-');
export const customId = (insee: string, arr?: string) => `libre-${insee}${arr ? `-${arr}` : ''}`;

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(CACHE);
  } catch {
    return null;
  }
}

export async function listCustomMaps(): Promise<CustomMap[]> {
  const cache = await openCache();
  const hit = cache ? await cache.match(INDEX_URL) : undefined;
  return hit ? ((await hit.json()) as CustomMap[]) : [];
}

async function writeIndex(cache: Cache, list: CustomMap[]) {
  await cache.put(INDEX_URL, new Response(JSON.stringify(list), { headers: { 'Content-Type': 'application/json' } }));
}

export async function loadCustomDistrict(id: string): Promise<District> {
  const cache = await openCache();
  const hit = cache ? await cache.match(mapUrl(id)) : undefined;
  if (!hit) throw new Error('Cette carte n’est plus sur l’appareil : préparez-la de nouveau.');
  return (await hit.json()) as District;
}

export async function deleteCustomMap(id: string): Promise<void> {
  const cache = await openCache();
  if (!cache) return;
  await cache.delete(mapUrl(id));
  await writeIndex(cache, (await listCustomMaps()).filter((m) => m.id !== id));
}

/**
 * Prépare une commune (téléchargement puis calcul, dans un processus d'arrière-plan) et la garde sur l'appareil.
 * `onProgress` reçoit l'étape en cours et l'avancement global (0 à 1) ; `signal` permet d'annuler.
 */
export function prepareMap(req: PrepareRequest & { title: string; suffix?: string }, onProgress: (step: string, done: number) => void, signal?: AbortSignal): Promise<CustomMap> {
  return new Promise((resolve, reject) => {
    const worker = new PrepareWorker();
    const stop = () => worker.terminate();
    signal?.addEventListener('abort', () => (stop(), reject(new DOMException('Annulé', 'AbortError'))));
    worker.onerror = (e) => (stop(), reject(new Error(e.message || 'La préparation a échoué.')));
    worker.onmessage = async (e: MessageEvent<PrepareMessage>) => {
      const m = e.data;
      if (m.type === 'progress') return onProgress(m.step, m.done);
      stop();
      if (m.type === 'error') return reject(new Error(m.message));
      try {
        const district = m.district as District;
        const named: District = { ...district, name: req.title };
        const body = JSON.stringify(named);
        const entry: CustomMap = {
          id: customId(req.insee, req.suffix ?? req.arr),
          name: req.title,
          insee: req.insee,
          ...(req.arr ? { arr: req.arr } : {}),
          parcels: district.parcels.length,
          buildings: district.buildings.length,
          bytes: body.length,
          createdAt: new Date().toISOString().slice(0, 10),
          marketName: MARKETS[district.market].name,
          ...(district.marketStats ? { pricePerM2: Math.round(district.marketStats.pricePerM2), sales: district.marketStats.sales } : {}),
          zones: district.zones?.length ?? 0,
        };
        const cache = await openCache();
        if (!cache) throw new Error('Stockage indisponible sur cet appareil : la carte ne peut pas être gardée.');
        await cache.put(mapUrl(entry.id), new Response(body, { headers: { 'Content-Type': 'application/json' } }));
        await writeIndex(cache, [entry, ...(await listCustomMaps()).filter((x) => x.id !== entry.id)]);
        resolve(entry);
      } catch (err) {
        reject(err);
      }
    };
    worker.postMessage({ name: req.name, insee: req.insee, market: req.market, arr: req.arr, dvfInsee: req.dvfInsee, sector: req.sector, tile: req.tile } satisfies PrepareRequest);
  });
}
