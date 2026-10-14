import type { Project } from './types';

/**
 * Bilan du promoteur : de `Project` (ce que le terrain permet) à une marge (ce que l'opération rapporte).
 * Module pur et déterministe. Tous les montants sont en euros HT ; les prix sont des ordres de grandeur
 * inspirés du marché français, pas des valeurs d'expertise.
 */

export interface Market {
  name: string;
  /** Prix de vente des logements, €/m² de surface habitable (SHAB), HT. */
  housingPerShab: number;
  /** Prix de vente des commerces et bureaux, €/m² de SDP, HT. */
  commercePerSdp: number;
  officePerSdp: number;
  /** Prix de vente d'une place de stationnement (sous-sol / rez-de-chaussée, extérieur), HT. */
  parkingBasementSpace: number;
  parkingOtherSpace: number;
  /** Coût de construction, €/m² de SDP, HT. */
  buildHousingPerSdp: number;
  buildCommercePerSdp: number;
  buildOfficePerSdp: number;
  /** Achat d'une place dans un parking voisin (concession, copropriété), €. */
  offsiteParkingPlace: number;
  /** Coût d'une place : sous-sol (terrassement, structure, rampe) ou en surface. */
  buildBasementSpace: number;
  buildOtherSpace: number;
  /** Démolition de l'existant, €/m² de SDP démolie. */
  demolitionPerSdp: number;
  /**
   * Coûts fixes d'une opération, quelle que soit sa taille : étude de sol, géomètre, diagnostics (amiante, plomb),
   * dossier de permis, garantie financière d'achèvement, raccordements aux réseaux, installation et base de chantier.
   * C'est ce qui rend les très petites opérations déficitaires.
   */
  fixedCostPerOperation: number;
  /** Charge foncière « normale » du quartier, €/m² de SDP constructible (sert à proposer un prix de terrain). */
  landPerSdp: number;
}

export const MARKETS = {
  paris: {
    name: 'Paris',
    housingPerShab: 13_000,
    commercePerSdp: 9_500,
    officePerSdp: 10_000,
    parkingBasementSpace: 40_000,
    parkingOtherSpace: 20_000,
    buildHousingPerSdp: 2_300,
    buildCommercePerSdp: 1_900,
    buildOfficePerSdp: 2_400,
    offsiteParkingPlace: 45_000,
    buildBasementSpace: 38_000,
    buildOtherSpace: 5_000,
    demolitionPerSdp: 200,
    fixedCostPerOperation: 150_000,
    landPerSdp: 3_200,
  },
  'petite-couronne': {
    name: 'Petite couronne',
    housingPerShab: 6_500,
    commercePerSdp: 4_500,
    officePerSdp: 5_000,
    parkingBasementSpace: 22_000,
    parkingOtherSpace: 10_000,
    buildHousingPerSdp: 2_000,
    buildCommercePerSdp: 1_700,
    buildOfficePerSdp: 2_100,
    offsiteParkingPlace: 20_000,
    buildBasementSpace: 30_000,
    buildOtherSpace: 4_000,
    demolitionPerSdp: 170,
    fixedCostPerOperation: 90_000,
    landPerSdp: 750,
  },
  'grande-ville': {
    name: 'Grande ville de province',
    housingPerShab: 5_000,
    commercePerSdp: 3_300,
    officePerSdp: 3_500,
    parkingBasementSpace: 16_000,
    parkingOtherSpace: 7_000,
    buildHousingPerSdp: 1_850,
    buildCommercePerSdp: 1_550,
    buildOfficePerSdp: 1_900,
    offsiteParkingPlace: 14_000,
    buildBasementSpace: 26_000,
    buildOtherSpace: 3_500,
    demolitionPerSdp: 140,
    fixedCostPerOperation: 65_000,
    landPerSdp: 280,
  },
  'ville-moyenne': {
    name: 'Ville moyenne',
    housingPerShab: 3_400,
    commercePerSdp: 2_300,
    officePerSdp: 2_400,
    parkingBasementSpace: 8_000,
    parkingOtherSpace: 5_000,
    buildHousingPerSdp: 1_600,
    buildCommercePerSdp: 1_400,
    buildOfficePerSdp: 1_700,
    offsiteParkingPlace: 8_000,
    buildBasementSpace: 16_000,
    buildOtherSpace: 3_000,
    demolitionPerSdp: 120,
    fixedCostPerOperation: 45_000,
    landPerSdp: 100,
  },
} as const satisfies Record<string, Market>;

