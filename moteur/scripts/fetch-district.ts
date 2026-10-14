// Télécharge un quartier et l'enregistre dans data/districts/<id>.json.
// Usage : npm run district -- <id> "<nom>" <lon> <lat> <rayon_m> <marché>
import { writeFileSync } from 'node:fs';
import { fetchDistrict } from '../src/app/districtFetch';
import { withBasePrices } from '../src/game/district';

const [id, name, lon, lat, radius, market] = process.argv.slice(2);
if (!id || !name || !lon || !lat) {
  console.error('usage : npm run district -- <id> "<nom>" <lon> <lat> [rayon_m=200] [marché=petite-couronne]');
  process.exit(1);
}
const d = withBasePrices(await fetchDistrict({ name, center: { lon: +lon, lat: +lat }, radius: +(radius ?? 200), market: (market ?? 'petite-couronne') as any }));
const file = new URL(`../data/districts/${id}.json`, import.meta.url);
writeFileSync(file, JSON.stringify(d));
console.log(`${d.parcels.length} parcelles, ${d.parcels.reduce((s, p) => s + p.existingSdp, 0)} m² de SDP existante → ${file.pathname}`);
