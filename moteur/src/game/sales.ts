import type { GameState, ProjectPhase, ProjectRun } from './types';
import { zacPremium } from './zac';

/** Poids d'un programme auprès des acheteurs selon son avancement : sur plan, on hésite ; un immeuble livré rassure. */
export const STAGE_WEIGHT: Record<ProjectPhase, number> = { permis: 0.5, preventes: 0.8, chantier: 1, livraison: 1.25 };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Demande du quartier ce trimestre : nombre de logements que les ménages achètent, toutes opérations confondues.
 * Elle baisse quand le crédit coûte plus cher que d'habitude et pendant les retournements de marché (choc de demande).
 */
export function marketDemand(s: GameState): number {
  const c = s.config;
  const rate = clamp(1 - c.demandRateSensitivity * (s.interestRate - c.bilanParams.interestRate), 0.4, 1.3);
  return c.salesDemand * Math.max(0.2, 1 + s.demandShock) * rate;
}

/** Lots (logements, commerces, bureaux) pas encore vendus d'une opération. */
export const lotsLeft = (p: ProjectRun) => p.lots - p.lotsSold;

/** Prix d'un lot aujourd'hui : prix du lancement, suivi du marché, ajusté par la politique de prix de l'opération. */
export function lotPrice(s: GameState, p: ProjectRun): number {
  // Les logements sociaux sont déjà cédés ; le prix des autres lots est le prix du marché.
  return ((p.bilan.revenue.total - p.socialRevenue) / Math.max(1, p.lots - p.socialLots)) * (s.marketIndex / p.marketIndexAtLaunch) * (1 + p.pricePolicy) * (1 + zacPremium(s, p.terms?.zacId));
}

/** Part des lots vendus. */
export const soldShare = (p: ProjectRun) => p.lotsSold / p.lots;

/** Lots en vente dans le quartier, tous promoteurs confondus (l'offre concurrente). */
export const unitsOnOffer = (s: GameState) => s.projects.reduce((t, p) => t + lotsLeft(p), 0);

/**
 * Part de la demande que capte chaque opération : proportionnelle à ses lots restants, à son avancement, et d'autant
 * plus forte que son prix est bas par rapport au marché (élasticité). Retourne les ventes attendues par opération.
 */
export function expectedSales(s: GameState): Map<string, number> {
  const out = new Map<string, number>();
  const demand = marketDemand(s);
  const weights = s.projects.map((p) => ({ p, w: lotsLeft(p) > 0 ? lotsLeft(p) * STAGE_WEIGHT[p.phase] * Math.exp(-s.config.priceElasticity * p.pricePolicy) * (p.mixFit ?? 1) : 0 }));
  const total = weights.reduce((t, x) => t + x.w, 0);
  for (const { p, w } of weights) out.set(p.id, total > 0 ? Math.min(lotsLeft(p), (demand * w) / total) : 0);
  return out;
}

/** Durée écoulée (en trimestres) depuis le lancement, utile pour juger si les ventes suivent le rythme prévu. */
export const sellingPace = (p: ProjectRun) => (p.roundsRun > 0 ? p.lotsSold / p.lots / Math.min(1, p.roundsRun / Math.max(1, p.permitRounds + p.buildRounds)) : 1);