export type MarketId = keyof typeof MARKETS;

export interface BilanParams {
  /** Frais de notaire et droits sur le terrain (≈ 7,5 % dans l'ancien). */
  acquisitionFeeRate: number;
  /** Études, architecte, bureaux de contrôle, géomètre : % des travaux. */
  designFeeRate: number;
  /** Assurance dommages-ouvrage et divers : % des travaux. */
  insuranceRate: number;
  /** Aléas de chantier : % des travaux. */
  contingencyRate: number;
  /** Taxe d'aménagement et participations, €/m² de SDP. */
  taxPerSdp: number;
  /** Commercialisation (agence, marketing) : % du chiffre d'affaires. */
  salesFeeRate: number;
  /** Gestion de l'opération (équipe, compta, juridique) : % du chiffre d'affaires. */
  overheadRate: number;
  /** Part du coût du terrain et des travaux financée par emprunt (le reste en fonds propres). */
  loanShare: number;
  /** Taux annuel du crédit promoteur. */
  interestRate: number;
  /** Délai d'obtention du permis après achat (mois). */
  permitMonths: number;
  /** Durée de chantier : base + par niveau hors sol + par niveau de sous-sol (mois). */
  buildBaseMonths: number;
  buildMonthsPerLevel: number;
  buildMonthsPerBasement: number;
  /** Écoulement des dernières ventes après livraison (mois). */
  sellOutMonths: number;
  /** Marge visée, en % du chiffre d'affaires : sert à calculer le prix de terrain maximal. */
  targetMargin: number;
}

export const DEFAULT_BILAN_PARAMS: BilanParams = {
  acquisitionFeeRate: 0.075,
  designFeeRate: 0.12,
  insuranceRate: 0.02,
  contingencyRate: 0.05,
  taxPerSdp: 100,
  salesFeeRate: 0.04,
  overheadRate: 0.03,
  loanShare: 0.8,
  interestRate: 0.045,
  permitMonths: 6,
  buildBaseMonths: 6,
  buildMonthsPerLevel: 1,
  buildMonthsPerBasement: 2,
  sellOutMonths: 3,
  targetMargin: 0.1,
};

export interface BilanInput {
  project: Project;
  market: Market;
  /** Prix payé pour le terrain (bâti existant compris), €. */
  landPrice: number;
  /** SDP du bâti existant à démolir avant de construire (m²). */
  existingSdp?: number;
  params?: Partial<BilanParams>;
}

export interface Bilan {
  revenue: { housing: number; commerce: number; office: number; parking: number; total: number };
  costs: {
    land: number;
    acquisitionFees: number;
    demolition: number;
    works: number;
    design: number;
    fixed: number;
    insurance: number;
    contingency: number;
    taxes: number;
    salesFees: number;
    overhead: number;
    financing: number;
    total: number;
  };
  margin: number;
  /** Marge / chiffre d'affaires. */
  marginRate: number;
  /** Marge / coût total (« marge sur prix de revient »). */
  returnOnCost: number;
  /** Fonds propres engagés (au pic, avant crédit). */
  equity: number;
  /** Durée de l'opération, de l'achat à la dernière vente. */
  months: number;
  quarters: number;
  /** Prix de terrain maximal pour atteindre la marge visée. Peut être ≤ 0 : opération non viable à ce marché. */
  maxLandPrice: number;
  /** Prix de vente (€/m² SHAB) à partir duquel la marge est nulle. */
  breakEvenHousingPerShab: number;
  viable: boolean;
}

const sumLevels = (p: Project, use: 'logement' | 'commerce' | 'bureaux') =>
  use === 'logement' ? p.indicators.sdpHousing : use === 'commerce' ? p.indicators.sdpCommerce : p.indicators.sdpOffice;

/** Prix de terrain « normal » du marché pour ce que le terrain permet (point de départ d'une négociation). */
export function suggestLandPrice(project: Project, market: Market): number {
  return Math.round(project.indicators.sdpTotal * market.landPerSdp);
}

export function buildDuration(project: Project, p: BilanParams): { permit: number; build: number; sellOut: number; total: number } {
  const above = Math.max(0, project.levels.filter((l) => l.kind !== 'attique' && l.use !== 'parking').length);
  const build = Math.ceil(p.buildBaseMonths + p.buildMonthsPerLevel * above + p.buildMonthsPerBasement * project.parking.basementLevels);
  return { permit: p.permitMonths, build, sellOut: p.sellOutMonths, total: p.permitMonths + build + p.sellOutMonths };
}

