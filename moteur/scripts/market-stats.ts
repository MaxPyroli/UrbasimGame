// Ajoute à un instantané les statistiques de marché tirées des ventes réelles (DVF) de sa commune.
// Usage : npm run market -- <id> <code_insee> ["<nom de la commune>"]   (puis `npm run reprice -- <id>` : les prix en dépendent)
import { readFileSync, writeFileSync } from 'node:fs';
import { fetchMarketStats, marketMix } from '../src/app/dvf';
import type { District } from '../src/game/district';

const [id, insee, nameArg] = process.argv.slice(2);
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
const { demandMix, typologyRatio } = marketMix(stats);
writeFileSync(file, JSON.stringify({ ...d, marketStats: stats, demandMix, typologyRatio }));
console.log(`${stats.source} : ${stats.sales} ventes, ${stats.pricePerM2} €/m²`);
for (const t of ['T1', 'T2', 'T3', 'T4', 'T5'] as const) console.log(`  ${t} : ${(demandMix[t] * 100).toFixed(0)} % des ventes · ${stats.byTypology[t].area} m² · ${stats.byTypology[t].pricePerM2} €/m² · prix relatif ×${typologyRatio[t]}`);
