import type { Bilan, BilanParams, Criteria, Market, Parcel } from '../engine';

export type PlayerId = string;
export type PlotId = string;

export type Difficulty = 'facile' | 'normal' | 'difficile';

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
  /** Logements que les ménages achètent par trimestre dans le quartier (0 = automatique : 3 % du nombre de parcelles, au moins 6). */
  salesDemand: number;
  /**
   * Achat des terrains : `instant` (on paie le prix affiché, tout de suite) ou `auction` : on dépose une offre, les terrains
   * mis en vente restent ouverts aux offres quelques trimestres, les autres demandent de prospecter, et en cas de
   * concurrence le plus offrant l'emporte.
   */
  landMarket: 'instant' | 'auction';
  /** Durée pendant laquelle un terrain mis en vente reste ouvert aux offres (trimestres). */
  auctionRounds: number;
  /** Part des terrains libres mis en vente à chaque trimestre. */
  listingShare: number;
  /** Frais de prospection d'un terrain qui n'est pas en vente : part de l'offre, avec un minimum (non remboursés). */
  prospectFeeRate: number;
  prospectFeeMin: number;
  /** Un propriétaire non vendeur n'accepte que s'il obtient 0 à `reserveSpread` de plus que le prix affiché (selon le terrain). */
  reserveSpread: number;
  /** Frais de structure de la société par trimestre, en part de la trésorerie de départ (équipe, loyers) : 0 = aucun. */
  structureCostRate: number;
  /** Frais de structure par trimestre en euros (calculé à la création de la partie). */
  structureCost: number;
  /** Surcoût du découvert bancaire par rapport au taux du crédit promoteur (par an). */
  debtSpread: number;
  /** Objectif : patrimoine final en multiple de la trésorerie de départ (0 = aucun). */
  goalMultiple: number;
  /** Multiplicateur de la trésorerie de départ automatique (difficulté). */
  startCashFactor: number;
  difficulty: Difficulty;
  /** Part des lots à vendre sur plan avant que la banque débloque le chantier. */
  presaleThreshold: number;
  /** Part du prix versée pendant le chantier, par appels de fonds au prorata de l'avancement (le solde à la livraison). */
  payDuringBuild: number;
  /** Sensibilité des ventes au prix : un lot 10 % moins cher capte exp(élasticité × 0,1) fois plus d'acheteurs. */
  priceElasticity: number;
  /** Baisse relative de la demande par point de hausse du taux de crédit au-dessus de sa valeur de référence. */
  demandRateSensitivity: number;
  minRate: number;
  maxRate: number;
}

/** Famille de zone du PLU simplifié (voir `plu.ts`). */
export type ZoneFamily = 'centre' | 'renouvellement' | 'mixte' | 'preservation' | 'activites' | 'equipement' | 'nature';

/** Pourquoi un terrain ne peut pas être construit seul : à combiner avec des parcelles voisines. */
export type PlotIssue = 'trop-petite' | 'enclavee' | 'inconstructible' | 'zone';

export interface Plot {
  id: PlotId;
  label?: string;
  /** Parcelles cadastrales d'origine quand ce terrain est un assemblage. */
  parts?: PlotId[];
  /** Familles de zones du PLU qui touchent ce terrain (plusieurs après un assemblage à cheval) et code de la zone principale. */
  zones: ZoneFamily[];
  zoneCode?: string;
  /** Terrain mis en vente : ouvert aux offres jusqu'à ce tour (non compris), prix minimum figé à la mise en vente. */
  listing?: { until: number; minPrice: number };
  /** Si présent, le terrain n'est pas constructible tel quel (voir `PlotIssue`). */
  issue?: PlotIssue;
  parcel: Parcel;
  owner: PlayerId | null;
  /** SDP du bâti existant (m²) : démoli au lancement d'une opération. */
  existingSdp: number;
  /** Hauteur du bâti existant (m). */
  existingHeight: number;
  /** Coefficient de situation sur les prix de vente (transports, centre, équipements) ; 1 = médiane du quartier. */
  locationFactor: number;
  /** Surface du terrain (m²). */
  area: number;
  askingPrice: number;
  /** Prix de référence (indice de marché et demande à 1) ; le prix affiché en découle. */
  basePrice: number;
  /** Prix payé par le propriétaire actuel, frais compris (0 si sans propriétaire). */
  paid: number;
  projectId: string | null;
}

export type BotProfileName = 'prudent' | 'equilibre' | 'agressif';

