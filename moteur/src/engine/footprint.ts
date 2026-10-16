import {
  Frame,
  bbox,
  cleanRing,
  difference,
  dot,
  intersection,
  largestPolygon,
  minWidth,
  multiArea,
  polygonArea,
  rectRing,
  ringArea,
  toMulti,
  union,
} from './geometry';
import type { FootprintShape, MultiPolygon, Placement, PolygonRings, Ring, Vec2 } from './types';

/** Une rue secondaire (terrain d'angle) le long de laquelle le bâtiment peut aussi s'étendre, en repère du terrain. */
export interface StreetFront {
  a: Vec2;
  b: Vec2;
  /** Normale unitaire de la limite, orientée vers l'intérieur du terrain. */
  n: Vec2;
  /** Retrait appliqué sur cette limite : la profondeur se compte depuis l'alignement de construction. */
  setback: number;
}

export interface FootprintOptions {
  shape: FootprintShape;
  maxDepth: number;
  minWidth: number;
  /** Plafond de surface d'emprise (CES, densité…), null = aucun. */
  areaCap: number | null;
  /** Position dans la profondeur : côté rue, en fond de parcelle, ou la meilleure des deux. */
  placement: Placement;
  /** Emprise la plus compacte possible (maisons : un volume proche du carré plutôt qu'une bande étroite et longue). */
  compact?: boolean;
  /** Autres rues du terrain (angle) : l'emprise « adaptée » les longe aussi, sur la même profondeur maximale. */
  streetFronts?: StreetFront[];
}

export interface FootprintResult {
  /** Emprise en coordonnées locales, null si aucune emprise viable. */
  ring: Ring | null;
  /** Contraintes qui ont borné l'emprise. */
  limitedBy: string[];
  /** Où l'emprise a été placée. */
  at: 'rue' | 'fond';
  reason?: string;
}

const MIN_AREA = 12;
/** En mode automatique, le fond de parcelle ne l'emporte sur la rue que s'il offre au moins 3 % d'emprise de plus. */
const AUTO_GAIN = 1.03;

