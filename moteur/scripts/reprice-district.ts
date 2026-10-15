// Recalcule prix de référence, constructibilité et densité d'un instantané existant, sans retélécharger les données.
// Usage : npm run reprice -- <id>   (à relancer quand les règles du jeu changent)
import { readFileSync, writeFileSync } from 'node:fs';
import { withBasePrices, type District } from '../src/game/district';

const id = process.argv[2];
if (!id) {
  console.error('usage : npm run reprice -- <id>');
  process.exit(1);
}
const file = new URL(`../data/districts/${id}.json`, import.meta.url);
const d = withBasePrices(JSON.parse(readFileSync(file, 'utf8')) as District);
writeFileSync(file, JSON.stringify(d));
const count = (k: string) => d.parcels.filter((p) => p.density === k).length;
const issues = d.parcels.reduce<Record<string, number>>((m, p) => ((m[p.issue ?? 'ok'] = (m[p.issue ?? 'ok'] ?? 0) + 1), m), {});
console.log(`${d.parcels.length} parcelles · densité : ${count('dense')} denses, ${count('moyenne')} moyennes, ${count('diffuse')} diffuses · ${JSON.stringify(issues)}`);