/** Bilan des opérations soldées d'un joueur. */
export interface PlayerStats {
  /** Opérations menées jusqu'à la dernière vente. */
  closed: number;
  /** Lots (logements, commerces, bureaux) vendus. */
  lots: number;
  /** Résultat net cumulé, meilleur et pire résultat d'une opération (€). */
  netTotal: number;
  bestNet: number;
  worstNet: number;
}

export interface Player {
  id: PlayerId;
  name: string;
  bot: boolean;
  /** Tempérament du joueur ordinateur (ignoré pour un humain). */
  profile?: BotProfileName;
  /** Identité visuelle : couleur sur la carte et slogan (facultatifs). */
  color?: string;
  slogan?: string;
  /** Bilan des opérations soldées (pour l'écran de fin de partie). */
  stats?: PlayerStats;
  cash: number;
  /** Découvert bancaire : charges impayées, qui portent intérêt et se remboursent sur les premiers encaissements. */
  debt: number;
  /** Faillite : patrimoine négatif ; la banque saisit tout et le joueur ne joue plus. */
  bankrupt?: boolean;
  ready: boolean;
}

/** Permis de construire, attente du seuil de préventes exigé par la banque, chantier, puis livraison et dernières ventes. */
export type ProjectPhase = 'permis' | 'preventes' | 'chantier' | 'livraison';

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
  /** Hauteur du bâtiment projeté (m). */
  height: number;
  marketIndexAtLaunch: number;
  /** Fonds propres encore réservés pour le chantier, et versement à chaque tour de chantier. */
  escrow: number;
  installment: number;
  /** Solde reçu à la fin des ventes si l'indice de marché est inchangé (hors effet marché). */
  loanRepayment: number;
  phase: ProjectPhase;
  /** Vrai une fois le seuil de préventes atteint : la banque a débloqué le crédit (refinancement du terrain, chantier). */
  financed: boolean;
  /** Part du terrain financée par la banque, versée au promoteur quand le crédit est débloqué. */
  landRefund: number;
  /** Trimestres écoulés dans la phase en cours. */
  phaseElapsed: number;
  /** Lots à vendre (logements, commerces, bureaux) et lots vendus. */
  lots: number;
  lotsSold: number;
  /** Prix de vente cumulé des lots vendus (fixé à la vente), et part déjà versée par les acquéreurs. */
  soldRevenue: number;
  paidGross: number;
  /** Crédit encore dû (les encaissements le remboursent en priorité) et trésorerie nette déjà revenue au promoteur. */
  loanOutstanding: number;
  cashReceived: number;
  /** Prix de vente par rapport au marché : -0,1 = 10 % de remise pour vendre plus vite. */
  pricePolicy: number;
  /** Taux du crédit au lancement, cumul des taux trimestriels et nombre de trimestres écoulés (crédit à taux variable). */
  rateAtLaunch: number;
  rateAccum: number;
  roundsRun: number;
  /** Surcoûts subis (sol pollué, retards, recours) : retranchés du solde à la livraison. */
  extraCost: number;
  /** Fonds propres totalement investis (terrain + travaux), pour la valorisation. */
  equityInvested: number;
}

/** Offre d'achat sous pli fermé sur un terrain (les autres joueurs en voient le nombre, pas le prix). */
export interface Offer {
  plot: PlotId;
  player: PlayerId;
  /** Prix proposé pour le terrain, hors frais de notaire. */
  price: number;
  round: number;
  /** Somme bloquée sur la trésorerie : prix et frais de notaire. */
  reserved: number;
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
  offers: Offer[];
  /** Indice des prix de vente (1 = référence), évolue au fil des tours. */
  marketIndex: number;
  /** Choc de demande des ménages (retournement ou regain de confiance), qui s'estompe de 25 % par trimestre. */
  demandShock: number;
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
  /** Dépose ou remplace une offre sur un terrain libre (mode enchères). */
  | { type: 'offer'; player: PlayerId; plot: PlotId; price: number }
  | { type: 'withdraw'; player: PlayerId; plot: PlotId }
  | { type: 'sellPlot'; player: PlayerId; plot: PlotId }
  /** Assemble plusieurs parcelles mitoyennes que le joueur possède en une seule, plus grande. */
  | { type: 'merge'; player: PlayerId; plots: PlotId[] }
  /** Règle le prix de vente d'une opération par rapport au marché (remise ou prime). */
  | { type: 'setPrice'; player: PlayerId; project: string; policy: number }
  | { type: 'launch'; player: PlayerId; plot: PlotId; criteria: Criteria }
  /** Le joueur a fini son tour ; quand tous le sont, le trimestre se résout. */
  | { type: 'ready'; player: PlayerId };

export type ActionResult = { ok: true; state: GameState } | { ok: false; error: string };