/** Cherche la plus grande profondeur d ∈ [0, dMax] telle que area(d) ≤ cap (area croissante). */
function bisectDepth(areaAt: (d: number) => number, dMax: number, cap: number): number {
  let lo = 0;
  let hi = dMax;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (areaAt(mid) <= cap) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Emprise « adaptée » : l'enveloppe constructible, tranchée à la profondeur maximale depuis la rue. Sur un terrain
 * d'angle, elle longe aussi les autres rues (bande de la même profondeur le long de chacune) : un « L » plutôt qu'une
 * simple bande le long de la rue principale. Si ces bandes refermaient une cour (terrain bordé de rues de tous côtés),
 * on garde la seule bande de la rue principale : l'emprise n'a pas de trou.
 */
function adaptedFootprint(comp: PolygonRings, opts: FootprintOptions, fronts: StreetFront[] = []): { ring: Ring; limitedBy: string[] } | null {
  const bb = bbox(comp[0]);
  const extent = bb.maxY - bb.minY;
  const dMax = fronts.length > 0 ? opts.maxDepth : Math.min(opts.maxDepth, extent);
  const band = (d: number): MultiPolygon => toMulti(rectRing(bb.minX - 1, bb.minY - 1, bb.maxX + 1, bb.minY + d));
  const strip = (f: StreetFront, d: number): MultiPolygon => {
    const at = (p: Vec2, k: number): Vec2 => [p[0] + f.n[0] * k, p[1] + f.n[1] * k];
    return toMulti([at(f.a, f.setback), at(f.b, f.setback), at(f.b, f.setback + d), at(f.a, f.setback + d)]);
  };
  const cut = (d: number) => {
    if (fronts.length > 0) {
      const poly = largestPolygon(intersection([comp], union(band(d), ...fronts.map((f) => strip(f, d)))));
      if (poly && poly.length === 1) return poly;
    }
    return largestPolygon(intersection([comp], band(d)));
  };
  const areaAt = (d: number) => {
    const p = cut(d);
    return p ? polygonArea(p) : 0;
  };
  const limitedBy: string[] = [];
  let d = dMax;
  const depthLimits = fronts.length > 0 ? areaAt(dMax) < polygonArea(comp) - 1e-3 : opts.maxDepth < extent - 1e-6;
  if (depthLimits) limitedBy.push('profondeur maximale');
  if (opts.areaCap !== null && areaAt(d) > opts.areaCap) {
    d = bisectDepth(areaAt, dMax, opts.areaCap);
    limitedBy.push('emprise / densité');
  }
  const poly = cut(d);
  if (!poly) return null;
  return { ring: cleanRing(poly[0]), limitedBy };
}

/** Plus grand rectangle (aligné sur la rue) inscrit dans le polygone, profondeur bornée. */
function largestRectangle(comp: PolygonRings, opts: FootprintOptions): { ring: Ring; limitedBy: string[] } | null {
  const outer = comp[0];
  const bb = bbox(outer);
  // résolution de la grille : 25 cm, relâchée pour les très grands terrains afin de borner la mémoire
  const res = Math.max(0.25, Math.sqrt(((bb.maxX - bb.minX) * (bb.maxY - bb.minY)) / 2e6));
  const W = Math.max(1, Math.ceil((bb.maxX - bb.minX) / res));
  const H = Math.max(1, Math.ceil((bb.maxY - bb.minY) / res));
  // Trame par balayage : pour chaque ligne, abscisses où les contours (extérieur et cours) croisent la ligne ; une cellule est
  // retenue si ses quatre coins sont à l'intérieur (parité du nombre de croisements à droite du point).
  const crossings = (y: number): number[] => {
    const xs: number[] = [];
    for (const r of comp) {
      for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
        const [xa, ya] = r[a];
        const [xb, yb] = r[b];
        if (ya > y !== yb > y) xs.push(((xb - xa) * (y - ya)) / (yb - ya) + xa);
      }
    }
    return xs.sort((p, q) => p - q);
  };
  const insideAt = (xs: number[], x: number): boolean => {
    let lo = 0;
    let hi = xs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] > x) hi = mid;
      else lo = mid + 1;
    }
    return ((xs.length - lo) & 1) === 1;
  };
  const cell: Uint8Array[] = [];
  for (let j = 0; j < H; j++) {
    const row = new Uint8Array(W);
    const y0 = bb.minY + j * res;
    const lowX = crossings(y0 + 0.01);
    const highX = crossings(y0 + res - 0.01);
    for (let i = 0; i < W; i++) {
      const xl = bb.minX + i * res + 0.01;
      const xr = bb.minX + (i + 1) * res - 0.01;
      row[i] = insideAt(lowX, xl) && insideAt(lowX, xr) && insideAt(highX, xl) && insideAt(highX, xr) ? 1 : 0;
    }
    cell.push(row);
  }
  const maxRows = Math.max(1, Math.floor(opts.maxDepth / res));
  const cap = opts.areaCap;
  let best = { score: 0, i0: 0, w: 0, j0: 0, rows: 0 };
  const ok = new Uint8Array(W);
  for (let j0 = 0; j0 < H; j0++) {
    ok.fill(1);
    for (let rows = 1; rows <= maxRows && j0 + rows <= H; rows++) {
      const row = cell[j0 + rows - 1];
      let any = false;
      for (let i = 0; i < W; i++) {
        ok[i] = ok[i] & row[i];
        if (ok[i]) any = true;
      }
      if (!any) break;
      let run = 0;
      let runStart = 0;
      for (let i = 0; i <= W; i++) {
        if (i < W && ok[i]) {
          if (run === 0) runStart = i;
          run++;
        } else if (run > 0) {
          let w = run;
          if (cap !== null) w = Math.min(w, Math.floor(cap / (rows * res * res)));
          const score = w * rows;
          const tie = score >= best.score * 0.995 && (opts.compact ? w + rows < best.w + best.rows : w > best.w);
          if (score > best.score * 1.005 || tie) {
            best = { score, i0: runStart, w, j0, rows };
          }
          run = 0;
        }
      }
    }
  }
  if (best.score === 0) return null;
  let x0 = bb.minX + best.i0 * res;
  let x1 = x0 + best.w * res;
  const y0 = bb.minY + best.j0 * res;
  let y1 = y0 + best.rows * res;

  // Affinage : on agrandit chaque côté tant que le rectangle reste dans le polygone.
  const inside = (a: number, b: number, c: number, d: number) =>
    multiArea(difference(toMulti(rectRing(a, b, c, d)), [comp])) < 1e-4 &&
    (cap === null || (c - a) * (d - b) <= cap + 1e-6);
  const grow = (get: () => number, set: (v: number) => void, max: number) => {
    let lo = 0;
    let hi = max;
    for (let k = 0; k < 8; k++) {
      const mid = (lo + hi) / 2;
      const old = get();
      set(old + mid);
      const okRect = inside(x0, y0, x1, y1);
      set(old);
      if (okRect) lo = mid;
      else hi = mid;
    }
    set(get() + lo);
  };
  // Si le rectangle initial dépasse (échantillonnage), on le rétrécit un peu.
  for (let k = 0; k < 6 && !inside(x0, y0, x1, y1); k++) {
    x0 += 0.03;
    x1 -= 0.03;
    y1 -= 0.03;
  }
  grow(() => x1, (v) => (x1 = v), res);
  grow(() => x0, (v) => (x0 = v), -res);
  if (y1 - y0 < opts.maxDepth - 1e-6) grow(() => y1, (v) => (y1 = Math.min(v, y0 + opts.maxDepth)), res);

  const limitedBy: string[] = [];
  if (y1 - y0 >= opts.maxDepth - 0.3) limitedBy.push('profondeur maximale');
  if (cap !== null && (x1 - x0) * (y1 - y0) >= cap - 0.5) limitedBy.push('emprise / densité');
  return { ring: rectRing(x0, y0, x1, y1), limitedBy };
}

