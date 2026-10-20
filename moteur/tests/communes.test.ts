import { describe, expect, it } from 'vitest';
import { ARRONDISSEMENTS, estimateSeconds, marketFor } from '../src/app/communes';

describe('communes', () => {
  it('choisit le marché de référence selon le département et la taille', () => {
    expect(marketFor({ dept: '75', population: 2_100_000 })).toBe('paris');
    expect(marketFor({ dept: '93', population: 20_000 })).toBe('petite-couronne');
    expect(marketFor({ dept: '94', population: 27_000 })).toBe('petite-couronne');
    expect(marketFor({ dept: '77', population: 15_000 })).toBe('grande-couronne');
    expect(marketFor({ dept: '69', population: 150_000 })).toBe('grande-ville');
    expect(marketFor({ dept: '18', population: 63_000 })).toBe('grande-ville');
    expect(marketFor({ dept: '15', population: 2_000 })).toBe('ville-moyenne');
    expect(marketFor({ dept: '974', population: 40_000 })).toBe('ville-moyenne');
  });
  it('liste les arrondissements de Paris, Lyon et Marseille avec leurs codes cadastre et ventes', () => {
    expect(ARRONDISSEMENTS['75056'].list).toHaveLength(20);
    expect(ARRONDISSEMENTS['75056'].list[10]).toEqual({ arr: '111', name: 'Paris 11e', dvf: '75111' });
    expect(ARRONDISSEMENTS['69123'].list[6]).toEqual({ arr: '387', name: 'Lyon 7e', dvf: '69387' });
    expect(ARRONDISSEMENTS['13055'].list).toHaveLength(16);
    expect(ARRONDISSEMENTS['75056'].list[0].name).toBe('Paris 1er');
  });
  it('estime la durée de préparation selon le nombre de parcelles', () => {
    expect(estimateSeconds(7_000)).toBeGreaterThan(40);
    expect(estimateSeconds(7_000)).toBeLessThan(90);
  });
});
