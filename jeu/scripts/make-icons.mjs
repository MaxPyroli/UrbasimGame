// Dessine le logo d'Urbasim (une skyline qui monte, dans les couleurs du jeu) et en tire tous les formats :
//   public/icons/logo.svg et src/assets/logo.svg (grand, même dessin), public/icons/favicon.svg (simplifié, lisible à 32 px), puis les PNG (favicon, icônes installables, iOS).
// Usage : node scripts/make-icons.mjs   (les PNG demandent playwright-core et un Chromium : CHROME_PATH, sinon /opt/pw-browsers)
import { readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const BG = '#14171c';
const C = { blue: '#1f6feb', magenta: '#c2185b', yellow: '#e6ab02', green: '#1b9e77' };
const LIT = '#ffe08a';
const f = (n) => Math.round(n * 10) / 10;

/** Skyline sans fond : renvoie le dessin pour un carré de 512 (baseline à 398). */
function skyline() {
  const w = 46, gap = 8, base = 398;
  const heights = [92, 148, 118, 200, 168, 262, 214];
  const colors = [C.blue, C.magenta, C.yellow, C.green, C.blue, C.magenta, C.yellow];
  const x0 = (512 - (heights.length * w + (heights.length - 1) * gap)) / 2;
  let out = '';
  // soleil levant derrière la skyline : deux cercles concentriques, discrets
  out += `<circle cx="372" cy="190" r="112" fill="${C.yellow}" opacity=".13"/><circle cx="372" cy="190" r="66" fill="${C.yellow}" opacity=".2"/>`;
  heights.forEach((h, i) => {
    const x = x0 + i * (w + gap);
    const top = base - h;
    out += `<rect x="${f(x)}" y="${top}" width="${w}" height="${h}" rx="7" fill="${colors[i]}"/>`;
    // fenêtres : deux colonnes, quelques-unes allumées
    let r = 0;
    for (let y = top + 18; y < base - 26; y += 24, r++) {
      for (let c = 0; c < 2; c++) {
        const lit = (i * 7 + r * 3 + c * 2) % 5 === 0;
        out += `<rect x="${f(x + 9 + c * 18)}" y="${y}" width="11" height="11" rx="2.5" fill="${lit ? LIT : '#fff'}" opacity="${lit ? 0.95 : 0.26}"/>`;
      }
    }
    // couronnements : retraits sur deux immeubles
    if (i === 3) out += `<rect x="${f(x + 9)}" y="${top - 20}" width="28" height="24" rx="5" fill="${colors[i]}"/>`;
  });
  // le plus haut : un retrait, une flèche et une balise allumée
  const tx = x0 + 5 * (w + gap) + w / 2;
  const ttop = base - heights[5];
  out += `<rect x="${f(tx - 14)}" y="${ttop - 30}" width="28" height="34" rx="5" fill="${colors[5]}"/>`;
  out += `<rect x="${f(tx - 2)}" y="${ttop - 74}" width="4" height="46" rx="2" fill="#eceef2"/>`;
  out += `<circle cx="${f(tx)}" cy="${ttop - 80}" r="17" fill="${LIT}" opacity=".28"/><circle cx="${f(tx)}" cy="${ttop - 80}" r="8" fill="${LIT}"/>`;
  // sol
  out += `<rect x="54" y="406" width="404" height="12" rx="6" fill="#eceef2" opacity=".92"/>`;
  return out;
}

/** Version simplifiée pour les très petites tailles (carré de 64) : moins d'immeubles, pas de fenêtres. */
function skylineSmall() {
  const w = 8, gap = 2, base = 50;
  const heights = [14, 22, 17, 36, 26];
  const colors = [C.blue, C.yellow, C.green, C.magenta, C.blue];
  const x0 = (64 - (heights.length * w + (heights.length - 1) * gap)) / 2;
  let out = '';
  heights.forEach((h, i) => (out += `<rect x="${f(x0 + i * (w + gap))}" y="${base - h}" width="${w}" height="${h}" rx="1.5" fill="${colors[i]}"/>`));
  const tx = x0 + 3 * (w + gap) + w / 2;
  out += `<rect x="${f(tx - 0.7)}" y="${base - 36 - 9}" width="1.4" height="10" rx=".7" fill="#eceef2"/><circle cx="${f(tx)}" cy="${base - 36 - 10}" r="2.6" fill="${LIT}"/>`;
  out += `<rect x="6" y="52.5" width="52" height="3" rx="1.5" fill="#eceef2" opacity=".92"/>`;
  return out;
}

const tile = (inner, size, rx) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="Urbasim"><title>Urbasim</title><rect width="${size}" height="${size}" rx="${rx}" fill="${BG}"/>${inner}</svg>\n`;
/** Fond plein écran, dessin réduit pour rester dans la zone de sécurité des icônes « maskable » / iOS. */
const full = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${BG}"/><g transform="translate(${f(256 - 256 * scale)} ${f(256 - 256 * scale)}) scale(${scale})">${skyline()}</g></svg>`;

const dir = new URL('../public/icons/', import.meta.url);
writeFileSync(new URL('logo.svg', dir), tile(skyline(), 512, 112));
// Le même dessin est importé par le jeu (écran d'accueil, en-tête) : une seule source pour tous les logos.
writeFileSync(new URL('../src/assets/logo.svg', import.meta.url), tile(skyline(), 512, 112));
writeFileSync(new URL('favicon.svg', dir), tile(skylineSmall(), 64, 14));
console.log('logo.svg et favicon.svg écrits');

// PNG : rendu par Chromium
let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright-core'));
} catch {
  console.log('playwright-core absent : PNG non régénérés');
  process.exit(0);
}
const chrome = process.env.CHROME_PATH ?? `/opt/pw-browsers/${readdirSync('/opt/pw-browsers').find((n) => n.startsWith('chromium-'))}/chrome-linux/chrome`;
const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });
const png = async (svg, size, file) => {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div></body>`);
  await page.screenshot({ path: new URL(file, dir).pathname, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
};
await png(tile(skylineSmall(), 64, 14), 32, 'favicon-32.png');
await png(tile(skylineSmall(), 64, 14), 48, 'favicon-48.png');
await png(full(0.9), 180, 'apple-touch-icon.png');
await png(tile(skyline(), 512, 112), 192, 'icon-192.png');
await png(tile(skyline(), 512, 112), 512, 'icon-512.png');
await png(full(0.78), 512, 'maskable-512.png');
await browser.close();
console.log('PNG écrits : favicon-32, favicon-48, apple-touch-icon, icon-192, icon-512, maskable-512');
