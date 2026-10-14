import type { Bilan, BilanParams, Criteria, Market, Parcel } from '../engine';

export type PlayerId = string;
export type PlotId = string;

/** Un tour = un trimestre. */
export interface GameConfig {
  market: Market;
  bilanParams: BilanParams;
  /** Trésorerie de départ de chaque joueur (€). */
  startCash: number;
  /** Marge sur chiffre d'affaires qu'un terrain « au prix du marché » laisse au meilleur projet. */
  askMargin: number;
  /** Nombre de tours (trimestres) ; la partie s'arrête ensuite. */
  rounds: number;
  /** Frais de revente d'un terrain à la banque : on récupère `1 - plotSpread` du prix affiché. */
  plotSpread: number;
  /** Volatilité trimestrielle de l'indice de marché et force de rappel vers 1. */
  marketVolatility: number;
  marketReversion: number;
  /** Chaque terrain acheté renchérit tous les terrains de `landHeatStep` ; cet écart se résorbe de `landHeatDecay` par tour. */
  landHeatStep: number;
  landHeatDecay: number;
  /** Coût de portage d'un terrain sans opération, par tour, en fraction du prix payé (taxe foncière, immobilisation). */
  holdingCostRate: number;
  /** Probabilité qu'un événement survienne à chaque tour. */
  eventChance: number;
  /** Le taux du crédit marche au hasard (±) et revient vers `bilanParams.interestRate` ; bornes. */
  rateVolatility: number;
  rateReversion: number;
  minRate: number;
  maxRate: number;
}

export interface Plot {
  id: PlotId;
  parcel: Parcel;
  owner: PlayerId | null;
  /** SDP du bâti existant (m²) : démoli au lancement d'une opération. */
  existingSdp: number;
  askingPrice: number;
  /** Prix de référence (indice de marché et demande à 1) ; le prix affiché en découle. */
  basePrice: number;
  /** Prix payé par le propriétaire actuel, frais compris (0 si sans propriétaire). */
  paid: number;
  projectId: string | null;
}

export type BotProfileName = 'prudent' | 'equilibre' | 'agressif';

export interface Player {
  id: PlayerId;
  name: string;
  bot: boolean;
  /** Tempérament du joueur ordinateur (ignoré pour un humain). */
  profile?: BotProfileName;
  cash: number;
  ready: boolean;
}

export type ProjectPhase = 'permis' | 'chantier' | 'vente';

export interface ProjectRun {
  id: string;
  plotId: PlotId;
  owner: PlayerId;
  criteria: Criteria;
  launchedAt: number;
  /** Durées en tours (trimestres). */
  permitRounds: number;
  buildRounds: number;
  sellRounds: number;
  /** Bilan calculé au lancement (prix de l'époque). */
  bilan: Bilan;
  sdp: number;
  marketIndexAtLaunch: number;
  /** Fonds propres encore réservés pour le chantier, et versement à chaque tour de chantier. */
  escrow: number;
  installment: number;
  /** Solde reçu à la fin des ventes si l'indice de marché est inchangé (hors effet marché). */
  loanRepayment: number;
  /** Taux du crédit au lancement, cumul des taux trimestriels et nombre de trimestres écoulés (crédit à taux variable). */
  rateAtLaunch: number;
  rateAccum: number;
  roundsRun: number;
  /** Surcoûts subis (sol pollué, retards, recours) : retranchés du solde à la livraison. */
  extraCost: number;
  /** Fonds propres totalement investis (terrain + travaux), pour la valorisation. */
  equityInvested: number;
}

export interface GameEvent {
  round: number;
  player?: PlayerId;
  text: string;
}

export interface GameState {
  config: GameConfig;
  round: number;
  over: boolean;
  players: Player[];
  plots: Plot[];
  projects: ProjectRun[];
  /** Indice des prix de vente (1 = référence), évolue au fil des tours. */
  marketIndex: number;
  /** Renchérissement des terrains dû à la demande (1 = calme). */
  landHeat: number;
  /** Taux annuel actuel du crédit promoteur. */
  interestRate: number;
  rng: number;
  nextProjectId: number;
  log: GameEvent[];
}

export type Action =
  | { type: 'buy'; player: PlayerId; plot: PlotId }
  | { type: 'sellPlot'; player: PlayerId; plot: PlotId }
  | { type: 'launch'; player: PlayerId; plot: PlotId; criteria: Criteria }
  /** Le joueur a fini son tour ; quand tous le sont, le trimestre se résout. */
  | { type: 'ready'; player: PlayerId };

export type ActionResult = { ok: true; state: GameState } | { ok: false; error: string };
