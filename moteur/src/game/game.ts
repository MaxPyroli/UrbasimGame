import {
  DEFAULT_BILAN_PARAMS,
  DEFAULT_CRITERIA,
  MARKETS,
  buildDuration,
  computeBilan,
  computeProject,
  type Market,
  type Parcel,
} from '../engine';
import { nextGaussian, nextRandom } from './rng';
import type { Action, ActionResult, BotProfileName, GameConfig, GameEvent, GameState, Plot, Player, ProjectPhase, ProjectRun } from './types';

export const DEFAULT_CONFIG: GameConfig = {
  market: MARKETS['petite-couronne'],
  bilanParams: DEFAULT_BILAN_PARAMS,
  /** 0 = automatique : 2,5 fois le prix médian d'un terrain. */
  startCash: 0,
  askMargin: 0.07,
  rounds: 40,
  plotSpread: 0.1,
  marketVolatility: 0.03,
  marketReversion: 0.1,
  landHeatStep: 0.05,
  landHeatDecay: 0.1,
  holdingCostRate: 0.005,
  eventChance: 0.4,
  rateVolatility: 0.004,
  rateReversion: 0.1,
  minRate: 0.015,
  maxRate: 0.09,
};

/** Paramètres du bilan au taux actuel du crédit. */
export const currentParams = (s: GameState) => ({ ...s.config.bilanParams, interestRate: s.interestRate });

export interface PlotSeed {
  id: string;
  parcel: Parcel;
  existingSdp?: number;
  askingPrice?: number;
  /** Libellé affichable (section, numéro, surface). */
  label?: string;
}

export interface PlayerSeed {
  id: string;
  name: string;
  bot?: boolean;
  profile?: BotProfileName;
}

export interface NewGame {
  players: PlayerSeed[];
  plots: PlotSeed[];
  config?: Partial<GameConfig>;
  seed?: number;
}

const MIN_PLOT_PRICE = 20_000;

/**
 * Prix de départ d'un terrain : ce que le meilleur projet réalisable (jusqu'à R+5, attique compris) peut payer en gardant la marge
 * visée, multiplié par 0,9 à 1,5 selon le terrain (attentes du vendeur) : certains sont de bonnes affaires, d'autres trop chers.
 */
export function defaultAskingPrice(id: string, parcel: Parcel, existingSdp: number, config: GameConfig): number {
  let best = 0;
  for (let levels = 0; levels <= 5; levels++) for (const attic of [false, true]) {
    const project = computeProject(parcel, { ...DEFAULT_CRITERIA, levels, attic });
    if (project.footprint === null || project.checks.some((c) => c.status === 'error')) continue;
    const b = computeBilan({ project, market: config.market, landPrice: 0, existingSdp, params: { ...config.bilanParams, targetMargin: config.askMargin } });
    best = Math.max(best, b.maxLandPrice);
  }
  let h = 0;
  for (const ch of id) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  const factor = 0.9 + 0.6 * ((h % 1000) / 999);
  return Math.max(MIN_PLOT_PRICE, Math.round((best * factor) / 1000) * 1000);
}

/** Marché au niveau de prix actuel : seuls les prix de vente suivent l'indice, pas les coûts. */
export function currentMarket(s: GameState): Market {
  const m = s.config.market;
  const k = s.marketIndex;
  return {
    ...m,
    housingPerShab: m.housingPerShab * k,
    commercePerSdp: m.commercePerSdp * k,
    officePerSdp: m.officePerSdp * k,
    parkingBasementSpace: m.parkingBasementSpace * k,
    parkingOtherSpace: m.parkingOtherSpace * k,
  };
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
      ...(s.label ? { label: s.label } : {}),
      parcel: s.parcel,
      owner: null,
      existingSdp: s.existingSdp ?? 0,
      askingPrice: 0,
      basePrice: s.askingPrice ?? defaultAskingPrice(s.id, s.parcel, s.existingSdp ?? 0, config),
      paid: 0,
      projectId: null,
    };
  });
  const asks = plots.map((p) => p.basePrice).sort((a, b) => a - b);
  const startCash = config.startCash || Math.round((2.5 * (asks[Math.floor(asks.length / 2)] ?? 0)) / 50_000) * 50_000 || 1_000_000;
  return reprice({
    config: { ...config, startCash },
    round: 0,
    over: false,
    players: g.players.map((p) => ({ id: p.id, name: p.name, bot: p.bot ?? false, ...(p.bot ? { profile: p.profile ?? 'equilibre' } : {}), cash: startCash, ready: false })),
    plots,
    projects: [],
    marketIndex: 1,
    landHeat: 1,
    interestRate: config.bilanParams.interestRate,
    rng: (g.seed ?? 1) >>> 0,
    nextProjectId: 1,
    log: [],
  });
}