export function computeBilan(input: BilanInput): Bilan {
  const { project, market, landPrice } = input;
  const p: BilanParams = { ...DEFAULT_BILAN_PARAMS, ...input.params };
  const ind = project.indicators;
  const pk = project.parking;

  // Chiffre d'affaires
  const housing = ind.shab * market.housingPerShab;
  const commerce = sumLevels(project, 'commerce') * market.commercePerSdp;
  const office = sumLevels(project, 'bureaux') * market.officePerSdp;
  const parking = pk.basement * market.parkingBasementSpace + (pk.rdc + pk.surface) * market.parkingOtherSpace;
  const revenueTotal = housing + commerce + office + parking;

  // Coûts directs
  const works =
    ind.sdpHousing * market.buildHousingPerSdp +
    ind.sdpCommerce * market.buildCommercePerSdp +
    ind.sdpOffice * market.buildOfficePerSdp +
    pk.basement * market.buildBasementSpace +
    (pk.rdc + pk.surface) * market.buildOtherSpace +
    pk.offsite * market.offsiteParkingPlace;
  const demolition = (input.existingSdp ?? 0) * market.demolitionPerSdp;
  const acquisitionFees = landPrice * p.acquisitionFeeRate;
  const design = works * p.designFeeRate;
  const fixed = ind.sdpTotal > 0 ? market.fixedCostPerOperation : 0;
  const insurance = works * p.insuranceRate;
  const contingency = works * p.contingencyRate;
  const taxes = ind.sdpTotal * p.taxPerSdp;
  const salesFees = revenueTotal * p.salesFeeRate;
  const overhead = revenueTotal * p.overheadRate;

  // Frais financiers : le terrain est emprunté dès l'achat jusqu'à la dernière vente ; les travaux et frais liés
  // sont tirés progressivement (en moyenne à moitié) pendant le chantier, puis courent jusqu'à la fin des ventes.
  const d = buildDuration(project, p);
  const rate = p.interestRate / 12;
  const landLoan = (landPrice + acquisitionFees) * p.loanShare;
  const buildSpend = works + demolition + fixed + design + insurance + contingency + taxes;
  const buildLoan = buildSpend * p.loanShare;
  const financing = landLoan * rate * d.total + buildLoan * rate * (d.build / 2 + d.sellOut);

  const costTotal = landPrice + acquisitionFees + demolition + works + fixed + design + insurance + contingency + taxes + salesFees + overhead + financing;
  const margin = revenueTotal - costTotal;
  const marginRate = revenueTotal > 0 ? margin / revenueTotal : 0;
  const returnOnCost = costTotal > 0 ? margin / costTotal : 0;
  const equity = (landPrice + acquisitionFees + buildSpend) * (1 - p.loanShare);

  // Terrain maximal : on résout margin(land) = targetMargin × CA. Les coûts sont affines en `landPrice` :
  // coût(land) = hors terrain + land × (1 + frais) × (1 + loanShare × taux × durée).
  const landCoefExact = (1 + p.acquisitionFeeRate) * (1 + p.loanShare * rate * d.total);
  const nonLandCosts = costTotal - landPrice * landCoefExact;
  const maxLandPrice = Math.floor((revenueTotal * (1 - p.targetMargin) - nonLandCosts) / landCoefExact);

  // Seuil de rentabilité : le CA logement est proportionnel au prix au m² ; les frais de vente/gestion aussi.
  const feeRate = p.salesFeeRate + p.overheadRate;
  const nonHousingRevenue = commerce + office + parking;
  const costsWithoutFees = costTotal - salesFees - overhead;
  const breakEvenRevenue = costsWithoutFees / (1 - feeRate);
  const breakEvenHousingPerShab = ind.shab > 0 ? Math.max(0, breakEvenRevenue - nonHousingRevenue) / ind.shab : Infinity;

  return {
    revenue: { housing, commerce, office, parking, total: revenueTotal },
    costs: { land: landPrice, acquisitionFees, demolition, works, fixed, design, insurance, contingency, taxes, salesFees, overhead, financing, total: costTotal },
    margin,
    marginRate,
    returnOnCost,
    equity,
    months: d.total,
    quarters: Math.ceil(d.total / 3),
    maxLandPrice,
    breakEvenHousingPerShab,
    viable: marginRate >= p.targetMargin,
  };
}
