import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS, DEFAULT_CRITERIA, LocalProjection, MARKETS, computeBilan, computeProject, mixFit, promoterCriteria, typologyPriceFactor, type Parcel, type Typology, type Vec2 } from '../src/engine';
import { marketMix, marketStats, parseDvf, type DvfSale } from '../src/app/dvf';
import { marketOf } from '../src/game';

const HEAD = 'id_mutation,nature_mutation,valeur_fonciere,type_local,surface_reelle_bati,nombre_pieces_principales';
const csv = (rows: string[]) => [HEAD, ...rows].join('\n');

describe('lecture des ventes (DVF)', () => {
  it('ne garde que les ventes simples d’un appartement', () => {
    const sales = parseDvf(
      csv([
        'A,Vente,200000,Appartement,50,2', // gardée : 4 000 €/m²
        'B,Vente,300000,Maison,100,5', // maison : écartée
        'C,Vente,500000,Appartement,50,2', // deux locaux dans la même vente : écartée
        'C,Vente,500000,Appartement,60,3',
        'D,Echange,200000,Appartement,50,2', // pas une vente
        'E,Vente,5000,Appartement,50,2', // prix aberrant
        'F,Vente,180000,Appartement,3,1', // surface aberrante
        'G,Vente,260000,Appartement,65,3',
      ]),
      2024,
    );
    expect(sales.map((s) => s.rooms)).toEqual([2, 3]);
    expect(sales[0].pricePerM2).toBeCloseTo(4000);
  });

  it('un fichier sans les bonnes colonnes ne donne rien', () => {
    expect(parseDvf('a,b\n1,2', 2024)).toEqual([]);
  });
});

const sale = (rooms: number, area: number, ppm: number, year = 2024): DvfSale => ({ year, rooms, area, pricePerM2: ppm });

describe('statistiques de marché', () => {
  // 300 ventes : petits logements chers au m², grands moins chers
  const sales: DvfSale[] = [
    ...Array.from({ length: 60 }, () => sale(1, 28, 5000)),
    ...Array.from({ length: 90 }, () => sale(2, 45, 4500)),
    ...Array.from({ length: 90 }, () => sale(3, 65, 4000)),
    ...Array.from({ length: 50 }, () => sale(4, 85, 3500)),
    ...Array.from({ length: 10 }, () => sale(5, 105, 3200)),
  ];
  const stats = marketStats(sales, 'test');

  it('calcule le prix médian, les parts et les surfaces par typologie', () => {
    expect(stats.sales).toBe(300);
    expect(stats.pricePerM2).toBe(4250);
    expect(stats.byTypology.T3.pricePerM2).toBeGreaterThan(stats.byTypology.T5.pricePerM2);
    const shares = Object.values(stats.byTypology).reduce((s, t) => s + t.share, 0);
    expect(shares).toBeCloseTo(1);
    expect(stats.byTypology.T2.share).toBeGreaterThan(0.25);
  });

  it('avec peu de ventes, on reste proche de l’a priori (pas de T5 à 100 % parce qu’une vente en était un)', () => {
    const few = marketStats([sale(5, 110, 3000), sale(2, 40, 5000)], 'peu');
    expect(few.byTypology.T5.share).toBeLessThan(0.15);
    expect(few.byTypology.T3.share).toBeGreaterThan(0.25);
  });

  it('le mix et les prix relatifs gardent le prix moyen de la commune', () => {
    const { demandMix, typologyRatio } = marketMix(stats);
    expect(Object.values(demandMix).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 2);
    // moyenne des prix relatifs pondérée par la surface vendue = 1
    let a = 0;
    let w = 0;
    for (const t of Object.keys(demandMix) as Typology[]) {
      a += demandMix[t] * stats.byTypology[t].area;
      w += demandMix[t] * stats.byTypology[t].area * typologyRatio[t];
    }
    expect(w / a).toBeCloseTo(1, 2);
    expect(typologyRatio.T1).toBeGreaterThan(typologyRatio.T5);
  });
});

const O = new LocalProjection(2.35, 48.85);
const rect = (w: number, d: number): Parcel => ({ ring: ([[0, 0], [w, 0], [w, d], [0, d]] as Vec2[]).map((p) => O.toLonLat(p)), streetEdges: [0] });
const mk = (mix: Record<Typology, number>) => ({ ...DEFAULT_CRITERIA, levels: 4, mix });
const market = { ...MARKETS['petite-couronne'], typologyRatio: { T1: 1.15, T2: 1.05, T3: 1.0, T4: 0.92, T5: 0.85 } as Record<Typology, number> };

