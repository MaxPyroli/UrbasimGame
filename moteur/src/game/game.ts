import {
  DEFAULT_BILAN_PARAMS,
  DEFAULT_CRITERIA,
  MARKETS,
  buildDuration,
  computeBilan,
  computeProject,
  suggestLandPrice,
  type Market,
  type Parcel,
} from '../engine';
import { nextGaussian } from './rng';
import type { Action, ActionResult, GameConfig, GameEvent, GameState, Plot, Player, ProjectPhase, ProjectRun } from './types';

export const DEFAULT_CONFIG: GameConfig = {
  market: MARKETS['petite-couronne'],
  bilanParams: DEFAULT_BILAN_PARAMS,
  startCash: 2_000_000,
  rounds: 40,
  plotSpread: 0.1,
  marketVolatility: 0.03,
  marketReversion: 0.1,
};

export interface PlotSeed {
  id: string;
  parcel: Parcel;
  existingSdp?: number;
  askingPrice?: number;
}

export interface PlayerSeed {
  id: string;
  name: string;
  bot?: boolean;
}

export interface NewGame {
  players: PlayerSeed[];
  plots: PlotSeed[];
  config?: Partial<GameConfig>;
  seed?: number;
}

const MIN_PLOT_PRICE = 20_000;

function defaultAskingPrice(parcel: Parcel, market: Market): number {
  const project = computeProject(parcel, { ...DEFAULT_CRITERIA, levels: 3 });
  return Math.max(MIN_PLOT_PRICE, Math.round(suggestLandPrice(project, market) / 1000) * 1000);
}

export function createGame(g: NewGame): GameState {
  const config: GameConfig = { ...DEFAULT_CONFIG, ...g.config };
  const ids = new Set<string>();
  for (const p of g.players) {
    if (ids.has(p.id)) throw new Error(`joueur en double : ${p.id}`);
    ids.add(p.id);
  }
  const plotIds = new Set<string>();
  const plots: Plot[] = g.plots.map((s) => {
    if (plotIds.has(s.id)) throw new Error(`terrain en double : ${s.id}`);
    plotIds.add(s.id);
    return {
      id: s.id,
      parcel: s.parcel,
      owner: null,
      existingSdp: s.existingSdp ?? 0,
      askingPrice: s.askingPrice ?? defaultAskingPrice(s.parcel, config.market),
      paid: 0,
      projectId: null,
    };
  });
  return {
    config,
    round: 0,
    over: false,
    players: g.players.map((p) => ({ id: p.id, name: p.name, bot: p.bot ?? false, cash: config.startCash, ready: false })),
    plots,
    projects: [],
    marketIndex: 1,
    rng: (g.seed ?? 1) >>> 0,
    nextProjectId: 1,
    log: [],
  };
}

const fail = (error: string): ActionResult => ({ ok: false, error });
const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;

function withEvent(s: GameState, e: Omit<GameEvent, 'round'>): GameState {
  return { ...s, log: [...s.log, { round: s.round, ...e }] };
}

const mapPlayer = (s: GameState, id: string, f: (p: Player) => Player): GameState => ({
  ...s,
  players: s.players.map((p) => (p.id === id ? f(p) : p)),
});
const mapPlot = (s: GameState, id: string, f: (p: Plot) => Plot): GameState => ({
  ...s,
  plots: s.plots.map((p) => (p.id === id ? f(p) : p)),
});

export function projectPhase(p: ProjectRun, round: number): ProjectPhase | 'termine' {
  const e = round - p.launchedAt;
  if (e < p.permitRounds) return 'permis';
  if (e < p.permitRounds + p.buildRounds) return 'chantier';
  if (e < p.permitRounds + p.buildRounds + p.sellRounds) return 'vente';
  return 'termine';
}

