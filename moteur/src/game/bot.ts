import { DEFAULT_CRITERIA, computeBilan, computeProject, type Bilan, type Criteria, type Parcel, type Project } from '../engine';
import { MAX_PRICE_POLICY, MIN_PRICE_POLICY, applyAction, criteriaFor, currentMarket, currentParams } from './game';
import { buildDuration } from '../engine';
import { minOfferPrice, offerOf } from './market';
import { MAX_SOCIAL_SHARE, openTenders, programmeParams, scoreBid, tenderBidOf } from './tender';
import { lotsLeft, marketDemand, sellingPace, unitsOnOffer } from './sales';
import type { BotProfileName, GameState, Plot, Player } from './types';

export interface BotProfile {
  /** Marge minimale (en % du chiffre d'affaires) pour acheter ou lancer. */
  minMargin: number;
  /** R+x maximal étudié. */
  maxLevels: number;
  /** Part de la trésorerie qu'on garde de côté après un achat. */
  reserve: number;
  /** Nombre maximal de terrains achetés par trimestre. */
  maxBuys: number;
  /** Le promoteur n'ajoute pas de logements tant que le stock à vendre dépasse ce nombre de trimestres de demande. */
  supplyHorizon: number;
  /** Enchères : offres simultanées au plus, part de la marge de manœuvre mise dans le prix offert, prospections par trimestre. */
  maxOffers: number;
  bidShare: number;
  prospects: number;
  /** Appels d'offres de la commune : propositions simultanées au plus, et part de la marge qu'on accepte de céder pour mieux noter. */
  maxTenderBids: number;
  tenderGenerosity: number;
}

export const BOT_PROFILES: Record<BotProfileName, BotProfile> = {
  prudent: { minMargin: 0.05, maxLevels: 5, reserve: 0.25, maxBuys: 1, supplyHorizon: 5, maxOffers: 2, bidShare: 0.3, prospects: 0, maxTenderBids: 1, tenderGenerosity: 0.5 },
  equilibre: { minMargin: 0.04, maxLevels: 5, reserve: 0.1, maxBuys: 1, supplyHorizon: 7, maxOffers: 3, bidShare: 0.5, prospects: 1, maxTenderBids: 2, tenderGenerosity: 0.3 },
  agressif: { minMargin: 0.02, maxLevels: 7, reserve: 0, maxBuys: 2, supplyHorizon: 12, maxOffers: 5, bidShare: 0.8, prospects: 2, maxTenderBids: 2, tenderGenerosity: 0.1 },
};

export interface Plan {
  criteria: Criteria;
  bilan: Bilan;
  /** Nombre approximatif de lots à vendre. */
  lots: number;
  /** Prix de terrain maximal qui laisse la marge minimale du profil. */
  maxLand: number;
}

// Les projets ne dépendent que de la géométrie et du gabarit : on les mémorise par terrain.
const projectCache = new WeakMap<Parcel, Map<string, Project>>();

function projectFor(plot: Plot, levels: number, attic: boolean): { criteria: Criteria; project: Project } {
  const parcel: Parcel = plot.parcel;
  const ob = plot.obligation;
  const criteria: Criteria = criteriaFor(plot, { ...DEFAULT_CRITERIA, levels, attic, ...(ob?.groundCommerce ? { groundFloorUse: 'commerce' as const } : {}) }, ob?.programme.bonusLevels ?? 0);
  let byKey = projectCache.get(parcel);
  if (!byKey) projectCache.set(parcel, (byKey = new Map()));
  const key = `${levels}/${attic}`;
  let project = byKey.get(key);
  if (!project) byKey.set(key, (project = computeProject(parcel, criteria)));
  return { criteria, project };
}

