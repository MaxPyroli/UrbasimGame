import { eur, mapPlayer, mapPlot, withEvent } from './ledger';
import type { MarketResult } from './market';
import { combineRules } from './plu';
import { nextRandom } from './rng';
import type { GameState, Plot, Programme, ProgrammeKind, Quality, Tender, TenderBid, TenderSpec, TenderTerms } from './types';

/**
 * Appels d'offres de la commune. La commune vend ses terrains au meilleur projet, pas au meilleur prix : un cahier des
 * charges (logements sociaux, commerces en rez-de-chaussée, hauteur, qualité, délai) et une pondération annoncée des critères.
 * Chaque proposition est notée de la même façon, on peut donc calculer son propre score avant de la déposer ; les
 * propositions des autres restent sous pli fermé. Le lauréat s'engage : s'il ne lance pas, la commune reprend le terrain.
 */

/** Plafond de la part de logements sociaux qui rapporte des points. */
export const MAX_SOCIAL_SHARE = 0.5;
/** Un prix de 1,5 fois le prix minimal obtient la note maximale sur le critère prix. */
export const PRICE_CEILING = 1.5;
/** Trimestres laissés au lauréat pour lancer son opération. */
export const LAUNCH_GRACE = 3;
/** Part du prix que la commune garde quand le lauréat ne lance pas à temps. */
export const FORFEIT_RATE = 0.1;
export const MIN_TENDER_PRICE = 50_000;

/** Les trois cadres d'opération que la commune propose : chacun échange des contraintes contre des avantages. */
export const PROGRAMMES: Record<ProgrammeKind, Programme> = {
  zac: {
    kind: 'zac',
    label: 'ZAC',
    summary: 'Zone d’aménagement concerté : la commune a aménagé et équipé le terrain. Prix de cession réduit, pas de taxe d’aménagement, un étage de plus que le PLU.',
    landDiscount: 0.6,
    taxPerSdp: 0,
    permitMonths: 6,
    bonusLevels: 1,
    salesPremium: 0,
  },
  pup: {
    kind: 'pup',
    label: 'PUP',
    summary: 'Projet urbain partenarial : vous financez les équipements publics du quartier (participation réduite à la place de la taxe d’aménagement) et le permis est instruit en priorité (3 mois).',
    landDiscount: 0.9,
    taxPerSdp: 60,
    permitMonths: 3,
    bonusLevels: 0,
    salesPremium: 0,
  },
  npnru: {
    kind: 'npnru',
    label: 'Quartier prioritaire',
    summary: 'Quartier prioritaire : TVA à 5,5 % pour les acquéreurs, donc des logements qui se vendent plus cher, et un terrain cédé à prix réduit.',
    landDiscount: 0.75,
    taxPerSdp: 100,
    permitMonths: 6,
    bonusLevels: 0,
    salesPremium: 0.05,
  },
};
const PROGRAMME_KINDS: ProgrammeKind[] = ['zac', 'pup', 'npnru'];

/** Paramètres de bilan modifiés par le cadre de l'opération (taxe d'aménagement, délai d'instruction). */
export function programmeParams<T extends { taxPerSdp: number; permitMonths: number }>(params: T, programme?: Programme): T {
  return programme ? { ...params, taxPerSdp: programme.taxPerSdp, permitMonths: programme.permitMonths } : params;
}

const WEIGHT_PRESETS: { label: string; weights: TenderSpec['weights'] }[] = [
  { label: 'prix', weights: { price: 0.5, social: 0.2, quality: 0.15, delay: 0.15 } },
  { label: 'mixité sociale', weights: { price: 0.3, social: 0.4, quality: 0.15, delay: 0.15 } },
  { label: 'qualité', weights: { price: 0.3, social: 0.2, quality: 0.35, delay: 0.15 } },
  { label: 'rapidité', weights: { price: 0.35, social: 0.2, quality: 0.1, delay: 0.35 } },
];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export interface BidScore {
  total: number;
  price: number;
  social: number;
  quality: number;
  delay: number;
}

/** Note d'une proposition (0 à 1) : chaque critère est noté seul, puis pondéré selon l'annonce. */
export function scoreBid(spec: TenderSpec, b: Pick<TenderBid, 'price' | 'socialShare' | 'quality' | 'delivery'>): BidScore {
  const price = clamp01((b.price - spec.minPrice) / (spec.minPrice * (PRICE_CEILING - 1)));
  const social = clamp01((b.socialShare - spec.minSocialShare) / Math.max(1e-9, MAX_SOCIAL_SHARE - spec.minSocialShare));
  const quality = b.quality / 2;
  const delay = spec.maxDelivery > spec.minDelivery ? clamp01((spec.maxDelivery - b.delivery) / (spec.maxDelivery - spec.minDelivery)) : 1;
  const w = spec.weights;
  return { total: w.price * price + w.social * social + w.quality * quality + w.delay * delay, price, social, quality, delay };
}

