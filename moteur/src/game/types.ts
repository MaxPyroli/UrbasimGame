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
  /** Appels d'offres de la commune sur ses propres terrains (cahier des charges, sélection par pondération annoncée). */
  communeTenders: boolean;
  /** Nombre de terrains communaux au départ, délai de réponse (trimestres) et intervalle entre deux appels d'offres. */
  municipalPlots: number;
  tenderRounds: number;
  tenderEvery: number;
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

/** Densité du tissu bâti autour d'un terrain : adapte les retraits et l'emprise de la zone (voir `adaptToDensity`). */
export type Density = 'dense' | 'moyenne' | 'diffuse';

/** Famille de zone du PLU simplifié (voir `plu.ts`). */
export type ZoneFamily = 'centre' | 'renouvellement' | 'mixte' | 'preservation' | 'activites' | 'equipement' | 'nature';

/** Pourquoi un terrain ne peut pas être construit seul : à combiner avec des parcelles voisines. */
export type PlotIssue = 'trop-petite' | 'enclavee' | 'inconstructible' | 'zone' | 'delaisse';

/** Bâtiment livré sur un terrain par une opération : reste sur la carte (et sera démoli par la prochaine opération). */
export interface BuiltBuilding {
  runId: string;
  owner: PlayerId;
  criteria: Criteria;
  /** Hauteur (m) et surface de plancher (m²). */
  height: number;
  sdp: number;
  dwellings: number;
  /** Tour de livraison. */
  round: number;
}