/** Meilleur projet (marge absolue maximale) respectant le seuil de marge, pour un terrain acheté à `landPrice`. */
export function bestPlan(state: GameState, plot: Plot, landPrice: number, profile: BotProfile): Plan | null {
  let best: Plan | null = null;
  if (plot.issue) return null;
  const cap = plot.obligation ? plot.obligation.maxLevels : Infinity;
  for (let levels = 0; levels <= Math.min(profile.maxLevels, cap); levels++) {
    for (const attic of levels >= 2 && levels + 1 <= cap ? [false, true] : [false]) {
      const { criteria, project } = projectFor(plot, levels, attic);
      if (project.footprint === null || project.checks.some((c) => c.status === 'error')) continue;
      const bilan = computeBilan({ project, market: currentMarket(state, plot), landPrice, existingSdp: plot.existingSdp, params: { ...programmeParams(currentParams(state), plot.obligation?.programme), targetMargin: profile.minMargin }, ...(plot.obligation ? { socialShare: plot.obligation.socialShare, quality: plot.obligation.quality, salesPremium: plot.obligation.programme.salesPremium } : {}) });
      if (bilan.marginRate < profile.minMargin) continue;
      if (!best || bilan.margin > best.bilan.margin) best = { criteria, bilan, lots: Math.max(1, project.indicators.dwellings), maxLand: bilan.maxLandPrice };
    }
  }
  return best;
}

/** Fonds propres à réunir au lancement pour mener le chantier (la banque finance le reste une fois les préventes atteintes). */
function buildEquity(state: GameState, bilan: Bilan): number {
  const c = bilan.costs;
  return (c.demolition + c.works + c.fixed + c.design + c.insurance + c.contingency + c.taxes) * (1 - state.config.bilanParams.loanShare);
}

/** Le marché est saturé : trop de logements déjà en vente par rapport à la demande du quartier. */
function saturated(s: GameState, extraLots: number, profile: BotProfile): boolean {
  return unitsOnOffer(s) + extraLots > marketDemand(s) * profile.supplyHorizon;
}

/** Ajuste les prix de vente : remise quand les ventes traînent derrière le rythme prévu, remontée quand elles vont vite. */
function adjustPrices(state: GameState, playerId: string): GameState {
  let s = state;
  for (const p of s.projects.filter((x) => x.owner === playerId && lotsLeft(x) > 0)) {
    const pace = sellingPace(p);
    let policy = p.pricePolicy;
    if (pace < 0.8) policy -= 0.02;
    else if (pace > 1.2) policy += 0.01;
    policy = Math.min(MAX_PRICE_POLICY, Math.max(MIN_PRICE_POLICY, policy));
    if (policy !== p.pricePolicy) {
      const r = applyAction(s, { type: 'setPrice', player: playerId, project: p.id, policy });
      if (r.ok) s = r.state;
    }
  }
  return s;
}

function tryLaunch(state: GameState, player: Player, profile: BotProfile): GameState {
  let s = state;
  for (const plot of s.plots.filter((p) => p.owner === player.id && !p.projectId)) {
    const landPrice = plot.paid / (1 + s.config.bilanParams.acquisitionFeeRate);
    // Un terrain obtenu auprès de la commune se perd (10 % du prix) s'il n'est pas lancé à temps : à l'approche de
    // l'échéance, le bot accepte une marge nulle et ne s'arrête plus à la saturation du marché.
    const left = plot.obligation ? plot.obligation.launchBy - s.round : Infinity;
    const urgent = left <= 1;
    const plan = bestPlan(s, plot, landPrice, urgent ? { ...profile, minMargin: Math.min(profile.minMargin, 0) } : profile);
    if (!plan || (!urgent && saturated(s, plan.lots, profile))) continue;
    const r = applyAction(s, { type: 'launch', player: player.id, plot: plot.id, criteria: plan.criteria });
    if (r.ok) s = r.state;
  }
  return s;
}

const hashFrac = (id: string) => {
  let h = 0;
  for (const ch of id) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  return (h % 1000) / 999;
};

/**
 * Enchères : le bot repère les terrains mis en vente qui lui laissent sa marge, et offre entre le prix de départ et le
 * prix maximal qu'il peut payer (d'autant plus près du maximum qu'il est agressif). Il tente aussi quelques prospections.
 */