export const tenderBidOf = (t: Tender, playerId: string) => t.bids.find((b) => b.player === playerId);
export const openTenders = (s: GameState) => s.tenders.filter((t) => t.status === 'open');
export const tenderOfPlot = (s: GameState, plotId: string) => openTenders(s).find((t) => t.plotId === plotId);
/** Sommes bloquées par les propositions en cours d'un joueur. */
export const committedTenderCash = (s: GameState, playerId: string) => openTenders(s).reduce((t, x) => t + (tenderBidOf(x, playerId)?.reserved ?? 0), 0);

/** Conformité d'une proposition au cahier des charges ; retourne le motif du refus, ou null. */
export function bidProblem(spec: TenderSpec, b: Pick<TenderBid, 'price' | 'socialShare' | 'quality' | 'delivery'>): string | null {
  if (!Number.isFinite(b.price) || b.price <= 0) return 'prix invalide';
  if (b.price < spec.minPrice) return `prix inférieur au prix de cession minimal (${eur(spec.minPrice)})`;
  if (!(b.socialShare >= spec.minSocialShare - 1e-9) || b.socialShare > MAX_SOCIAL_SHARE + 1e-9) return `la part de logements sociaux doit être comprise entre ${Math.round(spec.minSocialShare * 100)} % et ${Math.round(MAX_SOCIAL_SHARE * 100)} %`;
  if (![0, 1, 2].includes(b.quality) || b.quality < spec.minQuality) return 'niveau de qualité inférieur au cahier des charges';
  if (!Number.isInteger(b.delivery) || b.delivery < spec.minDelivery || b.delivery > spec.maxDelivery) return `le délai de livraison doit être de ${spec.minDelivery} à ${spec.maxDelivery} trimestres`;
  return null;
}

export function placeTenderBid(
  s: GameState,
  playerId: string,
  tenderId: string,
  input: { price: number; socialShare: number; quality: Quality; delivery: number },
): MarketResult {
  const fail = (error: string): MarketResult => ({ ok: false, error });
  const player = s.players.find((p) => p.id === playerId)!;
  const tender = s.tenders.find((t) => t.id === tenderId);
  if (!tender || tender.status !== 'open' || s.round >= tender.closesAt) return fail('cet appel d’offres n’est pas ouvert');
  if (player.bankrupt) return fail('vous êtes en faillite');
  if (player.debt > 0) return fail('la banque refuse tout engagement tant que votre découvert n’est pas remboursé');
  const price = Math.round(input.price);
  const problem = bidProblem(tender.spec, { ...input, price });
  if (problem) return fail(problem);
  const reserved = Math.round(price * (1 + s.config.bilanParams.acquisitionFeeRate));
  const existing = tenderBidOf(tender, playerId);
  const delta = reserved - (existing?.reserved ?? 0);
  if (player.cash < delta) return fail(`fonds insuffisants : il faut bloquer ${eur(delta)} de plus (prix et frais de notaire)`);
  const bid: TenderBid = { player: playerId, price, socialShare: input.socialShare, quality: input.quality, delivery: input.delivery, reserved, round: existing?.round ?? s.round };
  const next = mapPlayer(s, playerId, (p) => ({ ...p, cash: p.cash - delta }));
  return { ok: true, state: { ...next, tenders: next.tenders.map((t) => (t.id === tenderId ? { ...t, bids: existing ? t.bids.map((b) => (b === existing ? bid : b)) : [...t.bids, bid] } : t)) } };
}

export function withdrawTenderBid(s: GameState, playerId: string, tenderId: string): MarketResult {
  const tender = s.tenders.find((t) => t.id === tenderId);
  const existing = tender && tender.status === 'open' ? tenderBidOf(tender, playerId) : undefined;
  if (!tender || !existing) return { ok: false, error: 'vous n’avez pas de proposition sur cet appel d’offres' };
  const next = mapPlayer(s, playerId, (p) => ({ ...p, cash: p.cash + existing.reserved }));
  return { ok: true, state: { ...next, tenders: next.tenders.map((t) => (t.id === tenderId ? { ...t, bids: t.bids.filter((b) => b !== existing) } : t)) } };
}