/** Application d'une action d'un joueur. Pure : ne modifie pas l'état reçu. */
export function applyAction(state: GameState, action: Action): ActionResult {
  if (state.over) return fail('la partie est terminée');
  const player = state.players.find((p) => p.id === action.player);
  if (!player) return fail('joueur inconnu');

  if (action.type === 'ready') {
    if (player.ready) return fail('déjà prêt');
    let s = mapPlayer(state, player.id, (p) => ({ ...p, ready: true }));
    if (s.players.every((p) => p.ready)) s = advanceRound(s);
    return { ok: true, state: s };
  }
  if (player.ready) return fail('tour terminé : attendez le prochain trimestre');

  const plot = state.plots.find((p) => p.id === action.plot);
  if (!plot) return fail('terrain inconnu');

  if (action.type === 'buy') {
    if (plot.owner !== null) return fail('terrain déjà vendu');
    const fee = plot.askingPrice * state.config.bilanParams.acquisitionFeeRate;
    const total = plot.askingPrice + fee;
    if (player.cash < total) return fail(`fonds insuffisants : il faut ${eur(total)} (frais de notaire compris)`);
    let s = mapPlayer(state, player.id, (p) => ({ ...p, cash: p.cash - total }));
    s = mapPlot(s, plot.id, (p) => ({ ...p, owner: player.id, paid: total }));
    return { ok: true, state: withEvent(s, { player: player.id, text: `${player.name} achète ${plot.id} pour ${eur(plot.askingPrice)}` }) };
  }

  if (plot.owner !== player.id) return fail('ce terrain ne vous appartient pas');
  if (plot.projectId) return fail('une opération est en cours sur ce terrain');

  if (action.type === 'sellPlot') {
    const price = Math.round(plot.askingPrice * (1 - state.config.plotSpread));
    let s = mapPlayer(state, player.id, (p) => ({ ...p, cash: p.cash + price }));
    s = mapPlot(s, plot.id, (p) => ({ ...p, owner: null, paid: 0 }));
    return { ok: true, state: withEvent(s, { player: player.id, text: `${player.name} revend ${plot.id} pour ${eur(price)}` }) };
  }

  // launch
  const project = computeProject(plot.parcel, action.criteria);
  if (project.footprint === null) return fail('rien de constructible avec ces critères');
  const errors = project.checks.filter((c) => c.status === 'error');
  if (errors.length) return fail(`projet non conforme : ${errors.map((c) => c.label).join(', ')}`);

  const { config } = state;
  const ls = config.bilanParams.loanShare;
  const bilan = computeBilan({
    project,
    market: config.market,
    landPrice: plot.paid / (1 + config.bilanParams.acquisitionFeeRate),
    existingSdp: plot.existingSdp,
    params: config.bilanParams,
  });
  const c = bilan.costs;
  const buildSpend = c.demolition + c.works + c.design + c.insurance + c.contingency + c.taxes;
  const landAndFees = c.land + c.acquisitionFees;
  const equityBuild = buildSpend * (1 - ls);
  const refund = landAndFees * ls;
  if (player.cash + refund < equityBuild) {
    return fail(`fonds propres insuffisants : ${eur(equityBuild)} à réserver pour le chantier, ${eur(player.cash + refund)} disponibles après refinancement du terrain`);
  }

  const d = buildDuration(project, config.bilanParams);
  const q = (months: number) => Math.max(1, Math.ceil(months / 3));
  const buildRounds = q(d.build);
  const run: ProjectRun = {
    id: `P${state.nextProjectId}`,
    plotId: plot.id,
    owner: player.id,
    criteria: action.criteria,
    launchedAt: state.round,
    permitRounds: q(d.permit),
    buildRounds,
    sellRounds: q(d.sellOut),
    bilan,
    sdp: project.indicators.sdpTotal,
    marketIndexAtLaunch: state.marketIndex,
    escrow: equityBuild,
    installment: equityBuild / buildRounds,
    loanRepayment: ls * (landAndFees + buildSpend),
    equityInvested: landAndFees * (1 - ls) + equityBuild,
  };
  let s = mapPlayer(state, player.id, (p) => ({ ...p, cash: p.cash + refund - equityBuild }));
  s = mapPlot(s, plot.id, (p) => ({ ...p, projectId: run.id }));
  s = { ...s, projects: [...s.projects, run], nextProjectId: s.nextProjectId + 1 };
  const total = run.permitRounds + run.buildRounds + run.sellRounds;
  return {
    ok: true,
    state: withEvent(s, {
      player: player.id,
      text: `${player.name} lance ${run.id} sur ${plot.id} : ${Math.round(run.sdp)} m² SDP, ${project.indicators.dwellings} logements, ${total} trimestres, marge attendue ${eur(bilan.margin)}`,
    }),
  };
}

