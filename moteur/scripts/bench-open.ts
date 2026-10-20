// Chronomètre la préparation complète d'une commune « comme dans le navigateur » : téléchargement puis calcul, sur un seul cœur.
// Usage : npm run bench-open -- "<nom>" <code_insee> <marché> [--arr=111] [--sector=lon,lat,rayon_m] [--tile=500] [--save=<id>]
import { writeFileSync } from 'node:fs';
import { fetchCommune } from '../src/app/districtFetch';
import { priceParcels, wastelandCandidates, wastelandIds, withRoadClip, withWasteland, withZoneFamilies } from '../src/game/district';

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.replace(/^--/, '').split('=') as [string, string | undefined]));
const [name, insee, market] = args.filter((a) => !a.startsWith('--'));
const sector = flags.sector ? (([lon, lat, radius]) => ({ center: { lon, lat }, radius }))(flags.sector.split(',').map(Number)) : undefined;

// Mesure du réseau : nombre de requêtes, octets reçus, temps cumulé passé à attendre.
const net = { requests: 0, bytes: 0, ms: 0, fails: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (...a: Parameters<typeof fetch>) => {
  const t = Date.now();
  net.requests++;
  try {
    const r = await realFetch(...a);
    const clone = r.clone();
    net.bytes += (await clone.arrayBuffer()).byteLength;
    return r;
  } catch (e) {
    net.fails++;
    throw e;
  } finally {
    net.ms += Date.now() - t;
  }
}) as typeof fetch;

const t0 = Date.now();
const lap = (label: string, since: number) => console.log(`${label.padEnd(34)} ${((Date.now() - since) / 1000).toFixed(1)} s`);
const d0 = await fetchCommune({ name, insee, market: market as any, arr: flags.arr, sector, tile: flags.tile ? +flags.tile : undefined, adjustMarket: true, log: (m) => { if (/parcelles$/.test(m) || /carreau (1|\d*0)\//.test(m)) console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)} s] ${m}`); } });
lap(`téléchargement (${d0.parcels.length} parcelles)`, t0);
console.log(`  réseau : ${net.requests} requêtes, ${(net.bytes / 1e6).toFixed(1)} Mo, ${(net.ms / 1000).toFixed(1)} s cumulées (échecs ${net.fails}) ; bâtiments ${d0.buildings.length}, voies ${d0.roads?.length}, zones ${d0.zones?.length}`);
let t = Date.now();
const z = withZoneFamilies(d0);
lap('familles de zones', t);
t = Date.now();
const { district: clipped } = withRoadClip(z);
lap('rognage des voies', t);
t = Date.now();
const { priced, appraised } = priceParcels(clipped);
lap('densité + modèle de prix + prix', t);
t = Date.now();
const cands = wastelandCandidates(priced);
const waste = new Set(wastelandIds(priced, appraised, cands));
const final = withWasteland(priced, appraised, waste);
lap(`délaissés (${cands.length} candidates)`, t);
if (flags.save) writeFileSync(new URL(`../data/districts/${flags.save}.json`, import.meta.url), JSON.stringify(final));
console.log(`TOTAL ${((Date.now() - t0) / 1000).toFixed(1)} s · carte ${(JSON.stringify(final).length / 1e6).toFixed(1)} Mo`);