/** Douglas–Peucker sur un contour fermé : on garde les sommets qui s'écartent de plus de `eps` mètres. */
function simplifyRing(ring: Ring, eps: number): Ring {
  if (ring.length <= 4) return ring;
  // on coupe le contour en deux au sommet le plus éloigné du premier, puis on simplifie chaque moitié
  let far = 0;
  for (let i = 1; i < ring.length; i++) if (distTo(ring[i], ring[0]) > distTo(ring[far], ring[0])) far = i;
  const half = (pts: Vec2[]): Vec2[] => {
    if (pts.length <= 2) return pts;
    const a = pts[0];
    const b = pts[pts.length - 1];
    let idx = 0;
    let dmax = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = distToSeg(pts[i], a, b);
      if (d > dmax) {
        dmax = d;
        idx = i;
      }
    }
    if (dmax <= eps) return [a, b];
    return [...half(pts.slice(0, idx + 1)).slice(0, -1), ...half(pts.slice(idx))];
  };
  const first = half(ring.slice(0, far + 1));
  const second = half([...ring.slice(far), ring[0]]);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}
const distTo = (p: Vec2, q: Vec2) => Math.hypot(p[0] - q[0], p[1] - q[1]);
function distToSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return distTo(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return distTo(p, [a[0] + t * dx, a[1] + t * dy]);
}
/** Compacité d'un contour (1 = cercle, 0,785 = carré, petit = forme en lanière ou en peigne). */
function compactness(r: Ring): number {
  let per = 0;
  for (let i = 0; i < r.length; i++) per += distTo(r[i], r[(i + 1) % r.length]);
  return per > 0 ? (4 * Math.PI * ringArea(r)) / (per * per) : 0;
}
/** Une emprise est trop tarabiscotée pour un vrai bâtiment : beaucoup de côtés, ou forme en lanière. */
const isComplex = (r: Ring) => r.length > 8 || (r.length > 6 && compactness(r) < 0.4) || compactness(r) < 0.25;

/**
 * Rend l'emprise plus réaliste : un bâtiment a peu de côtés et des angles francs. Une emprise tarabiscotée est d'abord
 * simplifiée (décrochements de moins d'un mètre effacés, recoupée dans l'enveloppe) ; si elle reste complexe, on lui
 * préfère le plus grand rectangle de l'enveloppe quand il garde au moins 70 % de la surface.
 */
function regularize(res: { ring: Ring; limitedBy: string[] }, comp: PolygonRings, opts: FootprintOptions): { ring: Ring; limitedBy: string[] } {
  if (!isComplex(res.ring)) return res;
  const area = ringArea(res.ring);
  let simp: Ring | null = null;
  const poly = largestPolygon(intersection([comp], toMulti(simplifyRing(res.ring, 1))));
  if (poly) {
    const r = cleanRing(poly[0], 0.3);
    if (r.length >= 3 && (opts.areaCap === null || ringArea(r) <= opts.areaCap + 0.5)) simp = r;
  }
  if (simp && !isComplex(simp) && ringArea(simp) >= 0.85 * area) return { ...res, ring: simp };
  const rect = largestRectangle(comp, opts);
  if (rect && ringArea(rect.ring) >= 0.7 * area) return { ring: rect.ring, limitedBy: [...new Set([...res.limitedBy, ...rect.limitedBy])] };
  if (simp && ringArea(simp) >= 0.8 * area && simp.length < res.ring.length) return { ...res, ring: simp };
  return res;
}

interface Candidate {
  ring: Ring;
  limitedBy: string[];
  area: number;
}

/** Meilleure emprise de l'enveloppe, calculée depuis le bas du repère (v = 0 : côté rue). */
function bestIn(env: MultiPolygon, opts: FootprintOptions, fronts: StreetFront[] = []): Candidate | null {
  let best: Candidate | null = null;
  for (const comp of env) {
    if (polygonArea(comp) < MIN_AREA) continue;
    const raw = opts.shape === 'rectangle' ? largestRectangle(comp, opts) : adaptedFootprint(comp, opts, fronts);
    if (!raw) continue;
    const res = opts.shape === 'rectangle' ? raw : regularize(raw, comp, opts);
    const area = ringArea(res.ring);
    if (!best || area > best.area) best = { ...res, area };
  }
  return best;
}

