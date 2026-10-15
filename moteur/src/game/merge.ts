import {
  LocalProjection,
  cleanRing,
  distToSegment,
  largestPolygon,
  ringArea,
  signedArea,
  toMulti,
  union,
  type LonLat,
  type Parcel,
  type Ring,
  type Vec2,
} from '../engine';

export type MergeResult = { ok: true; parcel: Parcel; area: number } | { ok: false; error: string };

/** Deux parcelles sont mitoyennes si des arêtes se confondent (à `TOL` près) sur au moins `MIN_SHARED` mètres. */
const TOL = 0.6;
const MIN_SHARED = 1.5;
/** Fermeture morphologique : comble les jours de numérisation du cadastre (quelques cm) entre deux parcelles. */
const CLOSE = 0.2;

function sharedLength(a: Ring, b: Ring): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = a[(i + 1) % a.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    // On échantillonne l'arête : la part qui longe l'autre parcelle compte.
    const n = Math.max(2, Math.ceil(len / 0.5));
    let near = 0;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const m: Vec2 = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      if (b.some((c, j) => distToSegment(m, c, b[(j + 1) % b.length]) < TOL)) near++;
    }
    total += (len * near) / n;
  }
  return total;
}

/** Décale chaque côté de `d` mètres vers l'extérieur (d < 0 : vers l'intérieur), angles vifs bornés. */
function offsetRing(ring: Ring, d: number): Ring {
  const ccw = signedArea(ring) > 0;
  const r = ccw ? ring : [...ring].reverse();
  const n = r.length;
  const lines = r.map((a, i) => {
    const b = r[(i + 1) % n];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const ux = (b[0] - a[0]) / l;
    const uy = (b[1] - a[1]) / l;
    // normale sortante d'un anneau CCW : (uy, -ux)
    return { p: [a[0] + uy * d, a[1] - ux * d] as Vec2, u: [ux, uy] as Vec2 };
  });
  const out: Vec2[] = r.map((v, i) => {
    const l0 = lines[(i - 1 + n) % n];
    const l1 = lines[i];
    const det = l0.u[0] * l1.u[1] - l0.u[1] * l1.u[0];
    if (Math.abs(det) < 1e-9) return [l1.p[0], l1.p[1]] as Vec2;
    const t = ((l1.p[0] - l0.p[0]) * l1.u[1] - (l1.p[1] - l0.p[1]) * l1.u[0]) / det;
    const x = l0.p[0] + l0.u[0] * t;
    const y = l0.p[1] + l0.u[1] * t;
    const miter = Math.hypot(x - v[0], y - v[1]);
    if (miter > 4 * Math.abs(d)) {
      // angle très aigu : on se contente du décalage de la normale
      const nx = (l0.u[1] + l1.u[1]) / 2;
      const ny = -(l0.u[0] + l1.u[0]) / 2;
      const nl = Math.hypot(nx, ny) || 1;
      return [v[0] + (nx / nl) * d, v[1] + (ny / nl) * d] as Vec2;
    }
    return [x, y] as Vec2;
  });
  return ccw ? out : out.reverse();
}

/**
 * Assemble plusieurs parcelles mitoyennes en une seule. Les façades sur rue de la parcelle fusionnée sont celles des
 * parcelles d'origine. Refuse les parcelles qui ne se touchent pas, ou qui enferment une cour (un trou).
 */
export function mergeParcels(parcels: Parcel[]): MergeResult {
  if (parcels.length < 2) return { ok: false, error: 'il faut au moins deux parcelles' };
  const all = parcels.flatMap((p) => p.ring);
  const proj = new LocalProjection(all.reduce((s, p) => s + p.lon, 0) / all.length, all.reduce((s, p) => s + p.lat, 0) / all.length);
  const rings = parcels.map((p) => cleanRing(p.ring.map((q) => proj.toLocal(q)), 0.02));

  // Connexité par mitoyenneté (parcours en largeur).
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const i = queue.shift()!;
    rings.forEach((r, j) => {
      if (!seen.has(j) && sharedLength(rings[i], r) >= MIN_SHARED) {
        seen.add(j);
        queue.push(j);
      }
    });
  }
  if (seen.size !== parcels.length) return { ok: false, error: 'ces parcelles ne se touchent pas : il faut au moins 1,5 m de limite commune (un simple coin ne suffit pas)' };

  const grown = rings.map((r) => toMulti(offsetRing(r, CLOSE)));
  let merged: ReturnType<typeof union>;
  try {
    merged = union(grown[0], ...grown.slice(1));
  } catch {
    // contours trop irréguliers pour la bibliothèque de découpage
    return { ok: false, error: 'assemblage impossible : les contours sont trop irréguliers' };
  }
  const poly = largestPolygon(merged);
  if (!poly || merged.length !== 1) return { ok: false, error: 'assemblage impossible : le contour obtenu n’est pas d’un seul tenant (parcelles séparées par un jour trop large)' };
  if (poly.length > 1) {
    const holes = poly.slice(1).reduce((s, h) => s + ringArea(h), 0);
    if (holes > 3) return { ok: false, error: 'l’assemblage entourerait une parcelle que vous ne possédez pas (au milieu) : achetez-la d’abord' };
  }
  const outer = cleanRing(offsetRing(poly[0], -CLOSE), 0.1);
  if (outer.length < 3) return { ok: false, error: 'assemblage impossible' };
  const area = ringArea(outer);
  const expected = rings.reduce((s, r) => s + ringArea(r), 0);
  if (area < expected * 0.97 || area > expected * 1.03) return { ok: false, error: 'assemblage incohérent (surface différente de la somme des parcelles)' };

  // Façades sur rue : les côtés de l'assemblage qui longent une façade sur rue d'origine.
  // Les indices d'arêtes valent pour le contour d'origine, pas pour le contour nettoyé.
  const orig = parcels.map((p) => p.ring.map((q) => proj.toLocal(q)));
  const streetSegs: [Vec2, Vec2][] = [];
  parcels.forEach((p, k) => {
    for (const e of p.streetEdges) streetSegs.push([orig[k][e], orig[k][(e + 1) % orig[k].length]]);
  });
  const streetEdges: number[] = [];
  outer.forEach((a, i) => {
    const b = outer[(i + 1) % outer.length];
    const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (streetSegs.some(([s, t]) => distToSegment(mid, s, t) < 0.5)) streetEdges.push(i);
  });

  const ring: LonLat[] = outer.map((v) => proj.toLonLat(v));
  return { ok: true, parcel: { ring, streetEdges }, area };
}