/** Prix affiché des terrains : prix de référence × indice de marché × demande. */
function reprice(s: GameState): GameState {
  const k = s.marketIndex * s.landHeat;
  return {
    ...s,
    plots: s.plots.map((p) => (p.projectId ? p : { ...p, askingPrice: Math.max(MIN_PLOT_PRICE, Math.round((p.basePrice * k) / 1000) * 1000) })),
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
    s = reprice({ ...s, landHeat: s.landHeat * (1 + s.config.landHeatStep) });
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
    market: currentMarket(state),
    landPrice: plot.paid / (1 + config.bilanParams.acquisitionFeeRate),
    existingSdp: plot.existingSdp,
    params: currentParams(state),
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
    rateAtLaunch: state.interestRate,
    rateAccum: 0,
    roundsRun: 0,
    extraCost: 0,
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

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

type Draw = (s: GameState) => [number, GameState];
const uniform: Draw = (s) => {
  const [u, rng] = nextRandom(s.rng);
  return [u, { ...s, rng }];
};
const gauss: Draw = (s) => {
  const [g, rng] = nextGaussian(s.rng);
  return [g, { ...s, rng }];
};

const mapProject = (s: GameState, id: string, f: (p: ProjectRun) => ProjectRun): GameState => ({
  ...s,
  projects: s.projects.map((p) => (p.id === id ? f(p) : p)),
});

/** Aléa du trimestre : au plus un événement, tiré dans l'état (rejouable). */
function rollEvent(state: GameState): GameState {
  let s = state;
  let u: number;
  [u, s] = uniform(s);
  if (u >= s.config.eventChance) return s;
  [u, s] = uniform(s);
  const live = s.projects.filter((p) => projectPhase(p, s.round) !== 'vente');
  const owner = (p: ProjectRun) => s.players.find((x) => x.id === p.owner)!.name;
  const pick = (list: ProjectRun[]): [ProjectRun | null, GameState] => {
    if (!list.length) return [null, s];
    const [v, s2] = uniform(s);
    return [list[Math.floor(v * list.length)], s2];
  };

  if (u < 0.25) {
    // Le marché s'emballe ou se retourne.
    let g: number;
    [g, s] = uniform(s);
    const factor = g < 0.5 ? 0.92 : 1.07;
    s = { ...s, marketIndex: clamp(s.marketIndex * factor, 0.6, 1.5) };
    return withEvent(s, { text: factor < 1 ? 'Retournement du marché : les prix de vente baissent de 8 %' : 'Regain du marché : les prix de vente montent de 7 %' });
  }
  if (u < 0.45) {
    // Recours de voisins sur un permis ou un projet commençant.
    let p: ProjectRun | null;
    [p, s] = pick(live.filter((x) => projectPhase(x, s.round) === 'permis'));
    if (!p) return s;
    const cost = (p.loanRepayment * s.interestRate) / 4;
    s = mapProject(s, p.id, (x) => ({ ...x, permitRounds: x.permitRounds + 1, extraCost: x.extraCost + cost }));
    return withEvent(s, { player: p.owner, text: `Recours de voisins contre ${p.id} (${owner(p)}) : permis retardé d'un trimestre` });
  }
  if (u < 0.65) {
    // Sol pollué découvert pendant le chantier.
    let p: ProjectRun | null;
    [p, s] = pick(live.filter((x) => projectPhase(x, s.round) === 'chantier'));
    if (!p) return s;
    let v: number;
    [v, s] = uniform(s);
    const cost = p.bilan.costs.works * (0.03 + 0.05 * v);
    s = mapProject(s, p.id, (x) => ({ ...x, extraCost: x.extraCost + cost }));
    return withEvent(s, { player: p.owner, text: `Sol pollué sous ${p.id} (${owner(p)}) : surcoût de ${eur(cost)}` });
  }
  if (u < 0.8) {
    // Fouilles archéologiques : seulement si le projet a un sous-sol.
    let p: ProjectRun | null;
    [p, s] = pick(live.filter((x) => projectPhase(x, s.round) !== 'vente' && x.bilan.costs.works > 0 && x.criteria.parkingStrategy !== 'aucun'));
    if (!p) return s;
    const cost = (p.loanRepayment * s.interestRate) / 2 + p.bilan.costs.works * 0.01;
    s = mapProject(s, p.id, (x) => ({ ...x, buildRounds: projectPhase(x, s.round) === 'chantier' ? x.buildRounds + 2 : x.buildRounds, permitRounds: projectPhase(x, s.round) === 'permis' ? x.permitRounds + 2 : x.permitRounds, extraCost: x.extraCost + cost }));
    return withEvent(s, { player: p.owner, text: `Fouilles archéologiques sur ${p.id} (${owner(p)}) : deux trimestres de retard` });
  }
  // Décision de la banque centrale.
  let g: number;
  [g, s] = uniform(s);
  const delta = g < 0.5 ? -0.01 : 0.01;
  s = { ...s, interestRate: clamp(s.interestRate + delta, s.config.minRate, s.config.maxRate) };
  return withEvent(s, { text: `Les taux ${delta > 0 ? 'montent' : 'baissent'} : crédit promoteur à ${(s.interestRate * 100).toFixed(1)} %` });
}

/** Résout un trimestre : chantiers, ventes, marché, aléas. Appelée quand tous les joueurs sont prêts. */
export function advanceRound(state: GameState): GameState {
  let s = state;
  const { config } = s;

  // Portage des terrains qui dorment ; fonds propres versés pour chaque trimestre de chantier écoulé.
  s = {
    ...s,
    players: s.players.map((pl) => {
      const hold = s.plots.filter((p) => p.owner === pl.id && !p.projectId).reduce((t, p) => t + p.paid * config.holdingCostRate, 0);
      return hold ? { ...pl, cash: Math.max(0, pl.cash - hold) } : pl;
    }),
    projects: s.projects.map((p) => ({
      ...p,
      escrow: projectPhase(p, s.round) === 'chantier' ? Math.max(0, p.escrow - p.installment) : p.escrow,
      rateAccum: p.rateAccum + s.interestRate,
      roundsRun: p.roundsRun + 1,
    })),
  };

  // Marché (marche aléatoire rappelée vers 1), demande sur les terrains, taux (rappelés vers le taux de base).
  let g: number;
  [g, s] = gauss(s);
  const idx = s.marketIndex * (1 + config.marketReversion * (1 - s.marketIndex)) * Math.exp(config.marketVolatility * g);
  [g, s] = gauss(s);
  const rate = s.interestRate + config.rateReversion * (config.bilanParams.interestRate - s.interestRate) + config.rateVolatility * g;
  s = {
    ...s,
    round: s.round + 1,
    marketIndex: clamp(idx, 0.6, 1.5),
    interestRate: clamp(rate, config.minRate, config.maxRate),
    landHeat: 1 + (s.landHeat - 1) * (1 - config.landHeatDecay),
  };
  s = rollEvent(s);

  // Livraisons.
  for (const p of s.projects.filter((x) => projectPhase(x, s.round) === 'termine')) {
    const ratio = s.marketIndex / p.marketIndexAtLaunch;
    const revenue = p.bilan.revenue.total * ratio;
    const feeRate = config.bilanParams.salesFeeRate + config.bilanParams.overheadRate;
    // Crédit à taux variable : les intérêts suivent le taux moyen constaté pendant l'opération.
    const financing = p.bilan.costs.financing * (p.rateAccum / p.roundsRun / p.rateAtLaunch);
    const gain = revenue * (1 - feeRate) - p.loanRepayment - financing - p.extraCost + p.escrow;
    const owner = s.players.find((x) => x.id === p.owner)!;
    s = mapPlayer(s, p.owner, (x) => ({ ...x, cash: x.cash + gain }));
    const base = Math.max(MIN_PLOT_PRICE, Math.round((p.sdp * config.market.landPerSdp * 1.2) / 1000) * 1000);
    s = mapPlot(s, p.plotId, (x) => ({ ...x, owner: null, paid: 0, projectId: null, existingSdp: p.sdp, basePrice: base }));
    s = { ...s, projects: s.projects.filter((x) => x.id !== p.id) };
    s = withEvent(s, { player: p.owner, text: `${owner.name} livre ${p.id} : ventes ${eur(revenue)}, encaissement net ${eur(gain)}` });
  }

  s = reprice(s);
  return { ...s, players: s.players.map((p) => ({ ...p, ready: false })), over: s.round >= config.rounds };
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
