import { DEFAULT_CRITERIA, computeBilan, computeProject, type Bilan, type Criteria, type Parcel, type Project } from '../engine';
import { applyAction, currentMarket, currentParams } from './game';
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
}

export const BOT_PROFILES: Record<BotProfileName, BotProfile> = {
  prudent: { minMargin: 0.05, maxLevels: 5, reserve: 0.25, maxBuys: 1 },
  equilibre: { minMargin: 0.04, maxLevels: 5, reserve: 0.1, maxBuys: 1 },
  agressif: { minMargin: 0.02, maxLevels: 7, reserve: 0, maxBuys: 2 },
};

export interface Plan {
  criteria: Criteria;
  bilan: Bilan;
}

// Les projets ne dépendent que de la géométrie et du gabarit : on les mémorise par terrain.
const projectCache = new WeakMap<Parcel, Map<string, Project>>();

function projectFor(parcel: Parcel, levels: number, attic: boolean): { criteria: Criteria; project: Project } {
  const criteria: Criteria = { ...DEFAULT_CRITERIA, levels, attic };
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
  for (let levels = 0; levels <= profile.maxLevels; levels++) {
    for (const attic of levels >= 2 ? [false, true] : [false]) {
      const { criteria, project } = projectFor(plot.parcel, levels, attic);
      if (project.footprint === null || project.checks.some((c) => c.status === 'error')) continue;
      const bilan = computeBilan({ project, market: currentMarket(state), landPrice, existingSdp: plot.existingSdp, params: currentParams(state) });
      if (bilan.marginRate < profile.minMargin) continue;
      if (!best || bilan.margin > best.bilan.margin) best = { criteria, bilan };
    }
  }
  return best;
}

/** Fonds propres à réunir pour mener le chantier, une fois le terrain refinancé. */
function buildEquity(state: GameState, bilan: Bilan): number {
  const c = bilan.costs;
  return (c.demolition + c.works + c.design + c.insurance + c.contingency + c.taxes) * (1 - state.config.bilanParams.loanShare);
}

function tryLaunch(state: GameState, player: Player, profile: BotProfile): GameState {
  let s = state;
  for (const plot of s.plots.filter((p) => p.owner === player.id && !p.projectId)) {
    const landPrice = plot.paid / (1 + s.config.bilanParams.acquisitionFeeRate);
    const plan = bestPlan(s, plot, landPrice, profile);
    if (!plan) continue;
    const r = applyAction(s, { type: 'launch', player: player.id, plot: plot.id, criteria: plan.criteria });
    if (r.ok) s = r.state;
  }
  return s;
}

/** Joue le trimestre d'un joueur ordinateur, puis le déclare prêt (ce qui peut résoudre le trimestre). */
export function playBotTurn(state: GameState, playerId: string): GameState {
  let s = state;
  const profile = BOT_PROFILES[s.players.find((p) => p.id === playerId)?.profile ?? 'equilibre'];
  const me = () => s.players.find((p) => p.id === playerId)!;
  if (me().ready || s.over) return s;

  s = tryLaunch(s, me(), profile);

  for (let buys = 0; buys < profile.maxBuys; buys++) {
    const { bilanParams: bp } = s.config;
    const cash = me().cash;
    let pick: { plot: Plot; plan: Plan } | null = null;
    for (const plot of s.plots) {
      if (plot.owner !== null) continue;
      const total = plot.askingPrice * (1 + bp.acquisitionFeeRate);
      if (total > cash) continue;
      const plan = bestPlan(s, plot, plot.askingPrice, profile);
      if (!plan) continue;
      // Il doit rester assez pour réunir les fonds propres du chantier et la réserve.
      const left = cash - total + total * bp.loanShare - buildEquity(s, plan.bilan);
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