/** Retire toutes les propositions d'un joueur (faillite) et rend les sommes bloquées. */
export function dropTenderBids(s: GameState, playerId: string): GameState {
  const total = committedTenderCash(s, playerId);
  const next = mapPlayer(s, playerId, (p) => ({ ...p, cash: p.cash + total }));
  return { ...next, tenders: next.tenders.map((t) => (t.status === 'open' ? { ...t, bids: t.bids.filter((b) => b.player !== playerId) } : t)) };
}

const hashFrac = (id: string) => {
  let h = 0;
  for (const ch of id) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  return (h % 10007) / 10006;
};

/** Terrains que la commune garde pour ses appels d'offres : constructibles, de bonne taille, choisis de façon reproductible. */
export function pickMunicipalIds(plots: Pick<Plot, 'id' | 'area' | 'issue'>[], count: number): string[] {
  return plots
    .filter((p) => !p.issue && p.area >= 450 && p.area <= 2500)
    .map((p) => ({ id: p.id, k: hashFrac(`${p.id}#commune`) }))
    .sort((a, b) => a.k - b.k)
    .slice(0, count)
    .map((p) => p.id);
}

function draw(s: GameState, n: number): [number, GameState] {
  const [u, rng] = nextRandom(s.rng);
  return [Math.floor(u * n), { ...s, rng }];
}

/** Ouvre un appel d'offres sur un terrain communal libre, avec un cahier des charges tiré au hasard (dans l'état : rejouable). */
export function openTender(state: GameState, worth: (s: GameState, plot: Plot, spec: TenderSpec) => number): GameState {
  let s = state;
  const busy = new Set(openTenders(s).map((t) => t.plotId));
  const pool = s.plots.filter((p) => p.municipal && p.owner === null && !busy.has(p.id));
  if (!pool.length) return s;
  let i: number;
  [i, s] = draw(s, pool.length);
  const plot = pool[i];
  const rule = plot.zones.length ? combineRules(plot.zones) : null;
  let preset: number;
  let social: number;
  let lv: number;
  let commerce: number;
  let quality: number;
  let late: number;
  let kind: number;
  [preset, s] = draw(s, WEIGHT_PRESETS.length);
  [social, s] = draw(s, 4);
  [lv, s] = draw(s, 4);
  [commerce, s] = draw(s, 2);
  [quality, s] = draw(s, 10);
  [late, s] = draw(s, 3);
  [kind, s] = draw(s, PROGRAMME_KINDS.length);
  const programme = PROGRAMMES[PROGRAMME_KINDS[kind]];
  const cap = rule ? rule.maxLevels : 6;
  const spec: TenderSpec = {
    minSocialShare: [0.2, 0.25, 0.3, 0.35][social],
    groundCommerce: commerce === 1,
    maxLevels: Math.max(1, Math.min(cap, 3 + lv) + programme.bonusLevels),
    programme,
    minQuality: quality >= 7 ? 1 : 0,
    minDelivery: 5,
    maxDelivery: 7 + late,
    minPrice: 0,
    weights: WEIGHT_PRESETS[preset].weights,
  };
  // Prix de cession : une décote sur ce que le projet imposé par le cahier des charges peut payer.
  spec.minPrice = Math.max(MIN_TENDER_PRICE, Math.round((worth(s, plot, spec) * programme.landDiscount) / 1000) * 1000);
  const id = `AO${s.nextTenderId}`;
  const tender: Tender = { id, plotId: plot.id, opensAt: s.round, closesAt: s.round + s.config.tenderRounds, spec, bids: [], status: 'open' };
  s = { ...s, tenders: [...s.tenders, tender], nextTenderId: s.nextTenderId + 1 };
  return withEvent(s, { kind: 'commune', tone: 'info', code: 'ao-ouvert', ref: { tender: id, plot: plot.id }, text: `La commune lance l’appel d’offres ${id} sur ${plot.label ? plot.label.replace(' · Montreuil', '') : plot.id} : ${programme.label} ; ${Math.round(spec.minSocialShare * 100)} % de logements sociaux au moins, R+${spec.maxLevels} maximum, réponse avant le trimestre ${tender.closesAt + 1}` });
}

