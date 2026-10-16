// Ajoute à un instantané les statistiques de marché tirées des ventes réelles (DVF) de sa commune.
// Usage : npm run market -- <id> <code_insee> ["<nom de la commune>"] [--adjust]   (--adjust : prix du marché adaptés aux ventes locales ; code 75111 pour Paris 11e)   (puis `npm run reprice -- <id>` : les prix en dépendent)
import { readFileSync, writeFileSync } from 'node:fs';
import { deriveMarketAdjust, fetchMarketStats, marketMix } from '../src/app/dvf';
import { MARKETS } from '../src/engine';
import type { District } from '../src/game/district';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const adjust = process.argv.includes('--adjust');
const [id, insee, nameArg] = args;
if (!id || !insee) {
  console.error('usage : npm run market -- <id> <code_insee> ["<nom>"]');
  process.exit(1);
}
const file = new URL(`../data/districts/${id}.json`, import.meta.url);
const d = JSON.parse(readFileSync(file, 'utf8')) as District;
const stats = await fetchMarketStats(insee, nameArg ?? d.name, async (url) => {
  const r = await fetch(url);
  return r.ok ? await r.text() : null;
});
if (!stats) {
  console.error('aucune vente d’appartement trouvée pour cette commune : le marché de référence reste en place');
  process.exit(1);
}
const mix = marketMix(stats);
const { demandMix, typologyRatio } = mix;
writeFileSync(file, JSON.stringify({ ...d, marketStats: stats, ...mix, ...(adjust ? { marketAdjust: deriveMarketAdjust(MARKETS[d.market], stats) } : {}) }));
console.log(`${stats.source} : ${stats.sales} ventes, ${stats.pricePerM2} €/m²`);
for (const t of ['T1', 'T2', 'T3', 'T4', 'T5'] as const) console.log(`  ${t} : ${(demandMix[t] * 100).toFixed(0)} % des ventes · ${stats.byTypology[t].area} m² · ${stats.byTypology[t].pricePerM2} €/m² · prix relatif ×${typologyRatio[t]}`);