/** Résout un trimestre : chantiers, ventes, marché. Appelée quand tous les joueurs sont prêts. */
export function advanceRound(state: GameState): GameState {
  let s = state;
  const { config } = s;
  const finished: ProjectRun[] = [];

  for (const p of s.projects) {
    // Versement de fonds propres pour chaque trimestre de chantier écoulé.
    if (projectPhase(p, s.round) === 'chantier') {
      s = { ...s, projects: s.projects.map((x) => (x.id === p.id ? { ...x, escrow: Math.max(0, x.escrow - x.installment) } : x)) };
    }
  }

  // Marché : marche aléatoire rappelée vers 1.
  const [g, rng] = nextGaussian(s.rng);
  const idx = s.marketIndex * (1 + config.marketReversion * (1 - s.marketIndex)) * Math.exp(config.marketVolatility * g);
  const marketIndex = Math.min(1.5, Math.max(0.6, idx));
  s = { ...s, rng, marketIndex, round: s.round + 1 };

  for (const p of s.projects) if (projectPhase(p, s.round) === 'termine') finished.push(p);

  for (const p of finished) {
    const ratio = s.marketIndex / p.marketIndexAtLaunch;
    const c = p.bilan.costs;
    const revenue = p.bilan.revenue.total * ratio;
    // Les frais proportionnels au chiffre d'affaires suivent la vente effective.
    const feeRate = config.bilanParams.salesFeeRate + config.bilanParams.overheadRate;
    const net = revenue * (1 - feeRate) - p.loanRepayment - c.financing;
    const owner = s.players.find((x) => x.id === p.owner)!;
    // Le chantier a consommé tout le séquestre prévu (arrondi flottant éventuel restitué).
    const gain = net + p.escrow;
    s = mapPlayer(s, p.owner, (x) => ({ ...x, cash: x.cash + gain }));
    const resale = Math.round((p.sdp * config.market.landPerSdp * 1.2) / 1000) * 1000;
    s = mapPlot(s, p.plotId, (x) => ({ ...x, owner: null, paid: 0, projectId: null, existingSdp: p.sdp, askingPrice: Math.max(MIN_PLOT_PRICE, resale) }));
    s = { ...s, projects: s.projects.filter((x) => x.id !== p.id) };
    s = withEvent(s, { player: p.owner, text: `${owner.name} livre ${p.id} : ventes ${eur(revenue)}, encaissement net ${eur(gain)}` });
  }

  s = { ...s, players: s.players.map((p) => ({ ...p, ready: false })), over: s.round >= config.rounds };
  return s;
}

/** Valeur du patrimoine d'un joueur : trésorerie + terrains (au prix de reprise) + fonds propres engagés dans les opérations. */
export function netWorth(state: GameState, playerId: string): number {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return 0;
  let w = player.cash;
  for (const pl of state.plots) {
    if (pl.owner === playerId && !pl.projectId) w += pl.askingPrice * (1 - state.config.plotSpread);
  }
  for (const pr of state.projects) if (pr.owner === playerId) w += pr.equityInvested;
  return Math.round(w);
}

export function ranking(state: GameState): { player: string; name: string; netWorth: number }[] {
  return state.players
    .map((p) => ({ player: p.id, name: p.name, netWorth: netWorth(state, p.id) }))
    .sort((a, b) => b.netWorth - a.netWorth);
}
