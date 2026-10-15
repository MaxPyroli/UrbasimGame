// Construit une page unique (HTML + CSS + JS en ligne, sans fond de plan) pour un hébergement qui bloque les ressources externes.
// Usage : npm run artifact  →  dist-artifact/urbasim.html
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

execSync('npx vite build --outDir dist-artifact --emptyOutDir', { stdio: 'inherit', env: { ...process.env, VITE_NO_TILES: '1' } });
const html = readFileSync('dist-artifact/index.html', 'utf8');
const assets = readdirSync('dist-artifact/assets');
const css = assets.filter((f) => f.endsWith('.css')).map((f) => readFileSync(`dist-artifact/assets/${f}`, 'utf8')).join('\n');
const js = assets.filter((f) => f.endsWith('.js')).map((f) => readFileSync(`dist-artifact/assets/${f}`, 'utf8')).join('\n');
const body = html.slice(html.indexOf('<div id="app">'), html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '');
// Cartes intégrées à la page autonome (compressées) : elle ne peut rien télécharger, et la page est limitée à 16 Mo. Les autres
// cartes sont proposées au téléchargement sur le site publié.
const EMBED = ['montreuil-mairie', 'sucy-en-brie'];
const index = JSON.parse(readFileSync('dist-artifact/data/districts/index.json', 'utf8')).filter((m) => EMBED.includes(m.id));
const districts = [
  `<script type="application/json" id="districts-index">${JSON.stringify(index)}</script>`,
  ...EMBED.map((id) => `<script type="application/octet-stream" id="district-${id}">${gzipSync(readFileSync(`dist-artifact/data/districts/${id}.json`), { level: 9 }).toString('base64')}</script>`),
];
const page = [
  '<meta charset="utf-8">',
  '<title>Urbasim Prototype</title>',
  '<meta name="claude:viewport-fit-sides" content="cover">',
  `<style>${css}</style>`,
  body.trim(),
  ...districts,
  `<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`,
].join('\n');
writeFileSync('dist-artifact/urbasim.html', page);
console.log(`dist-artifact/urbasim.html : ${(page.length / 1024).toFixed(0)} Ko`);
