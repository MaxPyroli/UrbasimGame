import {
  DEFAULT_BILAN_PARAMS,
  DEFAULT_CRITERIA,
  MARKETS,
  buildDuration,
  computeBilan,
  computeProject,
  LocalProjection,
  ringArea,
  type Criteria,
  type Market,
  type Parcel,
} from '../engine';
import { marketAt } from './location';
import { applyRule, combineRules, type ZoneRule } from './plu';
import { mergeParcels } from './merge';
import { nextGaussian, nextRandom } from './rng';
import { expectedSales, lotPrice, lotsLeft, soldShare } from './sales';
import type { Action, ActionResult, BotProfileName, GameConfig, GameEvent, GameState, Plot, PlotIssue, Player, ProjectPhase, ProjectRun, ZoneFamily } from './types';

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
  salesDemand: 0,
  presaleThreshold: 0.6,
  payDuringBuild: 0.95,
  priceElasticity: 6,
  demandRateSensitivity: 8,
  minRate: 0.015,
  maxRate: 0.09,
};

/** Paramètres du bilan au taux actuel du crédit. */
export const currentParams = (s: GameState) => ({ ...s.config.bilanParams, interestRate: s.interestRate });

export interface PlotSeed {
  id: string;
  parcel: Parcel;
  existingSdp?: number;
  /** Hauteur du bâti existant (m). */
  existingHeight?: number;
  /** Coefficient de situation sur les prix de vente (1 = médiane du quartier). */
  locationFactor?: number;
  askingPrice?: number;
  /** Libellé affichable (section, numéro, surface). */
  label?: string;
  /** Le terrain n'est pas constructible seul. */
  issue?: PlotIssue;
  /** Zone(s) du PLU qui touchent le terrain ; absent = aucune contrainte de zone. */
  zones?: ZoneFamily[];
  zoneCode?: string;
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
/** Bornes de la politique de prix d'une opération (remise maximale, prime maximale). */
export const MIN_PRICE_POLICY = -0.2;
export const MAX_PRICE_POLICY = 0.15;

/** Règle du PLU qui s'applique à un terrain ; null quand le terrain n'a pas de zone (aucune contrainte). */
export const ruleOf = (plot: Pick<Plot, 'zones'>): ZoneRule | null => (plot.zones.length ? combineRules(plot.zones) : null);

/** Critères avec les contraintes du PLU de la zone. */
export const criteriaFor = (plot: Pick<Plot, 'zones'>, base: Criteria): Criteria => {
  const rule = ruleOf(plot);
  return rule ? applyRule(base, rule) : base;
};

/** Surface en dessous de laquelle un terrain sans projet réalisable est dit « trop petit » plutôt qu'« inconstructible ». */
const SMALL_PLOT_AREA = 150;

/** Un terrain est-il constructible seul ? Retourne la raison sinon (façade sur rue absente, trop petit, retraits). */
export function plotIssue(parcel: Parcel, config?: GameConfig, locationFactor = 1, rule: ZoneRule | null = null): PlotIssue | undefined {
  if (rule && !rule.buildable) return 'zone';
  if (parcel.streetEdges.length === 0) return 'enclavee';
  const ok = [1, 3].some((levels) => {
    const base: Criteria = { ...DEFAULT_CRITERIA, levels };
    const pr = computeProject(parcel, rule ? applyRule(base, rule) : base);
    return pr.footprint !== null && pr.checks.every((c) => c.status !== 'error');
  });
  if (!ok) return parcelArea(parcel) < SMALL_PLOT_AREA ? 'trop-petite' : 'inconstructible';
  // Constructible sur le papier, mais aucun projet n'est rentable même terrain offert (forme ou taille inadaptée).
  if (config && appraise(parcel, 0, config, locationFactor, rule).best <= 0) return parcelArea(parcel) < SMALL_PLOT_AREA ? 'trop-petite' : 'inconstructible';
  return undefined;
}

export const ISSUE_MESSAGE: Record<PlotIssue, string> = {
  enclavee: 'Parcelle enclavée : aucun accès à la rue. À assembler avec une parcelle voisine qui donne sur la rue.',
  'trop-petite': 'Terrain trop petit pour y construire seul de façon rentable. À assembler avec des parcelles voisines.',
  zone: 'Zone inconstructible pour un promoteur (équipement public ou espace naturel).',
  inconstructible: 'Forme ou taille inadaptée : aucun projet rentable sur ce terrain seul, même offert. À assembler avec des parcelles voisines.',
};

/** Surface d'une parcelle (m²). */
export function parcelArea(parcel: Parcel): number {
  const n = parcel.ring.length;
  const proj = new LocalProjection(parcel.ring.reduce((t, q) => t + q.lon, 0) / n, parcel.ring.reduce((t, q) => t + q.lat, 0) / n);
  return ringArea(parcel.ring.map((q) => proj.toLocal(q)));
}

/**
 * Meilleur prix de terrain que peut payer un projet réalisable (jusqu'à R+5, attique compris) en gardant la marge visée,
 * et surface du terrain. Un résultat ≤ 0 veut dire qu'aucun projet n'est rentable, même terrain offert.
 */
export function appraise(parcel: Parcel, existingSdp: number, config: GameConfig, locationFactor = 1, rule: ZoneRule | null = null): { best: number; area: number } {
  const market = marketAt(config.market, locationFactor);
  const area = parcelArea(parcel);
  if (parcel.streetEdges.length === 0 || (rule && !rule.buildable)) return { best: 0, area };
  let best = 0;
  for (let levels = 0; levels <= 5; levels++) for (const attic of [false, true]) {
    const base: Criteria = { ...DEFAULT_CRITERIA, levels, attic };
    const project = computeProject(parcel, rule ? applyRule(base, rule) : base);
    if (project.footprint === null || project.checks.some((c) => c.status === 'error')) continue;
    const b = computeBilan({ project, market, landPrice: 0, existingSdp, params: { ...config.bilanParams, targetMargin: config.askMargin } });
    best = Math.max(best, b.maxLandPrice);
  }
  return { best, area };
}

/**
 * Prix de départ d'un terrain : ce que le meilleur projet réalisable peut payer, multiplié par 0,9 à 1,5 selon le
 * terrain (attentes du vendeur) : certains sont de bonnes affaires, d'autres trop chers.
 */
export function defaultAskingPrice(id: string, parcel: Parcel, existingSdp: number, config: GameConfig, locationFactor = 1, rule: ZoneRule | null = null): number {
  const market = marketAt(config.market, locationFactor);
  const { best, area } = appraise(parcel, existingSdp, config, locationFactor, rule);
  let h = 0;
  for (const ch of id) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  const factor = 0.9 + 0.6 * ((h % 1000) / 999);
  // Même sans projet rentable, un terrain vaut quelque chose : usage actuel, jardin, intérêt pour un voisin qui assemble.
  const floor = Math.max(MIN_PLOT_PRICE, 0.6 * area * market.landPerSdp * locationFactor);
  return Math.max(Math.round(floor / 1000) * 1000, Math.round((best * factor) / 1000) * 1000);
}

/** Marché au niveau de prix actuel : seuls les prix de vente suivent l'indice, pas les coûts. */
export function currentMarket(s: GameState, plot?: Plot): Market {
  return marketAt(marketAt(s.config.market, s.marketIndex), plot?.locationFactor ?? 1);
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
      ...(s.issue ? { issue: s.issue } : {}),
      zones: s.zones ?? [],
      ...(s.zoneCode ? { zoneCode: s.zoneCode } : {}),
      parcel: s.parcel,
      owner: null,
      existingSdp: s.existingSdp ?? 0,
      existingHeight: s.existingHeight ?? 0,
      locationFactor: s.locationFactor ?? 1,
      area: parcelArea(s.parcel),
      askingPrice: 0,
      basePrice: s.askingPrice ?? defaultAskingPrice(s.id, s.parcel, s.existingSdp ?? 0, config, s.locationFactor ?? 1),
      paid: 0,
      projectId: null,
    };
  });
  // Trésorerie de départ : 2,5 fois le prix médian d'un terrain constructible (les petites parcelles à assembler ne comptent pas).
  const buildable = plots.filter((p) => !p.issue);
  const asks = (buildable.length ? buildable : plots).map((p) => p.basePrice).sort((a, b) => a - b);
  const startCash = config.startCash || Math.round((2.5 * (asks[Math.floor(asks.length / 2)] ?? 0)) / 50_000) * 50_000 || 1_000_000;
  const salesDemand = config.salesDemand || Math.max(6, Math.round(0.03 * plots.length));
  return reprice({
    config: { ...config, startCash, salesDemand },
    round: 0,
    over: false,
    players: g.players.map((p) => ({ id: p.id, name: p.name, bot: p.bot ?? false, ...(p.bot ? { profile: p.profile ?? 'equilibre' } : {}), cash: startCash, ready: false })),
    plots,
    projects: [],
    marketIndex: 1,
    demandShock: 0,
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

/** Phase d'une opération (l'avancement est stocké : l'attente de préventes et les retards le rendent imprévisible). */
export const projectPhase = (p: ProjectRun, _round?: number): ProjectPhase => p.phase;

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

  if (action.type === 'merge') {
    const ids = [...new Set(action.plots)].sort();
    if (ids.length < 2) return fail('il faut au moins deux parcelles');
    const list = ids.map((id) => state.plots.find((p) => p.id === id));
    if (list.some((p) => !p)) return fail('terrain inconnu');
    const plots = list as Plot[];
    if (plots.some((p) => p.owner !== player.id)) return fail('vous devez posséder toutes les parcelles à assembler');
    if (plots.some((p) => p.projectId)) return fail('une opération est en cours sur l’une des parcelles');
    const merged = mergeParcels(plots.map((p) => p.parcel));
    if (!merged.ok) return fail(merged.error);
    const id = ids.join('+');
    const fusion: Plot = {
      id,
      label: `Assemblage ${ids.length} parcelles · ${Math.round(merged.area)} m²`,
      parts: ids.flatMap((i) => state.plots.find((p) => p.id === i)!.parts ?? [i]),
      parcel: merged.parcel,
      owner: player.id,
      existingSdp: plots.reduce((t, p) => t + p.existingSdp, 0),
      existingHeight: Math.max(...plots.map((p) => p.existingHeight)),
      zones: [...new Set(plots.flatMap((p) => p.zones))],
      ...(plots.slice().sort((a, b) => b.area - a.area)[0].zoneCode ? { zoneCode: plots.slice().sort((a, b) => b.area - a.area)[0].zoneCode } : {}),
      locationFactor: plots.reduce((t, p) => t + p.locationFactor * p.area, 0) / plots.reduce((t, p) => t + p.area, 0),
      area: merged.area,
      askingPrice: 0,
      basePrice: plots.reduce((t, p) => t + p.basePrice, 0),
      paid: plots.reduce((t, p) => t + p.paid, 0),
      projectId: null,
    };
    const issue = plotIssue(merged.parcel, state.config, fusion.locationFactor, ruleOf(fusion));
    if (issue) fusion.issue = issue;
    let s: GameState = { ...state, plots: [...state.plots.filter((p) => !ids.includes(p.id)), fusion] };
    s = reprice(s);
    return { ok: true, state: withEvent(s, { player: player.id, text: `${player.name} assemble ${ids.join(', ')} (${Math.round(merged.area)} m²)` }) };
  }

  if (action.type === 'setPrice') {
    const run = state.projects.find((p) => p.id === action.project);
    if (!run) return fail('opération inconnue');
    if (run.owner !== player.id) return fail('cette opération ne vous appartient pas');
    if (!Number.isFinite(action.policy)) return fail('prix invalide');
    const policy = Math.round(clamp(action.policy, MIN_PRICE_POLICY, MAX_PRICE_POLICY) * 1000) / 1000;
    return { ok: true, state: mapProject(state, run.id, (p) => ({ ...p, pricePolicy: policy })) };
  }

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
  if (plot.issue) return fail(ISSUE_MESSAGE[plot.issue]);
  const criteria = criteriaFor(plot, action.criteria);
  const project = computeProject(plot.parcel, criteria);
  if (project.footprint === null) return fail('rien de constructible avec ces critères');
  const errors = project.checks.filter((c) => c.status === 'error');
  if (errors.length) return fail(`projet non conforme : ${errors.map((c) => `${c.label} (${c.detail})`).join(' ; ')}`);

  const { config } = state;
  const ls = config.bilanParams.loanShare;
  const bilan = computeBilan({
    project,
    market: currentMarket(state, plot),
    landPrice: plot.paid / (1 + config.bilanParams.acquisitionFeeRate),
    existingSdp: plot.existingSdp,
    params: currentParams(state),
  });
  const c = bilan.costs;
  const buildSpend = c.demolition + c.works + c.fixed + c.design + c.insurance + c.contingency + c.taxes;
  const landAndFees = c.land + c.acquisitionFees;
  const equityBuild = buildSpend * (1 - ls);
  const refund = landAndFees * ls;
  if (player.cash < equityBuild) {
    return fail(`fonds propres insuffisants : ${eur(equityBuild)} à réserver pour le chantier, ${eur(player.cash)} disponibles. La banque ne financera le terrain et les travaux qu’une fois ${Math.round(config.presaleThreshold * 100)} % des lots vendus sur plan.`);
  }

  const d = buildDuration(project, config.bilanParams);
  const q = (months: number) => Math.max(1, Math.ceil(months / 3));
  const buildRounds = q(d.build);
  const run: ProjectRun = {
    id: `P${state.nextProjectId}`,
    plotId: plot.id,
    owner: player.id,
    criteria,
    launchedAt: state.round,
    permitRounds: q(d.permit),
    buildRounds,
    sellRounds: q(d.sellOut),
    bilan,
    sdp: project.indicators.sdpTotal,
    height: project.indicators.height,
    marketIndexAtLaunch: state.marketIndex,
    phase: 'permis',
    financed: false,
    landRefund: refund,
    phaseElapsed: 0,
    lots: Math.max(1, project.indicators.dwellings + Math.ceil(project.indicators.sdpCommerce / 120) + Math.ceil(project.indicators.sdpOffice / 200)),
    lotsSold: 0,
    soldRevenue: 0,
    paidGross: 0,
    loanOutstanding: ls * (landAndFees + buildSpend),
    cashReceived: 0,
    pricePolicy: 0,
    rateAtLaunch: state.interestRate,
    rateAccum: 0,
    roundsRun: 0,
    extraCost: 0,
    escrow: equityBuild,
    installment: equityBuild / buildRounds,
    loanRepayment: ls * (landAndFees + buildSpend),
    equityInvested: landAndFees * (1 - ls) + equityBuild,
  };
  let s = mapPlayer(state, player.id, (p) => ({ ...p, cash: p.cash - equityBuild }));
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
  const live = s.projects.filter((p) => p.phase !== 'livraison');
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
    // Un retournement de marché refroidit aussi les acheteurs ; un regain les ramène.
    s = { ...s, marketIndex: clamp(s.marketIndex * factor, 0.6, 1.5), demandShock: factor < 1 ? -0.35 : 0.25 };
    return withEvent(s, { text: factor < 1 ? 'Retournement du marché : les prix de vente baissent de 8 %' : 'Regain du marché : les prix de vente montent de 7 %' });
  }
  if (u < 0.45) {
    // Recours de voisins sur un permis ou un projet commençant.
    let p: ProjectRun | null;
    [p, s] = pick(live.filter((x) => x.phase === 'permis'));
    if (!p) return s;
    const cost = (p.loanRepayment * s.interestRate) / 4;
    s = mapProject(s, p.id, (x) => ({ ...x, permitRounds: x.permitRounds + 1, extraCost: x.extraCost + cost }));
    return withEvent(s, { player: p.owner, text: `Recours de voisins contre ${p.id} (${owner(p)}) : permis retardé d'un trimestre` });
  }
  if (u < 0.65) {
    // Sol pollué découvert pendant le chantier.
    let p: ProjectRun | null;
    [p, s] = pick(live.filter((x) => x.phase === 'chantier'));
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
    [p, s] = pick(live.filter((x) => (x.phase === 'permis' || x.phase === 'chantier') && x.bilan.costs.works > 0 && x.criteria.parkingStrategy !== 'aucun'));
    if (!p) return s;
    const cost = (p.loanRepayment * s.interestRate) / 2 + p.bilan.costs.works * 0.01;
    s = mapProject(s, p.id, (x) => ({ ...x, buildRounds: x.phase === 'chantier' ? x.buildRounds + 2 : x.buildRounds, permitRounds: x.phase === 'permis' ? x.permitRounds + 2 : x.permitRounds, extraCost: x.extraCost + cost }));
    return withEvent(s, { player: p.owner, text: `Fouilles archéologiques sur ${p.id} (${owner(p)}) : deux trimestres de retard` });
  }
  // Décision de la banque centrale.
  let g: number;
  [g, s] = uniform(s);
  const delta = g < 0.5 ? -0.01 : 0.01;
  s = { ...s, interestRate: clamp(s.interestRate + delta, s.config.minRate, s.config.maxRate) };
  return withEvent(s, { text: `Les taux ${delta > 0 ? 'montent' : 'baissent'} : crédit promoteur à ${(s.interestRate * 100).toFixed(1)} %` });
}

