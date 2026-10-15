// Télécharge toute une commune et l'enregistre dans data/districts/<id>.json (sans prix : lancer ensuite `npm run reprice -- <id>`).
// Usage : npm run commune -- <id> "<nom>" <code_insee> [marché=grande-couronne]
import { writeFileSync } from 'node:fs';
import { fetchCommune } from '../src/app/districtFetch';

const [id, name, insee, market] = process.argv.slice(2);
if (!id || !name || !insee) {
  console.error('usage : npm run commune -- <id> "<nom>" <code_insee> [marché]');
  process.exit(1);
}
const d = await fetchCommune({ name, insee, market: (market ?? "grande-couronne") as any, log: (m) => console.log(m) });
const file = new URL(`../data/districts/${id}.json`, import.meta.url);
writeFileSync(file, JSON.stringify(d));
console.log(`${d.parcels.length} parcelles, ${d.buildings.length} bâtiments, ${d.roads?.length} voies, ${d.zones?.length} zones → ${file.pathname}`);
