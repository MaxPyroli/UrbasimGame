/** Générateur pseudo-aléatoire à état explicite (mulberry32) : l'état de partie reste sérialisable et rejouable. */
export function nextRandom(state: number): [number, number] {
  let t = (state + 0x6d2b79f5) >>> 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** Tirage gaussien centré réduit (Box-Muller). */
export function nextGaussian(state: number): [number, number] {
  const [u1, s1] = nextRandom(state);
  const [u2, s2] = nextRandom(s1);
  return [Math.sqrt(-2 * Math.log(Math.max(u1, 1e-12))) * Math.cos(2 * Math.PI * u2), s2];
}
