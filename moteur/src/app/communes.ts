import type { MarketId } from '../engine';

/** Une commune trouvée par la recherche (API Géo, données publiques). */
export interface CommuneHit {
  code: string;
  name: string;
  postcodes: string[];
  population: number;
  dept: string;
  deptName: string;
  center: { lon: number; lat: number };
  /** Surface (km²). */
  area: number;
}

/** Au-delà de ce nombre de parcelles, on propose un secteur plutôt que la commune entière. */
export const MAX_PARCELS = 12_000;

const GEO = 'https://geo.api.gouv.fr/communes';
const CADASTRE = 'https://apicarto.ign.fr/api/cadastre/parcelle';

async function getJson(url: string, signal?: AbortSignal): Promise<any> {
  let last: unknown;
  for (let i = 0; i < 5; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 300 * i));
    try {
      const r = await fetch(url, { signal });
      if (r.ok) return await r.json();
      last = new Error(`HTTP ${r.status}`);
      if (r.status < 500 && r.status !== 429) break;
    } catch (e) {
      if (signal?.aborted) throw e;
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error('réseau');
}

const toHit = (c: any): CommuneHit => ({
  code: c.code,
  name: c.nom,
  postcodes: c.codesPostaux ?? [],
  population: c.population ?? 0,
  dept: c.departement?.code ?? c.codeDepartement ?? '',
  deptName: c.departement?.nom ?? '',
  center: { lon: c.centre?.coordinates?.[0] ?? 0, lat: c.centre?.coordinates?.[1] ?? 0 },
  area: c.surface ? c.surface / 100 : 0,
});

/** Communes dont le nom (ou le code postal, ou le code INSEE) commence par la saisie ; les plus peuplées d'abord. */
export async function searchCommunes(query: string, signal?: AbortSignal): Promise<CommuneHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const fields = 'nom,code,codesPostaux,population,departement,centre,surface';
  const param = /^\d{5}$/.test(q) ? `codePostal=${q}` : /^\d{2,4}$/.test(q) ? '' : `nom=${encodeURIComponent(q)}&boost=population`;
  if (!param) return [];
  const list: any[] = await getJson(`${GEO}?${param}&fields=${fields}&limit=8`, signal);
  return list.map(toHit).sort((a, b) => b.population - a.population);
}

/** Les trois villes découpées en arrondissements : le cadastre et les ventes se demandent par arrondissement. */
export interface Arrondissement {
  /** Code de l'arrondissement du cadastre (trois derniers chiffres), à passer avec le code INSEE de la ville. */
  arr: string;
  name: string;
  /** Code utilisé par les ventes réelles (DVF). */
  dvf: string;
}
const ord = (n: number) => (n === 1 ? '1er' : `${n}e`);
export const ARRONDISSEMENTS: Record<string, { name: string; list: Arrondissement[] }> = {
  '75056': { name: 'Paris', list: Array.from({ length: 20 }, (_, i) => ({ arr: String(101 + i), name: `Paris ${ord(i + 1)}`, dvf: String(75101 + i) })) },
  '69123': { name: 'Lyon', list: Array.from({ length: 9 }, (_, i) => ({ arr: String(381 + i), name: `Lyon ${ord(i + 1)}`, dvf: String(69381 + i) })) },
  '13055': { name: 'Marseille', list: Array.from({ length: 16 }, (_, i) => ({ arr: String(201 + i), name: `Marseille ${ord(i + 1)}`, dvf: String(13201 + i) })) },
};

/**
 * Marché de référence d'une commune (structure des coûts et des prix de départ ; le niveau de prix est ensuite recalé sur
 * les ventes réelles de la commune) : Paris, petite couronne, grande couronne, grande ville, ville moyenne.
 */
export function marketFor(c: Pick<CommuneHit, 'dept' | 'population'>): MarketId {
  if (c.dept === '75') return 'paris';
  if (['92', '93', '94'].includes(c.dept)) return 'petite-couronne';
  if (['77', '78', '91', '95'].includes(c.dept)) return 'grande-couronne';
  return c.population >= 60_000 ? 'grande-ville' : 'ville-moyenne';
}

/** Nombre exact de parcelles du cadastre pour une commune (ou un arrondissement) : une requête d'une seule parcelle. */
export async function countParcels(insee: string, arr?: string, signal?: AbortSignal): Promise<number> {
  const j = await getJson(`${CADASTRE}?code_insee=${insee}${arr ? `&code_arr=${arr}` : ''}&_limit=1`, signal);
  return j.totalFeatures ?? j.numberMatched ?? 0;
}

/** Durée approximative de préparation (secondes) d'une commune de `parcels` parcelles, d'après les mesures de `bench-open`. */
export const estimateSeconds = (parcels: number): number => Math.round(10 + parcels * 0.008);
