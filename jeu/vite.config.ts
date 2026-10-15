import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

/** Instantanés des cartes (moteur/data/districts) : servis en développement, copiés dans la construction (chargés à la demande par le jeu). */
const districts = (): Plugin => ({
  name: 'urbasim-districts',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const m = /^\/data\/districts\/([a-z0-9-]+)\.json/.exec(req.url ?? '');
      if (!m || !existsSync(new URL(`${m[1]}.json`, DATA))) return next();
      res.setHeader('Content-Type', 'application/json');
      res.end(readFileSync(new URL(`${m[1]}.json`, DATA)));
    });
  },
  generateBundle() {
    for (const f of readdirSync(DATA).filter((n) => n.endsWith('.json'))) this.emitFile({ type: 'asset', fileName: `data/districts/${f}`, source: readFileSync(new URL(f, DATA)) });
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
