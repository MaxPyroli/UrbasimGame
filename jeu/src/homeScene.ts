// Décor animé de l'écran d'accueil : un quartier qui sort de terre, des grues sur plusieurs plans, des nuages, et un ciel qui suit
// l'heure de la journée (soleil ou lune sur son arc, couleurs du ciel, fenêtres qui s'allument la nuit, étoiles).
// Tout est généré (aucune image) ; les animations se figent si l'animation est réduite. `?heure=22` force l'heure (essais).
const COLORS = ['#1f6feb', '#c2185b', '#e6ab02', '#1b9e77'];
const W = 1200;
const H = 800;
const GROUND = H - 16;

/** Générateur pseudo-aléatoire déterministe : le décor est le même à chaque ouverture. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

interface Building {
  x: number;
  w: number;
  top: number;
}

/** Une grue à tour : mât en treillis, flèche et contre-flèche reliées à la pointe par des haubans, cabine, chariot et charge. */
function crane(x: number, baseY: number, scale: number, opacity: number, phase: number): string {
  const MAST = 170;
  const topY = -MAST;
  // Treillis du mât : deux montants et des diagonales en zigzag.
  let mast = `<path d="M-6 ${topY} L-9 0 M6 ${topY} L9 0" />`;
  const steps = 14;
  for (let i = 0; i < steps; i++) {
    const y1 = topY + (MAST * i) / steps;
    const y2 = topY + (MAST * (i + 1)) / steps;
    const w1 = 6 + (3 * i) / steps;
    const w2 = 6 + (3 * (i + 1)) / steps;
    mast += `<path d="M${i % 2 ? w1 : -w1} ${y1.toFixed(1)} L${i % 2 ? -w2 : w2} ${y2.toFixed(1)} M${-w1} ${y1.toFixed(1)} L${w1} ${y1.toFixed(1)}" />`;
  }
  // Flèche : membrures haute et basse reliées par un treillis, de la contre-flèche (x = -52) à l'extrémité (x = 124).
  const yTop = topY - 14;
  const yBot = topY - 6;
  let jib = `<path d="M-52 ${yTop} L124 ${yTop} M-52 ${yBot} L124 ${yBot}" />`;
  for (let xx = -52; xx < 124; xx += 11) jib += `<path d="M${xx} ${yBot} L${xx + 5.5} ${yTop} L${xx + 11} ${yBot}" />`;
  const apexY = topY - 44;
  return `<g class="crane" transform="translate(${x} ${baseY}) scale(${scale})" opacity="${opacity}" style="--ph:${phase}s">
    <g class="lattice" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round">${mast}</g>
    <rect x="-11" y="${topY - 6}" width="22" height="7" rx="2" fill="currentColor"/>
    <g class="arm">
      <g stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round">${jib}
        <path d="M0 ${apexY} L118 ${yTop} M0 ${apexY} L-46 ${yTop}" stroke-width="1.1"/></g>
      <path d="M-5 ${topY - 14} L0 ${apexY} L5 ${topY - 14}Z" fill="currentColor"/>
      <rect x="-52" y="${yBot}" width="16" height="22" rx="2" fill="currentColor"/>
      <rect x="9" y="${topY - 16}" width="14" height="12" rx="2" fill="currentColor"/><rect x="16" y="${topY - 14}" width="5" height="5" rx="1" fill="#bfe3ff" opacity=".8"/>
      <g class="trolley"><rect x="72" y="${yBot - 1}" width="10" height="6" rx="1.5" fill="currentColor"/>
        <g class="hoist"><line x1="77" y1="${yBot + 5}" x2="77" y2="${yBot + 52}" stroke="currentColor" stroke-width="1.3"/><path d="M73 ${yBot + 52} h8 l-4 7z" fill="currentColor"/><rect x="66" y="${yBot + 59}" width="22" height="13" rx="2" fill="#e6ab02"/></g></g>
    </g></g>`;
}

