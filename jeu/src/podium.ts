// Classement « à la Mario Party » : les sociétés empilées à la verticale, de la première à la dernière, qui changent de place
// en glissant quand l'ordre bouge. Le même composant sert au bilan annuel, à l'onglet Classement et à l'écran de fin.
export interface PodiumRow {
  id: string;
  name: string;
  color: string;
  monogram: string;
  worth: number;
  me: boolean;
  /** Mention discrète (profil d'un concurrent). */
  tag?: string;
  bankrupt?: boolean;
}

export interface PodiumOptions {
  /** Positions (0 = première) et patrimoines précédents, pour faire glisser les lignes et compter les montants. */
  prevPos?: Record<string, number>;
  prevWorth?: Record<string, number>;
  format: (n: number) => string;
  reduceMotion?: boolean;
}

const ROW = 64;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const MEDALS = ['👑', '🥈', '🥉', ''];

/** Dessine (ou met à jour) le classement dans `host`. Les lignes sont retrouvées par identifiant : changer l'ordre les fait glisser. */
export function mountPodium(host: HTMLElement, rows: PodiumRow[], opts: PodiumOptions) {
  host.classList.add('podium');
  host.style.height = `${rows.length * ROW}px`;
  const top = Math.max(1, rows[0]?.worth ?? 1);
  const animate = !opts.reduceMotion;
  rows.forEach((r, i) => {
    let el = host.querySelector<HTMLElement>(`[data-p="${CSS.escape(r.id)}"]`);
    const fresh = !el;
    if (!el) {
      el = document.createElement('div');
      el.className = 'pd-row';
      el.dataset.p = r.id;
      el.innerHTML = `<span class="pd-rank"></span><span class="mono pd-mono"></span><div class="pd-main"><div class="pd-name"></div><div class="pd-bar"><i></i></div></div><div class="pd-val"><b></b><small></small></div>`;
      host.appendChild(el);
    }
    const prevI = opts.prevPos?.[r.id];
    const from = fresh && animate && prevI !== undefined ? prevI : i;
    const mono = el.querySelector<HTMLElement>('.pd-mono')!;
    mono.textContent = r.monogram;
    mono.style.background = r.color;
    el.classList.toggle('me', r.me);
    el.classList.toggle('first', i === 0);
    el.classList.toggle('bankrupt', !!r.bankrupt);
    el.querySelector<HTMLElement>('.pd-rank')!.innerHTML = MEDALS[i] ? `<span class="pd-medal">${MEDALS[i]}</span>` : `<b>${i + 1}</b>`;
    el.querySelector<HTMLElement>('.pd-name')!.innerHTML = `<span class="nm">${esc(r.name)}</span>${r.me ? '<em class="pd-you">vous</em>' : r.tag ? `<small>${esc(r.tag)}</small>` : ''}${r.bankrupt ? '<em class="pd-bk">faillite</em>' : ''}`;
    const moved = prevI === undefined ? 0 : prevI - i;
    const delta = el.querySelector<HTMLElement>('.pd-val small')!;
    delta.textContent = moved > 0 ? `▲ ${moved}` : moved < 0 ? `▼ ${-moved}` : '';
    delta.className = moved > 0 ? 'up' : moved < 0 ? 'down' : '';
    // Position et barre : on part de l'ancienne place, puis on glisse vers la nouvelle à l'image suivante.
    const bar = el.querySelector<HTMLElement>('.pd-bar i')!;
    const widthOf = (w: number) => `${Math.max(6, Math.min(100, (Math.max(0, w) / top) * 100))}%`;
    if (fresh) {
      el.style.transform = `translateY(${from * ROW}px)`;
      bar.style.width = widthOf(opts.prevWorth?.[r.id] ?? r.worth);
    }
    bar.style.background = r.color;
    const value = el.querySelector<HTMLElement>('.pd-val b')!;
    const start = opts.prevWorth?.[r.id];
    const place = () => {
      el!.style.transform = `translateY(${i * ROW}px)`;
      bar.style.width = widthOf(r.worth);
    };
    if (!animate) {
      place();
      value.textContent = opts.format(r.worth);
    } else {
      requestAnimationFrame(() => requestAnimationFrame(place));
      if (start === undefined || Math.round(start) === Math.round(r.worth)) value.textContent = opts.format(r.worth);
      else {
        const t0 = performance.now();
        const step = (now: number) => {
          const t = Math.min(1, (now - t0) / 900);
          value.textContent = opts.format(start + (r.worth - start) * (1 - Math.pow(1 - t, 3)));
          if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }
    }
  });
}