export interface Plot {
  id: PlotId;
  label?: string;
  /** Parcelles cadastrales d'origine quand ce terrain est un assemblage. */
  parts?: PlotId[];
  /** Familles de zones du PLU qui touchent ce terrain (plusieurs après un assemblage à cheval) et code de la zone principale. */
  zones: ZoneFamily[];
  zoneCode?: string;
  /** Densité du bâti environnant (absent = moyenne) : en tissu dense, on construit en limite et avec peu de retrait. */
  density?: Density;
  /** Terrain de la commune : il ne se vend que par appel d'offres (ni enchères ni prospection). */
  municipal?: boolean;
  /** Engagements pris auprès de la commune en remportant un appel d'offres. */
  obligation?: TenderTerms;
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
  /** Bâtiments livrés par les opérations des joueurs : ils remplacent le bâti d'origine sur la carte. */
  built?: BuiltBuilding[];
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
  /** Engagements de l'appel d'offres de la commune (social, qualité, délai) ; absent pour une opération libre. */
  terms?: TenderTerms;
  /** Lots cédés en bloc à un bailleur social au lancement, et leur prix total. */
  socialLots: number;
  socialRevenue: number;
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

/** Niveau de qualité environnementale : 0 standard, 1 performant, 2 bas carbone. */
export type Quality = 0 | 1 | 2;

/** Cadre juridique de l'opération : ZAC, projet urbain partenarial ou quartier en renouvellement urbain. */
export type ProgrammeKind = 'zac' | 'pup' | 'npnru';

/** Avantages (et contreparties) que la commune accorde au lauréat, tels que le bilan les applique. */
export interface Programme {
  kind: ProgrammeKind;
  label: string;
  /** Une phrase qui dit ce que le programme change pour le promoteur. */
  summary: string;
  /** Prix de cession minimal = cette part de la valeur du terrain sous le cahier des charges. */
  landDiscount: number;
  /** Taxe d'aménagement et participations (€/m² de SDP) à la place du régime normal. */
  taxPerSdp: number;
  /** Délai d'instruction du permis (mois). */
  permitMonths: number;
  /** Niveaux supplémentaires accordés au-delà du PLU (bonus de constructibilité). */
  bonusLevels: number;
  /** Hausse des prix de vente du libre (TVA à 5,5 % pour les acquéreurs). */
  salesPremium: number;
}

/** Cahier des charges d'un appel d'offres de la commune. */
export interface TenderSpec {
  /** Part minimale de logements sociaux (cédés en bloc à un bailleur à un prix réduit). */
  minSocialShare: number;
  /** Commerces obligatoires en rez-de-chaussée. */
  groundCommerce: boolean;
  /** Hauteur maximale imposée (R+x, attique compris), éventuellement inférieure à celle du PLU. */
  maxLevels: number;
  minQuality: Quality;
  /** Délai de livraison : de `minDelivery` à `maxDelivery` trimestres entre le lancement de l'opération et la livraison. */
  minDelivery: number;
  maxDelivery: number;
  /** Cadre de l'opération : avantages accordés en échange du cahier des charges. */
  programme: Programme;
  /** Prix de cession minimal du terrain. */
  minPrice: number;
  /** Pondération annoncée de la sélection (somme = 1). */
  weights: { price: number; social: number; quality: number; delay: number };
}

/** Proposition d'un promoteur : tout se note, pas seulement le prix. */
export interface TenderBid {
  player: PlayerId;
  /** Prix proposé pour le terrain, hors frais de notaire. */
  price: number;
  socialShare: number;
  quality: Quality;
  /** Délai de livraison promis (trimestres entre lancement et livraison). */
  delivery: number;
  /** Somme bloquée : prix et frais de notaire. */
  reserved: number;
  round: number;
}

export interface Tender {
  id: string;
  plotId: PlotId;
  opensAt: number;
  /** L'appel d'offres se clôt à ce tour (non compris). */
  closesAt: number;
  spec: TenderSpec;
  bids: TenderBid[];
  status: 'open' | 'awarded' | 'void';
  winner?: PlayerId;
}

/** Engagements du lauréat, qui s'imposent à son projet. */
export interface TenderTerms {
  tenderId: string;
  socialShare: number;
  quality: Quality;
  delivery: number;
  maxLevels: number;
  groundCommerce: boolean;
  programme: Programme;
  /** L'opération doit être lancée avant ce tour, sinon la commune reprend le terrain et garde une pénalité. */
  launchBy: number;
  /** Prix payé pour le terrain (hors frais), pour calculer la pénalité de reprise. */
  price: number;
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

/** Famille d'un événement du journal : sert à filtrer les notifications et à choisir l'icône. */
export type EventKind = 'alea' | 'commune' | 'terrain' | 'operation' | 'finance';

export interface GameEvent {
  round: number;
  /** Joueur concerné ; absent = événement public (marché, taux, appel d'offres lancé). */
  player?: PlayerId;
  text: string;
  kind?: EventKind;
  tone?: 'good' | 'bad' | 'info';
  /** Identifiant de l'aléa ou de l'événement type (recours, pollution, fouilles, marche-baisse…), pour l'explication affichée. */
  code?: string;
  /** Ce que l'événement concerne, pour y aller d'un clic. */
  ref?: { plot?: PlotId; project?: string; tender?: string };
  /** À signaler au joueur par une fenêtre, en plus du journal. */
  popup?: boolean;
}

export interface GameState {
  config: GameConfig;
  round: number;
  over: boolean;
  players: Player[];
  plots: Plot[];
  projects: ProjectRun[];
  offers: Offer[];
  tenders: Tender[];
  nextTenderId: number;
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
  /** Propose un projet à la commune pour un de ses terrains (dépose ou remplace sa proposition). */
  | { type: 'tenderBid'; player: PlayerId; tender: string; price: number; socialShare: number; quality: Quality; delivery: number }
  | { type: 'tenderWithdraw'; player: PlayerId; tender: string }
  | { type: 'sellPlot'; player: PlayerId; plot: PlotId }
  /** Assemble plusieurs parcelles mitoyennes que le joueur possède en une seule, plus grande. */
  | { type: 'merge'; player: PlayerId; plots: PlotId[] }
  /** Règle le prix de vente d'une opération par rapport au marché (remise ou prime). */
  | { type: 'setPrice'; player: PlayerId; project: string; policy: number }
  | { type: 'launch'; player: PlayerId; plot: PlotId; criteria: Criteria }
  /** Le joueur a fini son tour ; quand tous le sont, le trimestre se résout. */
  | { type: 'ready'; player: PlayerId };

export type ActionResult = { ok: true; state: GameState } | { ok: false; error: string };