/** Quartier (deux plans d'immeubles) et grues aux trois plans, plantées sur le toit d'immeubles précis. */
export function homeScene(): string {
  const r = rng(11);
  let idx = 0;
  const layers: { back: Building[]; front: Building[] } = { back: [], front: [] };
  const draw = (list: Building[], opacity: number, minH: number, maxH: number, widthRange: [number, number], name: 'back' | 'front') => {
    const parts: string[] = [];
    let x = -10;
    while (x < W + 10) {
      const w = widthRange[0] + r() * (widthRange[1] - widthRange[0]);
      // plus haut vers le centre, comme un quartier d'affaires
      const centre = 1 - Math.abs((x + w / 2) / W - 0.5) * 1.6;
      const h = Math.max(minH, (minH + (maxH - minH) * r()) * Math.max(0.45, centre));
      const color = COLORS[Math.floor(r() * COLORS.length)];
      const i = idx++;
      let wins = '';
      for (let wy = GROUND - h + 14; wy < GROUND - 16; wy += 20) {
        for (let wx = x + 8; wx < x + w - 12; wx += 16) {
          // Fenêtres allumées selon l'heure : toujours (w0), au crépuscule (w1), en pleine nuit (w2), jamais (w3).
          const k = r();
          const cls = k < 0.05 ? 'w0' : k < 0.34 ? 'w1' : k < 0.72 ? 'w2' : 'w3';
          wins += `<rect class="win ${cls}" x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="8" height="9" rx="2" style="--d:${((i * 7 + wx) % 13) / 2}s"/>`;
        }
      }
      list.push({ x, w, top: GROUND - h });
      parts.push(`<g class="bld" style="--i:${i}" opacity="${opacity}"><rect x="${x.toFixed(0)}" y="${(GROUND - h).toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" rx="5" fill="${color}"/>${wins}</g>`);
      x += w + 4 + r() * 8;
    }
    return `<g class="layer ${name}">${parts.join('')}</g>`;
  };
  const back = draw(layers.back, 0.4, 70, 250, [34, 64], 'back');
  const front = draw(layers.front, 1, 60, 230, [38, 74], 'front');
  // Une grue sur le toit de l'immeuble le plus proche de x (dans le plan voulu).
  const on = (list: Building[], x: number) => list.reduce((best, b) => (Math.abs(b.x + b.w / 2 - x) < Math.abs(best.x + best.w / 2 - x) ? b : best), list[0]);
  const place = (list: Building[], x: number, scale: number, opacity: number, phase: number) => {
    const b = on(list, x);
    return crane(b.x + b.w / 2, b.top + 2, scale, opacity, phase);
  };
  const cranesBack = place(layers.back, 520, 0.5, 0.4, -3) + place(layers.back, 900, 0.42, 0.4, -8);
  const cranesFront = place(layers.front, 150, 0.8, 1, -1) + place(layers.front, 1010, 0.62, 1, -5);
  return `<svg class="scene" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <g id="sky-layer"></g>${back}<g class="cranes back">${cranesBack}</g>${front}<g class="cranes front">${cranesFront}</g>
    <rect x="0" y="${GROUND}" width="${W}" height="16" class="ground"/></svg>`;
}

// ---------------------------------------------------------------- ciel

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB) => `rgb(${c.map((v) => Math.round(v)).join(',')})`;

// Couleurs du ciel (haut, bas) selon l'heure.
const KEYS: [number, string, string][] = [
  [0, '#070b1f', '#1a2250'],
  [5, '#0d1433', '#3a3566'],
  [6.5, '#5b6fb3', '#ffb88a'],
  [8, '#7db7f0', '#ffe9c4'],
  [12, '#4aa3f5', '#cfe9ff'],
  [17, '#6fb0ec', '#ffe3b0'],
  [19, '#6a5aa8', '#ff9a6b'],
  [20.5, '#1b2150', '#6a4a8a'],
  [22, '#0a0f2a', '#1f2a5c'],
  [24, '#070b1f', '#1a2250'],
];

/** Heure locale (décimale), ou celle de `?heure=` pour les essais. */
export function currentHour(): number {
  const q = new URLSearchParams(location.search).get('heure');
  if (q !== null && !Number.isNaN(Number(q))) return ((Number(q) % 24) + 24) % 24;
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}

/** Obscurité (0 = plein jour, 1 = nuit noire). */
const darkness = (h: number) => (h >= 21 || h <= 5 ? 1 : h < 8 ? 1 - (h - 5) / 3 : h <= 17 ? 0 : (h - 17) / 4);