/** Symétrie par rapport à la rue : le fond de parcelle devient le côté d'où l'on tranche. */
const mirrorEnv = (m: MultiPolygon): MultiPolygon => m.map((poly) => poly.map((r) => r.map(([x, y]) => [x, -y] as Vec2)));
/** Symétrique d'un contour, parcouru en sens inverse pour garder son orientation. */
const mirrorRing = (r: Ring): Ring => r.map(([x, y]) => [x, -y] as Vec2).reverse();

/**
 * Génère l'emprise du bâtiment dans l'enveloppe constructible.
 * Tout se passe dans le repère (u le long de la rue, v vers le fond de parcelle). Le bâtiment se place soit côté rue
 * (on tranche depuis la rue), soit en fond de parcelle (même calcul dans le repère inversé), soit — en mode
 * automatique — là où l'emprise est la plus grande, la rue l'emportant à égalité.
 */
/**
 * Mémoire du placement : estimer un terrain à plusieurs hauteurs redemande presque toujours le même placement (la zone
 * constructible et le plafond d'emprise ne dépendent pas du nombre de niveaux). Clé = contenu exact des entrées, donc le
 * résultat est identique à un recalcul ; courte (les calculs d'un même terrain se suivent) pour rester légère.
 */
export const footprintCache = { enabled: true, hits: 0, misses: 0, max: 128, store: new Map<string, FootprintResult>() };
const copyResult = (r: FootprintResult): FootprintResult => ({ ...r, ring: r.ring && r.ring.map((p) => [p[0], p[1]] as [number, number]), limitedBy: [...r.limitedBy] });

export function generateFootprint(envelope: MultiPolygon, frame: Frame, opts: FootprintOptions): FootprintResult {
  if (!footprintCache.enabled) return generateFootprintUncached(envelope, frame, opts);
  const key = JSON.stringify([envelope, frame.origin, frame.u, frame.v, opts]);
  const hit = footprintCache.store.get(key);
  if (hit) {
    footprintCache.hits++;
    return copyResult(hit);
  }
  footprintCache.misses++;
  const result = generateFootprintUncached(envelope, frame, opts);
  footprintCache.store.set(key, copyResult(result));
  if (footprintCache.store.size > footprintCache.max) footprintCache.store.delete(footprintCache.store.keys().next().value as string);
  return result;
}

export function generateFootprintUncached(envelope: MultiPolygon, frame: Frame, opts: FootprintOptions): FootprintResult {
  if (envelope.length === 0) return { ring: null, limitedBy: ['retraits'], at: 'rue', reason: 'Les retraits laissent un terrain inconstructible.' };
  const env = frame.toMulti(envelope);
  const placement: Placement = opts.placement === 'fond' || opts.placement === 'auto' ? opts.placement : 'rue';
  const viable = (c: Candidate | null): c is Candidate => c !== null && c.area >= MIN_AREA && minWidth(c.ring) >= opts.minWidth;

  // autres rues, converties dans le repère de calcul (la symétrie du fond de parcelle ne les utilise pas)
  const fronts: StreetFront[] = (opts.streetFronts ?? []).map((f) => ({
    a: frame.to(f.a),
    b: frame.to(f.b),
    n: [dot(f.n, frame.u), dot(f.n, frame.v)],
    setback: f.setback,
  }));
  let front = placement === 'fond' ? null : bestIn(env, opts, fronts);
  let back: Candidate | null = null;
  if (placement !== 'rue') {
    const m = bestIn(mirrorEnv(env), opts);
    back = m && { ...m, ring: mirrorRing(m.ring) };
  }
  if (placement === 'fond' && !viable(back)) front = bestIn(env, opts, fronts); // repli : mieux vaut un bâtiment sur rue que rien

  let at: 'rue' | 'fond' = 'rue';
  if (placement === 'fond') at = viable(back) || !viable(front) ? 'fond' : 'rue';
  else if (placement === 'auto') at = viable(back) && (!viable(front) || back.area > front.area * AUTO_GAIN) ? 'fond' : 'rue';

  const best = (at === 'fond' ? back : front) ?? front ?? back;
  if (!best || best.area < MIN_AREA) {
    return { ring: null, limitedBy: ['retraits'], at, reason: 'Emprise constructible trop petite après retraits.' };
  }
  const limitedBy = best.limitedBy.length > 0 ? best.limitedBy : ['retraits'];
  if (minWidth(best.ring) < opts.minWidth) {
    return {
      ring: null,
      limitedBy,
      at,
      reason: `Largeur exploitable (${minWidth(best.ring).toFixed(1)} m) inférieure au minimum de ${opts.minWidth} m.`,
    };
  }
  return { ring: frame.fromRing(best.ring), limitedBy, at };
}
