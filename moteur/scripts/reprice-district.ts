// Recalcule prix de référence, constructibilité, densité et délaissés d'un instantané existant, sans retélécharger les données.
// Usage : npm run reprice -- <id>   (à relancer quand les règles du jeu changent)
// Les calculs par parcelle (~0,2 s) sont répartis sur tous les cœurs de la machine.
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { analyseParcel, marketOf, priceParcels, wastelandCandidates, wastelandIds, withRoadClip, withWasteland, withZoneFamilies, type District, type ParcelAnalysis } from '../src/game/district';

type Job = { kind: 'analyse'; district: District; indices: number[] } | { kind: 'waste'; district: District; appraised: number[]; indices: number[] };

if (!isMainThread) {
  const job = workerData as Job;
  if (job.kind === 'analyse') {
    const out: ParcelAnalysis[] = [];
    job.indices.forEach((i, k) => {
      out.push(analyseParcel(job.district.parcels[i], marketOf(job.district)));
      if (k % 50 === 49) parentPort!.postMessage({ progress: 50 });
    });
    parentPort!.postMessage({ done: out });
  } else {
    const out: string[] = [];
    // par petits lots pour rendre compte de l'avancement
    for (let k = 0; k < job.indices.length; k += 10) {
      const part = job.indices.slice(k, k + 10);
      out.push(...wastelandIds(job.district, job.appraised, part));
      parentPort!.postMessage({ progress: part.length });
    }
    parentPort!.postMessage({ done: out });
  }
} else {
  const id = process.argv[2];
  if (!id) {
    console.error('usage : npm run reprice -- <id>');
    process.exit(1);
  }
  const file = new URL(`../data/districts/${id}.json`, import.meta.url);
  const raw = withZoneFamilies(JSON.parse(readFileSync(file, 'utf8')) as District);
  const { district: source, clipped, dropped } = withRoadClip(raw);
  console.log(`voies : ${clipped} parcelles rognées, ${dropped} écartées (voirie) sur ${raw.parcels.length}`);
  const t0 = Date.now();
  const n = Math.max(1, Math.min(availableParallelism(), 16));

  /** Répartit des indices (entrelacés pour équilibrer la charge) sur les cœurs et rassemble les résultats. */
  const run = async <R>(label: string, indices: number[], make: (idx: number[]) => Job): Promise<R[][]> => {
    const buckets: number[][] = Array.from({ length: n }, () => []);
    indices.forEach((i, k) => buckets[k % n].push(i));
    let finished = 0;
    let next = 500;
    return Promise.all(
      buckets.map(
        (idx) =>
          new Promise<R[]>((resolve, reject) => {
            const w = new Worker(new URL(import.meta.url), { workerData: make(idx) });
            w.on('message', (m: { progress?: number; done?: R[] }) => {
              if (m.progress) {
                finished += m.progress;
                if (finished >= next) {
                  next += 500;
                  console.log(`${label} : ${finished}/${indices.length} · ${Math.round((Date.now() - t0) / 1000)} s`);
                }
              }
              if (m.done) resolve(m.done);
            });
            w.on('error', reject);
          }),
      ),
    ).then((parts) => parts.map((p, b) => Object.assign(p, { idx: buckets[b] })) as R[][]);
  };

  // 1) densité, modèle de prix par zone (étalonné sur quelques terrains types) et prix de chaque parcelle
  const { priced, appraised } = priceParcels(source);

  // 2) délaissés : seules les parcelles non constructibles seules sont étudiées
  const cands = wastelandCandidates(priced);
  console.log(`analyse terminée en ${Math.round((Date.now() - t0) / 1000)} s ; délaissés : ${cands.length} parcelles à étudier`);
  const wparts = await run<string>('délaissés', cands, (indices) => ({ kind: 'waste', district: priced, appraised, indices }));
  const d: District = withWasteland(priced, appraised, new Set(wparts.flat()));

  writeFileSync(file, JSON.stringify(d));
  const count = (k: string) => d.parcels.filter((p) => p.density === k).length;
  const issues = d.parcels.reduce<Record<string, number>>((m, p) => ((m[p.issue ?? 'ok'] = (m[p.issue ?? 'ok'] ?? 0) + 1), m), {});
  console.log(`${d.parcels.length} parcelles · densité : ${count('dense')} denses, ${count('moyenne')} moyennes, ${count('diffuse')} diffuses · ${JSON.stringify(issues)} · ${Math.round((Date.now() - t0) / 1000)} s`);
}
