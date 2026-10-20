// Marge du meilleur projet au prix demandé, sur un échantillon de parcelles : mesure si une carte est trop généreuse ou trop dure.
// Usage : npm run margins -- <id>
import { readFileSync } from 'node:fs';
import { computeBilan, computeProject, promoterCriteria } from '../src/engine';
import { DEFAULT_CONFIG, ZONE_RULES, adaptToDensity, applyRule, housingTypesFor, marketOf, type District } from '../src/game';
import { marketAt } from '../src/game/location';

const id = process.argv[2];
const d = JSON.parse(readFileSync(new URL(`../data/districts/${id}.json`, import.meta.url), 'utf8')) as District;
const market = marketOf(d);
const ok = d.parcels.filter((p) => !p.issue && p.zone && ZONE_RULES[p.zone].buildable);
const sample = ok.filter((_, i) => i % Math.max(1, Math.floor(ok.length / 400)) === 0);
const rows: Record<string, number[]> = {};
for (const p of sample) {
  const rule = adaptToDensity(ZONE_RULES[p.zone!], p.density);
  let best = -1;
  for (const housing of housingTypesFor(rule)) for (let lv = 0; lv <= (housing === 'maison' ? 1 : 5); lv++) for (const attic of [false, true]) {
    const proj = computeProject({ ring: p.ring, streetEdges: p.streetEdges }, applyRule({ ...promoterCriteria(market), levels: lv, attic, housing }, rule));
    if (!proj.footprint || proj.checks.some((c) => c.status === 'error')) continue;
    const b = computeBilan({ project: proj, market: marketAt(market, p.locationFactor), landPrice: (p.basePrice ?? 0) / 1.075, existingSdp: p.existingSdp, params: { ...DEFAULT_CONFIG.bilanParams } });
    best = Math.max(best, b.marginRate);
  }
  (rows[p.zone!] ??= []).push(best);
}
const q = (v: number[], f: number) => v[Math.min(v.length - 1, Math.floor(v.length * f))];
console.log(`== ${d.name} · prix des appartements ${d.marketStats?.pricePerM2 ?? '–'} €/m²`);
for (const [z, v] of Object.entries(rows).sort((a, b) => b[1].length - a[1].length)) {
  v.sort((a, b) => a - b);
  const pct = (x: number) => `${(100 * x).toFixed(0)} %`;
  console.log(`  ${z.padEnd(14)} ${String(v.length).padStart(4)} · marge p10 ${pct(q(v, 0.1))} · médiane ${pct(q(v, 0.5))} · p90 ${pct(q(v, 0.9))} · ≥ 25 % : ${Math.round((100 * v.filter((x) => x >= 0.25).length) / v.length)} % · < 0 : ${Math.round((100 * v.filter((x) => x < 0).length) / v.length)} %`);
}