function bid(state: GameState, playerId: string, profile: BotProfile): GameState {
  let s = state;
  const me = () => s.players.find((p) => p.id === playerId)!;
  const mine = () => s.offers.filter((o) => o.player === playerId).length;
  const rate = s.config.bilanParams.acquisitionFeeRate;
  type Cand = { plot: Plot; plan: Plan; price: number; score: number };
  const cands: Cand[] = [];
  for (const plot of s.plots) {
    if (plot.owner !== null || plot.municipal || offerOf(s, plot.id, playerId)) continue;
    const listed = !!plot.listing;
    const floor = minOfferPrice(plot);
    const plan = bestPlan(s, plot, listed ? floor : plot.askingPrice, profile);
    if (!plan || saturated(s, plan.lots, profile)) continue;
    const room = plan.maxLand - floor;
    if (room <= 0) continue;
    const noise = 0.8 + 0.4 * hashFrac(`${plot.id}:${playerId}`);
    // Mise en vente : entre le prix de départ et le maximum ; prospection : un peu au-dessus du prix affiché.
    const price = listed ? Math.round(floor + room * Math.min(1, profile.bidShare * noise)) : Math.round(Math.min(plan.maxLand, plot.askingPrice * (1.04 + 0.12 * profile.bidShare * noise)));
    if (!listed && price < plot.askingPrice) continue;
    cands.push({ plot, plan, price, score: plan.bilan.margin * (listed ? 1 : 0.6) });
  }
  cands.sort((a, b) => b.score - a.score);
  let prospects = 0;
  for (const c of cands) {
    if (mine() >= profile.maxOffers) break;
    const listed = !!c.plot.listing;
    if (!listed && prospects >= profile.prospects) continue;
    const reserved = c.price * (1 + rate);
    // Il doit rester de quoi réunir les fonds propres du chantier.
    if (me().cash - reserved < buildEquity(s, c.plan.bilan) + me().cash * profile.reserve) continue;
    const r = applyAction(s, { type: 'offer', player: playerId, plot: c.plot.id, price: c.price });
    if (r.ok) {
      s = r.state;
      if (!listed) prospects++;
    }
  }
  return s;
}

/**
 * Appels d'offres de la commune : le bot cherche la proposition la mieux notée qui lui laisse sa marge (part sociale,
 * qualité, délai réaliste), au prix maximal qu'il peut payer ; les prudents cèdent davantage de marge pour mieux noter.
 */
function tenderTurn(state: GameState, playerId: string, profile: BotProfile): GameState {
  let s = state;
  const me = () => s.players.find((p) => p.id === playerId)!;
  const mineCount = () => openTenders(s).filter((t) => tenderBidOf(t, playerId)).length;
  const rate = s.config.bilanParams.acquisitionFeeRate;
  for (const t of openTenders(s)) {
    if (mineCount() >= profile.maxTenderBids) break;
    if (tenderBidOf(t, playerId) || s.round >= t.closesAt) continue;
    const plot = s.plots.find((p) => p.id === t.plotId)!;
    const spec = t.spec;
    let best: { price: number; share: number; quality: 0 | 1 | 2; delivery: number; score: number; equity: number } | null = null;
    for (let levels = 0; levels <= Math.min(profile.maxLevels, spec.maxLevels); levels++) {
      for (const attic of levels >= 2 && levels < spec.maxLevels ? [false, true] : [false]) {
        const base = { ...DEFAULT_CRITERIA, levels, attic, groundFloorUse: spec.groundCommerce ? ('commerce' as const) : DEFAULT_CRITERIA.groundFloorUse };
        const criteria = criteriaFor(plot, base, spec.programme.bonusLevels);
        const project = computeProject(plot.parcel, criteria);
        if (project.footprint === null || project.checks.some((c) => c.status === 'error')) continue;
        const d = buildDuration(project, programmeParams(s.config.bilanParams, spec.programme));
        const planned = Math.ceil(d.permit / 3) + Math.ceil(d.build / 3);
        const delivery = Math.max(spec.minDelivery, planned + 1);
        if (delivery > spec.maxDelivery) continue;
        for (const extra of [0, 0.1, 0.2]) {
          const share = Math.min(MAX_SOCIAL_SHARE, spec.minSocialShare + extra * (1 + profile.tenderGenerosity));
          for (const quality of [spec.minQuality, Math.min(2, spec.minQuality + 1)] as (0 | 1 | 2)[]) {
            const bilan = computeBilan({ project, market: currentMarket(s, plot), landPrice: 0, existingSdp: plot.existingSdp, params: { ...programmeParams(currentParams(s), spec.programme), targetMargin: profile.minMargin }, socialShare: share, quality, salesPremium: spec.programme.salesPremium });
            const maxLand = bilan.maxLandPrice;
            if (maxLand < spec.minPrice) continue;
            const price = Math.round(Math.min(maxLand, spec.minPrice * 1.5) * (0.92 + 0.08 * profile.bidShare));
            if (price < spec.minPrice) continue;
            const score = scoreBid(spec, { price, socialShare: share, quality, delivery }).total;
            const c = bilan.costs;
            const equity = (c.demolition + c.works + c.fixed + c.design + c.insurance + c.contingency + c.taxes) * (1 - s.config.bilanParams.loanShare);
            if (!best || score > best.score) best = { price, share, quality, delivery, score, equity };
          }
        }
      }
    }
    if (!best) continue;
    if (me().cash - best.price * (1 + rate) < best.equity + me().cash * profile.reserve) continue;
    const r = applyAction(s, { type: 'tenderBid', player: playerId, tender: t.id, price: best.price, socialShare: best.share, quality: best.quality, delivery: best.delivery });
    if (r.ok) s = r.state;
  }
  return s;
}

