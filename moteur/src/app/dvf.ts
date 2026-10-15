import type { MarketStats, Typology } from '../engine';

/** Typologies de logement, de la plus petite à la plus grande. */
const TYPOLOGIES: Typology[] = ['T1', 'T2', 'T3', 'T4', 'T5'];

/**
 * Répartition et prix a priori d'un marché sans assez de ventes (petites communes) : moyennes observées à Montreuil et
 * Sucy-en-Brie. Les ventes réelles s'y ajoutent, avec un poids d'autant plus fort qu'elles sont nombreuses.
 */
export const PRIOR_SHARE: Record<Typology, number> = { T1: 0.12, T2: 0.28, T3: 0.36, T4: 0.19, T5: 0.05 };
export const PRIOR_RATIO: Record<Typology, number> = { T1: 1.1, T2: 1.05, T3: 1.0, T4: 0.92, T5: 0.88 };
export const PRIOR_AREA: Record<Typology, number> = { T1: 27, T2: 43, T3: 63, T4: 80, T5: 100 };
/** Nombre de ventes fictives données à l'a priori. */
const PRIOR_WEIGHT = 25;

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[(s.length >> 1) - 1] + s[s.length >> 1]) / 2) : 0;
};

/** Découpe une ligne CSV (guillemets simples gérés). */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) (out.push(cur), (cur = ''));
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export interface DvfSale {
  year: number;
  rooms: number;
  area: number;
  pricePerM2: number;
}

/**
 * Ventes simples d'appartements d'un fichier DVF (demandes de valeurs foncières, Etalab) : une mutation « Vente » qui ne porte
 * que sur un seul local d'habitation, sans surface ni prix aberrants.
 */
export function parseDvf(csv: string, year: number): DvfSale[] {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const head = splitCsv(lines[0]);
  const col = (name: string) => head.indexOf(name);
  const ci = { id: col('id_mutation'), nature: col('nature_mutation'), value: col('valeur_fonciere'), type: col('type_local'), area: col('surface_reelle_bati'), rooms: col('nombre_pieces_principales') };
  if (Object.values(ci).some((i) => i < 0)) return [];
  const byMutation = new Map<string, string[][]>();
  for (const line of lines.slice(1)) {
    const f = splitCsv(line);
    if (f[ci.nature] !== 'Vente') continue;
    const list = byMutation.get(f[ci.id]) ?? [];
    list.push(f);
    byMutation.set(f[ci.id], list);
  }
  const sales: DvfSale[] = [];
  for (const rows of byMutation.values()) {
    const homes = rows.filter((f) => (f[ci.type] === 'Appartement' || f[ci.type] === 'Maison') && f[ci.area]);
    if (homes.length !== 1 || homes[0][ci.type] !== 'Appartement') continue;
    const value = Number(homes[0][ci.value]);
    const area = Number(homes[0][ci.area]);
    const rooms = Number(homes[0][ci.rooms]);
    if (!(area >= 9 && area <= 300 && value >= 20000 && rooms >= 1)) continue;
    const pricePerM2 = value / area;
    if (pricePerM2 < 500 || pricePerM2 > 25000) continue;
    sales.push({ year, rooms, area, pricePerM2 });
  }
  return sales;
}

/** Statistiques de marché d'une commune à partir de ses ventes d'appartements. */
export function marketStats(sales: DvfSale[], source: string): MarketStats {
  const typ = (s: DvfSale): Typology => TYPOLOGIES[Math.min(5, Math.max(1, s.rooms)) - 1];
  const total = sales.length;
  const overall = median(sales.map((s) => s.pricePerM2));
  const byTypology = {} as MarketStats['byTypology'];
  for (const t of TYPOLOGIES) {
    const g = sales.filter((s) => typ(s) === t);
    // Mélange avec l'a priori : peu de ventes, on reste proche de la moyenne observée ailleurs.
    const share = (g.length + PRIOR_WEIGHT * PRIOR_SHARE[t]) / (total + PRIOR_WEIGHT);
    const w = g.length / (g.length + PRIOR_WEIGHT);
    const ratio = overall > 0 && g.length > 0 ? median(g.map((s) => s.pricePerM2)) / overall : PRIOR_RATIO[t];
    byTypology[t] = {
      share,
      area: g.length ? Math.round(w * median(g.map((s) => s.area)) + (1 - w) * PRIOR_AREA[t]) : PRIOR_AREA[t],
      pricePerM2: Math.round(overall * (w * ratio + (1 - w) * PRIOR_RATIO[t])),
    };
  }
  const years = [...new Set(sales.map((s) => s.year))].sort();
  return {
    source,
    sales: total,
    pricePerM2: Math.round(overall),
    byYear: years.map((year) => {
      const g = sales.filter((s) => s.year === year);
      return { year, pricePerM2: Math.round(median(g.map((s) => s.pricePerM2))), sales: g.length };
    }),
    byTypology,
  };
}

/**
 * Mix de logements du marché (parts par typologie) et prix relatifs, à fournir au jeu. Les prix relatifs sont normalisés pour
 * que la moyenne pondérée par la surface vendue vaille 1 : un programme calé sur le marché garde le prix moyen de la commune.
 */
export function marketMix(stats: MarketStats): { demandMix: Record<Typology, number>; typologyRatio: Record<Typology, number> } {
  const demandMix = {} as Record<Typology, number>;
  const raw = {} as Record<Typology, number>;
  let wArea = 0;
  let wPrice = 0;
  for (const t of TYPOLOGIES) {
    const s = stats.byTypology[t];
    demandMix[t] = Math.round(s.share * 1000) / 1000;
    raw[t] = stats.pricePerM2 > 0 ? s.pricePerM2 / stats.pricePerM2 : 1;
    wArea += s.share * s.area;
    wPrice += s.share * s.area * raw[t];
  }
  const norm = wArea > 0 && wPrice > 0 ? wPrice / wArea : 1;
  const typologyRatio = {} as Record<Typology, number>;
  for (const t of TYPOLOGIES) typologyRatio[t] = Math.round((raw[t] / norm) * 1000) / 1000;
  return { demandMix, typologyRatio };
}

/** Années proposées par le jeu de données DVF (les plus récentes d'abord), tentées jusqu'à en réunir quatre. */
export const DVF_YEARS = [2025, 2024, 2023, 2022];

/** Télécharge les ventes d'une commune (DVF géolocalisé, Etalab, Licence Ouverte 2.0) et en tire les statistiques de marché. */
export async function fetchMarketStats(insee: string, name: string, get: (url: string) => Promise<string | null>): Promise<MarketStats | null> {
  const dep = insee.startsWith('97') ? insee.slice(0, 3) : insee.slice(0, 2);
  const sales: DvfSale[] = [];
  const years: number[] = [];
  for (const year of DVF_YEARS) {
    const text = await get(`https://files.data.gouv.fr/geo-dvf/latest/csv/${year}/communes/${dep}/${insee}.csv`);
    if (!text) continue;
    const s = parseDvf(text, year);
    if (s.length) (sales.push(...s), years.push(year));
  }
  if (sales.length === 0) return null;
  return marketStats(sales, `Ventes réelles (DVF) ${name} ${Math.min(...years)}–${Math.max(...years)}`);
}
