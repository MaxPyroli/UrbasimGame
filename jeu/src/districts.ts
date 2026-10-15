import type { District } from '../../moteur/src/game';

/** Une carte jouable. Les données (instantané du cadastre, du bâti, du PLU) sont chargées à la demande. */
export interface DistrictInfo {
  id: string;
  /** Nom court affiché partout. */
  title: string;
  /** Ce qui caractérise la carte, en une phrase. */
  blurb: string;
  /** Repères : étendue, type de marché. */
  facts: string;
  tag: string;
}

export const DISTRICTS: DistrictInfo[] = [
  {
    id: 'montreuil-mairie',
    title: 'Montreuil · centre',
    blurb: 'Hyper-centre dense autour de la mairie : peu de terrains, des parcelles étroites, des règles serrées. Chaque projet est un casse-tête.',
    facts: 'Petite couronne · 300 m autour de la mairie',
    tag: 'Dense',
  },
  {
    id: 'sucy-en-brie',
    title: 'Sucy-en-Brie · toute la ville',
    blurb: 'Banlieue éloignée du Val-de-Marne, toute la commune : quartiers pavillonnaires, grands terrains, gare RER. Beaucoup de place, des prix plus bas et des projets à plusieurs bâtiments.',
    facts: 'Banlieue éloignée · commune entière (plus de 7 000 parcelles)',
    tag: 'Banlieue',
  },
];

export const DEFAULT_DISTRICT = DISTRICTS[0].id;
const KEY = 'urbasim-district-v1';

/** Carte choisie (mémorisée dans le navigateur). */
export function chosenDistrictId(): string {
  try {
    const id = localStorage.getItem(KEY);
    if (id && DISTRICTS.some((d) => d.id === id)) return id;
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

/** Instantané de la carte : intégré à la page (version autonome, compressé) ou téléchargé (site publié, mis en cache). */
export async function loadDistrict(id: string, version: string): Promise<District> {
  const embedded = document.getElementById(`district-${id}`);
  if (embedded?.textContent) {
    const bin = Uint8Array.from(atob(embedded.textContent.trim()), (c) => c.charCodeAt(0));
    const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text()) as District;
  }
  const res = await fetch(new URL(`data/districts/${id}.json?v=${encodeURIComponent(version)}`, document.baseURI));
  if (!res.ok) throw new Error(`Carte indisponible (HTTP ${res.status})`);
  return (await res.json()) as District;
}