/** Clôt les appels d'offres échus : la meilleure note l'emporte, les autres sont remboursés. */
export function resolveTenders(state: GameState): GameState {
  let s = state;
  for (const t of state.tenders) {
    if (t.status !== 'open' || s.round < t.closesAt) continue;
    const plot = s.plots.find((p) => p.id === t.plotId)!;
    const label = plot.label ? plot.label.replace(' · Montreuil', '') : plot.id;
    const bids = s.tenders.find((x) => x.id === t.id)!.bids;
    const ranked = bids
      .map((b) => ({ b, score: scoreBid(t.spec, b) }))
      .sort((x, y) => y.score.total - x.score.total || y.b.price - x.b.price || x.b.round - y.b.round || bids.indexOf(x.b) - bids.indexOf(y.b));
    const refund = (b: TenderBid) => (s = mapPlayer(s, b.player, (p) => ({ ...p, cash: p.cash + b.reserved })));
    if (!ranked.length) {
      s = { ...s, tenders: s.tenders.map((x) => (x.id === t.id ? { ...x, status: 'void' as const } : x)) };
      s = withEvent(s, { kind: 'commune', tone: 'info', ref: { tender: t.id, plot: plot.id }, text: `Appel d’offres ${t.id} infructueux : aucune proposition pour ${label}` });
      continue;
    }
    const win = ranked[0];
    const winner = s.players.find((p) => p.id === win.b.player)!;
    const terms: TenderTerms = {
      tenderId: t.id,
      programme: t.spec.programme,
      socialShare: win.b.socialShare,
      quality: win.b.quality,
      delivery: win.b.delivery,
      maxLevels: t.spec.maxLevels,
      groundCommerce: t.spec.groundCommerce,
      launchBy: s.round + LAUNCH_GRACE,
      price: win.b.price,
    };
    s = mapPlot(s, plot.id, (p) => ({ ...p, owner: win.b.player, paid: win.b.reserved, municipal: false, obligation: terms }));
    s = { ...s, landHeat: s.landHeat * (1 + s.config.landHeatStep), tenders: s.tenders.map((x) => (x.id === t.id ? { ...x, status: 'awarded' as const, winner: win.b.player } : x)) };
    s = withEvent(s, {
      player: win.b.player,
      kind: 'commune',
      tone: 'good',
      popup: true,
      code: 'ao-gagne',
      ref: { tender: t.id, plot: plot.id },
      text: `${winner.name} remporte l’appel d’offres ${t.id} (${label}) : note ${win.score.total.toFixed(2).replace('.', ',')}, ${eur(win.b.price)}, ${Math.round(win.b.socialShare * 100)} % de logements sociaux${win.b.quality ? `, qualité ${win.b.quality === 2 ? 'bas carbone' : 'performante'}` : ''}, livraison en ${win.b.delivery} trimestres${ranked.length > 1 ? ` (${ranked.length} propositions, la 2e notée ${ranked[1].score.total.toFixed(2).replace('.', ',')})` : ''}`,
    });
    for (const r of ranked.slice(1)) {
      refund(r.b);
      if (!s.players.find((p) => p.id === r.b.player)?.bot) s = withEvent(s, { player: r.b.player, kind: 'commune', tone: 'bad', popup: true, code: 'ao-perdu', ref: { tender: t.id, plot: plot.id }, text: `Vous perdez l’appel d’offres ${t.id} : votre note ${r.score.total.toFixed(2).replace('.', ',')} contre ${win.score.total.toFixed(2).replace('.', ',')}` });
    }
  }
  return s;
}

/** Le lauréat qui n'a pas lancé à temps perd le terrain : la commune le reprend et garde une pénalité. */
export function enforceObligations(state: GameState): GameState {
  let s = state;
  for (const plot of state.plots) {
    const ob = plot.obligation;
    if (!ob || plot.projectId || plot.owner === null || s.round < ob.launchBy) continue;
    const owner = s.players.find((p) => p.id === plot.owner);
    if (!owner) continue;
    const penalty = Math.round(ob.price * FORFEIT_RATE);
    const back = Math.max(0, Math.round(ob.price) - penalty);
    s = mapPlayer(s, owner.id, (p) => ({ ...p, cash: p.cash + back }));
    s = mapPlot(s, plot.id, (p) => ({ ...p, owner: null, paid: 0, municipal: true, obligation: undefined }));
    s = withEvent(s, { player: owner.id, kind: 'commune', tone: 'bad', popup: true, code: 'ao-reprise', ref: { plot: plot.id }, text: `${owner.name} n’a pas lancé son opération à temps : la commune reprend le terrain et garde ${eur(penalty)} de pénalité` });
  }
  return s;
}

/** Faut-il ouvrir un nouvel appel d'offres ce trimestre ? (un tous les `tenderEvery` trimestres, deux au plus en même temps) */
export const shouldOpenTender = (s: GameState) => s.config.communeTenders && openTenders(s).length < 2 && s.round % s.config.tenderEvery === 0;