/** Applique le ciel de l'heure donnée : couleurs, soleil ou lune sur son arc, étoiles, nuages, fenêtres allumées. */
export function applySky(home: HTMLElement, hour: number) {
  const k = KEYS.findIndex((x, i) => hour >= x[0] && hour <= KEYS[i + 1][0]);
  const [h0, t0, b0] = KEYS[k];
  const [h1, t1, b1] = KEYS[k + 1];
  const f = (hour - h0) / (h1 - h0);
  const top = mix(hex(t0), hex(t1), f);
  const bottom = mix(hex(b0), hex(b1), f);
  const dark = darkness(hour);
  const level = dark < 0.25 ? 0 : dark < 0.65 ? 1 : 2;
  home.style.setProperty('--sky-top', css(top));
  home.style.setProperty('--sky-bottom', css(bottom));
  home.style.setProperty('--dark', dark.toFixed(2));
  home.style.setProperty('--home-ink', dark > 0.5 ? '#eef1ff' : '#1d2433');
  home.dataset.dark = String(level);
  const layer = home.querySelector('#sky-layer');
  if (!layer) return;
  // Soleil de 6 h 30 à 20 h, lune de 20 h à 6 h 30 : un arc de gauche (est) à droite (ouest) derrière le quartier.
  const isDay = hour >= 6.5 && hour < 20;
  const t = isDay ? (hour - 6.5) / 13.5 : (((hour - 20 + 24) % 24) / 10.5);
  // (décalé vers la droite à midi pour ne pas passer derrière le titre)
  const cx = W * (0.1 + 0.8 * t + 0.26 * Math.sin(Math.PI * t));
  const cy = 620 - Math.sin(Math.PI * t) * 500;
  const low = 1 - Math.sin(Math.PI * t); // 1 à l'horizon, 0 au zénith
  const sunColor = css(mix(hex('#ffd45e'), hex('#ff7a3d'), Math.min(1, low * 1.6)));
  const body = isDay
    ? `<defs><radialGradient id="sg"><stop offset="0" stop-color="${sunColor}" stop-opacity=".6"/><stop offset="1" stop-color="${sunColor}" stop-opacity="0"/></radialGradient></defs><circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${(150 + low * 60).toFixed(0)}" fill="url(#sg)"/><circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${(44 + low * 10).toFixed(0)}" fill="${sunColor}"/>`
    : `<defs><radialGradient id="sg"><stop offset="0" stop-color="#cfd8ff" stop-opacity=".45"/><stop offset="1" stop-color="#cfd8ff" stop-opacity="0"/></radialGradient></defs><circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="120" fill="url(#sg)"/><circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="40" fill="#f4f1d8"/><circle cx="${(cx - 10).toFixed(0)}" cy="${(cy - 6).toFixed(0)}" r="7" fill="#d9d4b4" opacity=".7"/><circle cx="${(cx + 12).toFixed(0)}" cy="${(cy + 12).toFixed(0)}" r="5" fill="#d9d4b4" opacity=".7"/><circle cx="${(cx + 8).toFixed(0)}" cy="${(cy - 16).toFixed(0)}" r="4" fill="#d9d4b4" opacity=".6"/>`;
  // Étoiles : visibles à la tombée de la nuit.
  const r = rng(5);
  let stars = '';
  for (let i = 0; i < 70; i++) stars += `<circle class="star" cx="${(r() * W).toFixed(0)}" cy="${(r() * 420).toFixed(0)}" r="${(0.8 + r() * 1.6).toFixed(1)}" style="--d:${(r() * 6).toFixed(1)}s"/>`;
  // Nuages : blancs le jour, rosés au lever et au coucher, bleutés la nuit.
  const warm = Math.max(0, 1 - Math.abs(dark - 0.45) / 0.45) * 0.7;
  const cloudColor = css(mix(mix(hex('#ffffff'), hex('#ffc4b0'), warm), hex('#5a6598'), dark * 0.85));
  const puff = (x: number, y: number, s: number, cls: string, anim: string) =>
    `<g class="cloud ${cls}" style="${anim}" transform="translate(${x} ${y}) scale(${s})" fill="${cloudColor}"><ellipse cx="0" cy="14" rx="86" ry="14"/><circle cx="-44" cy="2" r="22"/><circle cx="-14" cy="-14" r="30"/><circle cx="24" cy="-6" r="26"/><circle cx="54" cy="6" r="18"/><ellipse cx="0" cy="18" rx="80" ry="8" fill="#000" opacity=".06"/></g>`;
  const clouds = puff(180, 190, 1, 'c1', 'animation-duration:70s') + puff(520, 100, 0.7, 'c2', 'animation-duration:95s') + puff(900, 250, 1.15, 'c3', 'animation-duration:80s;animation-direction:alternate-reverse') + puff(1080, 90, 0.6, 'c4', 'animation-duration:110s') + puff(340, 330, 0.55, 'c5', 'animation-duration:120s');
  layer.innerHTML = `<g class="stars" style="opacity:${Math.max(0, (dark - 0.35) / 0.65).toFixed(2)}">${stars}</g>${body}<g class="clouds" style="opacity:${(0.95 - dark * 0.4).toFixed(2)}">${clouds}</g>`;
}