/** Joue le trimestre d'un joueur ordinateur, puis le déclare prêt (ce qui peut résoudre le trimestre). */
export function playBotTurn(state: GameState, playerId: string): GameState {
  let s = state;
  const profile = BOT_PROFILES[s.players.find((p) => p.id === playerId)?.profile ?? 'equilibre'];
  const me = () => s.players.find((p) => p.id === playerId)!;
  if (me().ready || s.over || me().bankrupt) return s;

  s = adjustPrices(s, playerId);
  s = tryLaunch(s, me(), profile);

  if (s.config.communeTenders) s = tenderTurn(s, playerId, profile);
  if (s.config.landMarket === 'auction') s = bid(s, playerId, profile);
  else for (let buys = 0; buys < profile.maxBuys; buys++) {
    const { bilanParams: bp } = s.config;
    const cash = me().cash;
    let pick: { plot: Plot; plan: Plan } | null = null;
    for (const plot of s.plots) {
      if (plot.owner !== null || plot.municipal) continue;
      const total = plot.askingPrice * (1 + bp.acquisitionFeeRate);
      if (total > cash) continue;
      const plan = bestPlan(s, plot, plot.askingPrice, profile);
      if (!plan || saturated(s, plan.lots, profile)) continue;
      // Il doit rester assez pour réunir les fonds propres du chantier et la réserve.
      const left = cash - total - buildEquity(s, plan.bilan);
      if (left < cash * profile.reserve) continue;
      if (!pick || plan.bilan.margin > pick.plan.bilan.margin) pick = { plot, plan };
    }
    if (!pick) break;
    const r = applyAction(s, { type: 'buy', player: playerId, plot: pick.plot.id });
    if (!r.ok) break;
    s = tryLaunch(r.state, me(), profile);
  }

  const done = applyAction(s, { type: 'ready', player: playerId });
  return done.ok ? done.state : s;
}

/** Fait jouer tous les joueurs ordinateur qui ne sont pas encore prêts. */
export function playBots(state: GameState): GameState {
  let s = state;
  for (const p of state.players) if (p.bot && !s.over) s = playBotTurn(s, p.id);
  return s;
}

/** Simule une partie où tous les joueurs sont des ordinateurs (équilibrage, tests). */
export function simulateAllBots(state: GameState): GameState {
  let s = state;
  let guard = 0;
  while (!s.over && guard++ < s.config.rounds + 5) {
    const before = s.round;
    s = playBots(s);
    if (s.round === before) break; // un humain n'a pas fini : on s'arrête là
  }
  return s;
}