/** Résout un trimestre : chantiers, marché, ventes, encaissements, aléas, livraisons. Appelée quand tous les joueurs sont prêts. */
export function advanceRound(state: GameState): GameState {
  let s = state;
  const { config } = s;
  const feeRate = config.bilanParams.salesFeeRate + config.bilanParams.overheadRate;

  // Portage des terrains qui dorment ; fonds propres versés pour chaque trimestre de chantier écoulé.
  s = {
    ...s,
    players: s.players.map((pl) => {
      const hold = s.plots.filter((p) => p.owner === pl.id && !p.projectId).reduce((t, p) => t + p.paid * config.holdingCostRate, 0);
      return hold ? { ...pl, cash: Math.max(0, pl.cash - hold) } : pl;
    }),
    projects: s.projects.map((p) => ({
      ...p,
      escrow: p.phase === 'chantier' ? Math.max(0, p.escrow - p.installment) : p.escrow,
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
    demandShock: s.demandShock * 0.75,
  };
  s = rollEvent(s);

  // Ventes : la demande du quartier se répartit entre toutes les opérations qui ont des lots à vendre.
  const expected = expectedSales(s);
  for (const p of s.projects) {
    const e = expected.get(p.id) ?? 0;
    let u: number;
    [u, s] = uniform(s);
    const n = Math.min(lotsLeft(p), Math.floor(e) + (u < e - Math.floor(e) ? 1 : 0));
    if (n > 0) {
      const price = lotPrice(s, p);
      s = mapProject(s, p.id, (x) => ({ ...x, lotsSold: x.lotsSold + n, soldRevenue: x.soldRevenue + n * price }));
    }
  }

  // Encaissements : appels de fonds au prorata du chantier, solde à la livraison ; ils remboursent d'abord la banque.
  s = { ...s, projects: s.projects.map((p) => ({ ...p })) };
  for (const p of s.projects) {
    const finishing = p.phase === 'chantier' && p.phaseElapsed + 1 >= p.buildRounds;
    const pct = p.phase === 'livraison' || finishing ? 1 : p.phase === 'chantier' ? config.payDuringBuild * ((p.phaseElapsed + 1) / p.buildRounds) : 0;
    const gross = Math.max(0, pct * p.soldRevenue - p.paidGross);
    if (gross <= 0) continue;
    const net = gross * (1 - feeRate);
    const repay = Math.min(p.loanOutstanding, net);
    p.paidGross += gross;
    p.loanOutstanding -= repay;
    p.cashReceived += net - repay;
    s = mapPlayer(s, p.owner, (x) => ({ ...x, cash: x.cash + net - repay }));
  }

  // Avancement : permis → (attente des préventes) → chantier → livraison ; clôture quand tout est vendu.
  const closing: ProjectRun[] = [];
  const released: ProjectRun[] = [];
  s = {
    ...s,
    projects: s.projects.map((p) => {
      const q = { ...p, phaseElapsed: p.phaseElapsed + 1 };
      const ready = soldShare(q) >= config.presaleThreshold;
      if (q.phase === 'permis' && q.phaseElapsed >= q.permitRounds) {
        if (!ready) return { ...q, phase: 'preventes', phaseElapsed: 0 } as ProjectRun;
        released.push(q);
        return { ...q, phase: 'chantier', phaseElapsed: 0, financed: true } as ProjectRun;
      }
      if (q.phase === 'preventes' && ready) {
        released.push(q);
        return { ...q, phase: 'chantier', phaseElapsed: 0, financed: true } as ProjectRun;
      }
      if (q.phase === 'chantier' && q.phaseElapsed >= q.buildRounds) return { ...q, phase: 'livraison', phaseElapsed: 0 } as ProjectRun;
      if (q.phase === 'livraison' && q.phaseElapsed >= 1 && lotsLeft(q) === 0) closing.push(q);
      return q;
    }),
  };

  // Le seuil de préventes est atteint : la banque débloque le crédit et refinance le terrain, le chantier peut démarrer.
  for (const p of released) {
    s = mapPlayer(s, p.owner, (x) => ({ ...x, cash: x.cash + p.landRefund }));
    s = withEvent(s, { player: p.owner, text: `La banque débloque le crédit de ${p.id} : ${Math.round(soldShare(p) * 100)} % des lots vendus sur plan, ${eur(p.landRefund)} de terrain refinancés, chantier lancé` });
  }

  for (const p of closing) {
    // Crédit à taux variable : les intérêts suivent le taux moyen constaté et la durée réelle (attente, stock invendu).
    const planned = p.permitRounds + p.buildRounds + p.sellRounds;
    const financing = p.bilan.costs.financing * (p.rateAccum / p.roundsRun / p.rateAtLaunch) * (p.roundsRun / planned);
    const due = p.loanOutstanding + financing + p.extraCost - p.escrow;
    const owner = s.players.find((x) => x.id === p.owner)!;
    const net = p.cashReceived - due;
    s = mapPlayer(s, p.owner, (x) => ({ ...x, cash: Math.max(0, x.cash - due) }));
    const base = Math.max(MIN_PLOT_PRICE, Math.round((p.sdp * config.market.landPerSdp * 1.2) / 1000) * 1000);
    s = mapPlot(s, p.plotId, (x) => ({ ...x, owner: null, paid: 0, projectId: null, existingSdp: p.sdp, existingHeight: p.height, basePrice: base }));
    s = { ...s, projects: s.projects.filter((x) => x.id !== p.id) };
    s = withEvent(s, { player: p.owner, text: `${owner.name} solde ${p.id} : ${p.lots} lots vendus ${eur(p.soldRevenue)}, résultat net ${eur(net)} en ${p.roundsRun} trimestres` });
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
  // Un projet vaut les fonds propres investis, moins ce que les ventes ont déjà fait revenir en trésorerie.
  for (const pr of state.projects) if (pr.owner === playerId) w += pr.equityInvested - pr.cashReceived + (pr.financed ? 0 : pr.landRefund);
  return Math.round(w);
}

export function ranking(state: GameState): { player: string; name: string; netWorth: number }[] {
  return state.players
    .map((p) => ({ player: p.id, name: p.name, netWorth: netWorth(state, p.id) }))
    .sort((a, b) => b.netWorth - a.netWorth);
}