describe('répartition des logements et prix', () => {
  it('des petits logements rapportent plus par m² que des grands, à surface égale', () => {
    const small = computeProject(rect(16, 24), mk({ T1: 0.5, T2: 0.5, T3: 0, T4: 0, T5: 0 }));
    const large = computeProject(rect(16, 24), mk({ T1: 0, T2: 0, T3: 0, T4: 0.5, T5: 0.5 }));
    expect(typologyPriceFactor(small, market)).toBeGreaterThan(1);
    expect(typologyPriceFactor(large, market)).toBeLessThan(1);
    const bs = computeBilan({ project: small, market, landPrice: 0 });
    const bl = computeBilan({ project: large, market, landPrice: 0 });
    expect(bs.revenue.housing / small.indicators.shab).toBeGreaterThan(bl.revenue.housing / large.indicators.shab);
    expect(small.indicators.dwellings).toBeGreaterThan(large.indicators.dwellings * 1.8);
  });

  it('sans prix par typologie, rien ne change', () => {
    const p = computeProject(rect(16, 24), mk({ T1: 0.5, T2: 0.5, T3: 0, T4: 0, T5: 0 }));
    expect(typologyPriceFactor(p, MARKETS['petite-couronne'])).toBe(1);
  });

  it('le nombre de logements suit la surface : un étage de ~300 m² habitables donne 5 à 6 logements au mix standard', () => {
    const p = computeProject(rect(20, 22), { ...DEFAULT_CRITERIA, levels: 2, mix: { T1: 0.1, T2: 0.35, T3: 0.4, T4: 0.15, T5: 0 } });
    const upper = p.levels.filter((l) => l.kind === 'etage');
    for (const l of upper) {
      const shab = l.usable * DEFAULT_ASSUMPTIONS.shabRatio;
      expect(l.dwellings).toBeGreaterThanOrEqual(Math.floor(shab / 70));
      expect(l.dwellings).toBeLessThanOrEqual(Math.ceil(shab / 45));
    }
    expect(p.dwellings.reduce((s, d) => s + d.area, 0)).toBeCloseTo(p.indicators.shab, 5);
  });

  it('la répartition obtenue suit le mix demandé', () => {
    const p = computeProject(rect(24, 30), { ...DEFAULT_CRITERIA, levels: 5, mix: { T1: 0.1, T2: 0.35, T3: 0.4, T4: 0.15, T5: 0 } });
    const n = p.indicators.dwellings;
    expect(p.typologyCounts.T5).toBe(0);
    expect(Math.abs(p.typologyCounts.T3 / n - 0.4)).toBeLessThan(0.08);
    expect(Math.abs(p.typologyCounts.T2 / n - 0.35)).toBeLessThan(0.08);
  });
});

describe('adéquation au marché', () => {
  const demand: Record<Typology, number> = { T1: 0.15, T2: 0.35, T3: 0.3, T4: 0.15, T5: 0.05 };
  it('vaut 1 quand le programme est celui du marché, moins sinon', () => {
    expect(mixFit({ T1: 15, T2: 35, T3: 30, T4: 15, T5: 5 }, demand)).toBeCloseTo(1);
    const off = mixFit({ T1: 0, T2: 0, T3: 0, T4: 0, T5: 20 }, demand);
    expect(off).toBeLessThan(0.75);
    expect(off).toBeGreaterThanOrEqual(0.6);
    expect(mixFit({ T1: 5, T2: 5, T3: 5, T4: 5, T5: 0 }, undefined)).toBe(1);
  });
});

describe('marché d’un quartier', () => {
  it('complète le marché de référence avec le mix et les prix du quartier', () => {
    const m = marketOf({ market: 'grande-couronne', demandMix: { T1: 0.1, T2: 0.2, T3: 0.4, T4: 0.2, T5: 0.1 }, typologyRatio: { T1: 1.2, T2: 1.1, T3: 1, T4: 0.9, T5: 0.8 } });
    expect(m.housingPerShab).toBe(MARKETS['grande-couronne'].housingPerShab);
    expect(m.demandMix!.T3).toBe(0.4);
    expect(promoterCriteria(m).mix.T3).toBe(0.4);
    expect(promoterCriteria(MARKETS['paris']).mix).toEqual(DEFAULT_CRITERIA.mix);
  });
});
