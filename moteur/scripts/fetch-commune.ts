// Télécharge une commune (ou un arrondissement, ou un secteur) et l'enregistre dans data/districts/<id>.json.
// Les ventes réelles de la commune (DVF) sont ajoutées. Lancer ensuite `npm run reprice -- <id>` (prix, délaissés).
// Usage : npm run commune -- <id> "<nom>" <code_insee> <marché> [--arr=111] [--sector=lon,lat,rayon_m] [--tile=500] [--adjust]
import { writeFileSync } from 'node:fs';
import { fetchCommune } from '../src/app/districtFetch';

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.replace(/^--/, '').split('=') as [string, string | undefined]));
const [id, name, insee, market] = args.filter((a) => !a.startsWith('--'));
if (!id || !name || !insee || !market) {
  console.error('usage : npm run commune -- <id> "<nom>" <code_insee> <marché> [--arr=111] [--sector=lon,lat,rayon_m] [--tile=500] [--adjust]');
  process.exit(1);
}
const sector = flags.sector ? (([lon, lat, radius]) => ({ center: { lon, lat }, radius }))(flags.sector.split(',').map(Number)) : undefined;
const d = await fetchCommune({ name, insee, market: market as any, arr: flags.arr, sector, tile: flags.tile ? +flags.tile : undefined, adjustMarket: 'adjust' in flags, log: (m) => console.log(m) });
const file = new URL(`../data/districts/${id}.json`, import.meta.url);
writeFileSync(file, JSON.stringify(d));
console.log(`${d.parcels.length} parcelles, ${d.buildings.length} bâtiments, ${d.roads?.length} voies, ${d.zones?.length} zones${d.marketAdjust ? `, marché ajusté (${d.marketAdjust.housingPerShab} €/m² habitable)` : ''} → ${file.pathname}`);
