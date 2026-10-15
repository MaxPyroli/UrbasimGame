import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

declare const process: { env: Record<string, string | undefined> };

/** Résultat d'une commande git, ou `fallback` (archive sans dépôt, git absent). */
const git = (cmd: string, fallback: string) => {
  try {
    return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || fallback;
  } catch {
    return fallback;
  }
};

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

const DATA = new URL('../moteur/data/districts/', import.meta.url);

/** Fiche d'une carte (nom, nombre de parcelles, taille, prix de marché…) pour la page de téléchargement. */
const entryCache = new Map<string, { stamp: string; entry: ReturnType<typeof mapEntry> }>();
function mapEntry(file: string): { id: string; name: string; parcels: number; buildings: number; bytes: number; fetchedAt: string; marketName: string; pricePerM2?: number; sales?: number; zones: number } {
  const stamp = (() => { const s = statSync(new URL(file, DATA)); return `${s.size}-${s.mtimeMs}`; })();
  const hit = entryCache.get(file);
  if (hit?.stamp === stamp) return hit.entry;
  const entry = readEntry(file);
  entryCache.set(file, { stamp, entry });
  return entry;
}
function readEntry(file: string) {
  const raw = readFileSync(new URL(file, DATA));
  const d = JSON.parse(raw.toString('utf8')) as {
    name: string; fetchedAt: string; parcels: unknown[]; buildings: unknown[]; zones?: unknown[];
    market: string; marketAdjust?: { name?: string }; marketStats?: { pricePerM2: number; sales: number };
  };
  return {
    id: file.replace(/\.json$/, ''),
    name: d.name,
    parcels: d.parcels.length,
    buildings: d.buildings.length,
    bytes: raw.length,
    fetchedAt: d.fetchedAt,
    marketName: d.marketAdjust?.name ?? d.market,
    ...(d.marketStats ? { pricePerM2: d.marketStats.pricePerM2, sales: d.marketStats.sales } : {}),
    zones: d.zones?.length ?? 0,
  };
}
/** Cartes lisibles (un fichier en cours d'écriture est ignoré). */
const mapIndex = () =>
  readdirSync(DATA)
    .filter((n) => n.endsWith('.json') && n !== 'index.json')
    .flatMap((n) => {
      try {
        return [mapEntry(n)];
      } catch {
        return [];
      }
    });

/** Instantanés des cartes (moteur/data/districts) : servis en développement, copiés dans la construction avec leur liste (téléchargés à la demande par le jeu). */
const districts = (): Plugin => ({
  name: 'urbasim-districts',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = (req.url ?? '').split('?')[0];
      if (url === '/data/districts/index.json') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify(mapIndex()));
      }
      const m = /^\/data\/districts\/([a-z0-9-]+)\.json$/.exec(url);
      if (!m || !existsSync(new URL(`${m[1]}.json`, DATA))) return next();
      res.setHeader('Content-Type', 'application/json');
      res.end(readFileSync(new URL(`${m[1]}.json`, DATA)));
    });
  },
  generateBundle() {
    for (const f of readdirSync(DATA).filter((n) => n.endsWith('.json'))) this.emitFile({ type: 'asset', fileName: `data/districts/${f}`, source: readFileSync(new URL(f, DATA)) });
    this.emitFile({ type: 'asset', fileName: 'data/districts/index.json', source: JSON.stringify(mapIndex()) });
  },
});

export default defineConfig({
  plugins: [districts()],
  base: './',
  server: { fs: { allow: ['..'] } },
  // Version autonome (VITE_NO_TILES) : tout est intégré à la page, polices comprises ; sinon fichiers séparés au-delà de 4 Ko.
  build: { target: 'es2022', assetsInlineLimit: process.env.VITE_NO_TILES === '1' ? 10_000_000 : 4096 },
  define: {
    // Version bêta (package.json) ; numéro de build = nombre de commits (monte à chaque mise à jour) ; date de la construction.
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(process.env.URBASIM_BUILD ?? git('rev-list --count HEAD', '0')),
    __APP_COMMIT__: JSON.stringify(git('rev-parse --short HEAD', 'local')),
    __APP_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
});
