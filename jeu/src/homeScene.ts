// Décor animé de l'écran d'accueil : une ligne d'immeubles qui sortent de terre, des fenêtres qui s'allument, une grue et des nuages.
// Les couleurs reprennent celles du logo ; tout est généré (aucune image) et se fige si l'animation est réduite.
const COLORS = ['#1f6feb', '#c2185b', '#e6ab02', '#1b9e77'];

/** Générateur pseudo-aléatoire déterministe : le décor est le même à chaque ouverture. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export function homeScene(): string {
  const r = rng(7);
  const W = 1200;
  const H = 800;
  const GROUND = H - 16;
  const parts: string[] = [];
  // Deux plans : fond (estompé, plus haut) et premier plan.
  let idx = 0;
  const layer = (n: number, baseOpacity: number, minH: number, maxH: number, widthRange: [number, number]) => {
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
          const lit = r() < 0.28;
          wins += `<rect class="win${lit ? ' lit' : ''}" x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="8" height="9" rx="2" style="--d:${((i * 7 + wx) % 13) / 2}s"/>`;
        }
      }
      parts.push(`<g class="bld" style="--i:${i}" opacity="${baseOpacity}"><rect x="${x.toFixed(0)}" y="${(GROUND - h).toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" rx="5" fill="${color}"/>${wins}</g>`);
      x += w + 4 + r() * 8;
    }
    return n;
  };
  layer(0, 0.38, 70, 250, [34, 64]);
  layer(1, 1, 60, 230, [38, 74]);
  // Grue au-dessus du bâtiment le plus à droite du centre
  const cx = 820;
  const crane = `<g class="crane" transform="translate(${cx} ${GROUND - 160})">
      <rect x="-3" y="0" width="6" height="150" fill="currentColor" opacity=".75"/>
      <g class="arm"><rect x="-90" y="-6" width="190" height="5" fill="currentColor" opacity=".85"/><rect x="-96" y="-14" width="22" height="10" fill="currentColor"/>
        <line class="rope" x1="60" y1="-1" x2="60" y2="50" stroke="currentColor" stroke-width="1.5"/><rect class="load" x="52" y="50" width="16" height="10" rx="2" fill="#e6ab02"/></g>
      <path d="M-3 0 L0 -26 L3 0Z" fill="currentColor"/></g>`;
  const clouds = `<g class="clouds" fill="#fff"><ellipse class="cl c1" cx="190" cy="190" rx="78" ry="20"/><ellipse class="cl c2" cx="560" cy="110" rx="60" ry="15"/><ellipse class="cl c3" cx="960" cy="260" rx="86" ry="22"/></g>`;
  const sun = `<circle class="sun-glow" cx="${W * 0.82}" cy="180" r="100"/><circle class="sun" cx="${W * 0.82}" cy="180" r="46"/>`;
  return `<svg class="scene" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" aria-hidden="true">${sun}${clouds}${parts.join('')}${crane}<rect x="0" y="${GROUND}" width="${W}" height="16" class="ground"/></svg>`;
}
