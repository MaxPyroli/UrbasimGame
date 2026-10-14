import type { Difficulty, GameConfig } from './types';

/**
 * Mode « campagne » : les règles de jeu complètes (marché foncier avec enchères, frais de structure, découvert et
 * faillite, objectif). Le moteur seul garde des règles simples par défaut (achat immédiat, pas de frais de structure)
 * pour que ses calculs restent faciles à tester ; le jeu applique l'un de ces niveaux de difficulté.
 */
export interface DifficultyPreset {
  label: string;
  summary: string;
  config: Partial<GameConfig>;
}

const BASE: Partial<GameConfig> = {
  landMarket: 'auction',
  auctionRounds: 2,
  listingShare: 0.03,
  debtSpread: 0.03,
  communeTenders: true,
  municipalPlots: 6,
  tenderRounds: 3,
  tenderEvery: 3,
};

export const DIFFICULTIES: Record<Difficulty, DifficultyPreset> = {
  facile: {
    label: 'Facile',
    summary: 'Plus de trésorerie, marché calme, propriétaires accommodants. Objectif : ×1,4 votre mise.',
    config: { ...BASE, difficulty: 'facile', goalMultiple: 1.4, startCashFactor: 1.25, structureCostRate: 0.002, marketVolatility: 0.02, eventChance: 0.3, reserveSpread: 0.12 },
  },
  normal: {
    label: 'Normal',
    summary: 'Marché et aléas réalistes. Objectif : ×1,7 votre mise.',
    config: { ...BASE, difficulty: 'normal', goalMultiple: 1.7, startCashFactor: 1, structureCostRate: 0.004, reserveSpread: 0.2 },
  },
  difficile: {
    label: 'Difficile',
    summary: 'Trésorerie serrée, marché nerveux, propriétaires exigeants. Objectif : ×2,2 votre mise.',
    config: { ...BASE, difficulty: 'difficile', goalMultiple: 2.2, startCashFactor: 0.85, structureCostRate: 0.006, marketVolatility: 0.04, eventChance: 0.5, rateVolatility: 0.006, reserveSpread: 0.3 },
  },
};

/** Configuration d'une partie en mode campagne pour un niveau de difficulté. */
export const campaignConfig = (d: Difficulty = 'normal'): Partial<GameConfig> => ({ ...DIFFICULTIES[d].config });
