// Préparation d'une commune hors du fil principal : téléchargement (cadastre, bâti, voies, zonage, ventes) puis calcul des
// prix et des terrains délaissés, comme `npm run reprice`. Le jeu reste fluide pendant ce temps.
import { fetchCommune, type CommuneOptions } from '../../moteur/src/app/districtFetch';
import { priceParcels, wastelandCandidates, wastelandIds, withRoadClip, withWasteland, withZoneFamilies } from '../../moteur/src/game/district';

export type PrepareRequest = Pick<CommuneOptions, 'name' | 'insee' | 'market' | 'arr' | 'dvfInsee' | 'sector' | 'tile'>;
export type PrepareMessage = { type: 'progress'; step: string; done: number } | { type: 'done'; district: unknown } | { type: 'error'; message: string };

// Reprise après une coupure : les réponses des services de données sont gardées le temps de la préparation, donc relancer ne
// retélécharge que ce qui manquait. Le cache temporaire est vidé quand la carte est prête.
const TMP = 'urbasim-prep-tmp';
const realFetch = self.fetch.bind(self);
self.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if ((init?.method && init.method !== 'GET') || !/apicarto\.ign\.fr|data\.geopf\.fr|files\.data\.gouv\.fr/.test(url) || typeof caches === 'undefined') return realFetch(input, init);
  try {
    const cache = await caches.open(TMP);
    const hit = await cache.match(url);
    if (hit) return hit;
    const res = await realFetch(input, init);
    if (res.ok) await cache.put(url, res.clone()).catch(() => undefined);
    return res;
  } catch {
    return realFetch(input, init);
  }
};

const post = (m: PrepareMessage) => (self as unknown as Worker).postMessage(m);

// Part de la barre pour chaque phase : téléchargement 55 %, puis calcul.
const FETCH_SHARE = 0.55;
const FETCH_STEPS: Record<string, [number, number]> = { 'Parcelles du cadastre': [0, 0.3], 'Bâtiments, voies et zonage': [0.3, 0.85], 'Équipements et ventes réelles': [0.85, 1] };

self.onmessage = async (e: MessageEvent<PrepareRequest>) => {
  try {
    const raw = await fetchCommune({
      ...e.data,
      adjustMarket: true,
      progress: (step, done) => {
        const [a, b] = FETCH_STEPS[step] ?? [0, 1];
        post({ type: 'progress', step, done: FETCH_SHARE * (a + (b - a) * done) });
      },
    });
    post({ type: 'progress', step: 'Zonage et voies', done: FETCH_SHARE });
    const { district: clipped } = withRoadClip(withZoneFamilies(raw));
    const { priced, appraised } = priceParcels(clipped, undefined, (f) => post({ type: 'progress', step: 'Prix des terrains', done: FETCH_SHARE + 0.4 * f }));
    post({ type: 'progress', step: 'Terrains délaissés', done: FETCH_SHARE + 0.4 });
    const waste = wastelandIds(priced, appraised, wastelandCandidates(priced));
    if (typeof caches !== 'undefined') await caches.delete(TMP).catch(() => undefined);
    post({ type: 'done', district: withWasteland(priced, appraised, waste) });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : 'erreur inconnue' });
  }
};
