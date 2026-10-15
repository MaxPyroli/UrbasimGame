import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

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

export default defineConfig({
  base: './',
  server: { fs: { allow: ['..'] } },
  build: { target: 'es2022' },
  define: {
    // Version bêta (package.json) ; numéro de build = nombre de commits (monte à chaque mise à jour) ; date de la construction.
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(process.env.URBASIM_BUILD ?? git('rev-list --count HEAD', '0')),
    __APP_COMMIT__: JSON.stringify(git('rev-parse --short HEAD', 'local')),
    __APP_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
});
