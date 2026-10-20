import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA, LocalProjection, MARKETS, type Parcel, type Vec2 } from '../src/engine';
import { MAX_PRICE_POLICY, MIN_PRICE_POLICY, applyAction, createGame, expectedMargin, expectedSales, lotsLeft, marketDemand, netWorth, unitsOnOffer, type Action, type GameState } from '../src/game';

const O = new LocalProjection(2.35, 48.85);
const lot = (x: number): Parcel => ({
  ring: ([[x, 0], [x + 14, 0], [x + 14, 30], [x, 30]] as Vec2[]).map((p) => O.toLonLat(p)),
  streetEdges: [0],
});
const newGame = (config: Parameters<typeof createGame>[0]['config'] = {}) =>
  createGame({
    players: [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }],
    plots: [{ id: 'T1', parcel: lot(0) }, { id: 'T2', parcel: lot(30) }],
    config: { market: MARKETS['petite-couronne'], startCash: 20_000_000, marketVolatility: 0, eventChance: 0, holdingCostRate: 0, rateVolatility: 0, ...config },
    seed: 3,
  });
const play = (s: GameState, a: Action): GameState => {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const err = (s: GameState, a: Action) => {
  const r = applyAction(s, a);
  if (r.ok) throw new Error('action acceptée à tort');
  return r.error;
};
const both = (s: GameState) => play(play(s, { type: 'ready', player: 'a' }), { type: 'ready', player: 'b' });
const crit = { ...DEFAULT_CRITERIA, levels: 4 };
const launch = (s: GameState, who: 'a' | 'b', plot: string) => play(play(s, { type: 'buy', player: who, plot }), { type: 'launch', player: who, plot, criteria: crit });

describe('marge attendue d’une opération en cours', () => {
  it('suit le prix de vente choisi : une prime l’augmente, une remise la réduit, sans changement elle vaut la marge du lancement', () => {
    const s = launch(newGame(), 'a', 'T1');
    const base = expectedMargin(s, s.projects[0]);
    expect(base.margin).toBeCloseTo(s.projects[0].bilan.margin, 0);
    const up = expectedMargin(play(s, { type: 'setPrice', player: 'a', project: 'P1', policy: 0.1 }), play(s, { type: 'setPrice', player: 'a', project: 'P1', policy: 0.1 }).projects[0]);
    const down = expectedMargin(play(s, { type: 'setPrice', player: 'a', project: 'P1', policy: -0.1 }), play(s, { type: 'setPrice', player: 'a', project: 'P1', policy: -0.1 }).projects[0]);
    expect(up.margin).toBeGreaterThan(base.margin);
    expect(down.margin).toBeLessThan(base.margin);
    expect(up.rate).toBeGreaterThan(down.rate);
  });
});

describe('marché de l’immobilier : les logements se vendent au fil des trimestres', () => {
  it('à l’ouverture, rien n’est vendu ; la demande limite les ventes par trimestre', () => {
    let s = launch(newGame({ salesDemand: 2 }), 'a', 'T1');
    const run0 = s.projects[0];
    expect(run0.lotsSold).toBe(0);
    expect(run0.lots).toBeGreaterThan(5);
    for (let i = 0; i < 4; i++) s = both(s);
    const run = s.projects[0];
    // 2 logements par trimestre : jamais plus de 2 par tour, 8 au bout de 4 tours au plus (arrondi aléatoire inclus)
    expect(run.lotsSold).toBeGreaterThan(0);
    expect(run.lotsSold).toBeLessThanOrEqual(2 * 4 + 1);
  });

  it('la banque débloque le chantier à 35 % de préventes : sans acheteurs, l’opération reste bloquée et coûte des intérêts', () => {
    let s = launch(newGame({ salesDemand: 0.0001 }), 'a', 'T1');
    const cash = s.players[0].cash;
    const worth = netWorth(s, 'a');
    for (let i = 0; i < 12; i++) s = both(s);
    const run = s.projects[0];
    expect(run.phase).toBe('preventes');
    expect(run.lotsSold).toBeLessThan(run.lots * 0.35);
    expect(s.players[0].cash).toBeCloseTo(cash, 0); // aucun encaissement ni fonds propres versés
    expect(run.escrow).toBeCloseTo(run.installment * run.buildRounds, 4); // séquestre intact
    expect(run.roundsRun).toBe(12);
    expect(run.financed).toBe(false);
    // Le crédit n'est pas débloqué : le refinancement du terrain reste dû à la valeur nette (aucune perte artificielle).
    expect(Math.abs(netWorth(s, 'a') - worth)).toBeLessThan(worth * 0.02);
  });

  it('le terrain est refinancé dès le lancement ; au seuil de préventes la banque débloque le crédit des travaux : événement, chantier', () => {
    let s = launch(newGame({ salesDemand: 10_000 }), 'a', 'T1');
    const run = s.projects[0];
    expect(run.financed).toBe(false);
    expect(run.landRefund).toBe(0); // refinancé au lancement
    for (let i = 0; i < run.permitRounds; i++) s = both(s);
    expect(s.projects[0].financed).toBe(true);
    expect(s.projects[0].phase).toBe('chantier');
    expect(s.log.some((e) => /débloque le crédit/.test(e.text))).toBe(true);
  });

  it('le seuil de préventes par défaut est de 60 %', () => {
    expect(newGame().config.presaleThreshold).toBe(0.6);
  });

  it('avec une forte demande : permis, chantier avec appels de fonds, livraison, clôture ; trésorerie plate avant le chantier puis croissante', () => {
    let s = launch(newGame({ salesDemand: 10_000 }), 'a', 'T1');
    const run = s.projects[0];
    const cash: number[] = [s.players[0].cash];
    const debt: number[] = [run.loanOutstanding];
    const phases: string[] = [run.phase];
    while (s.projects.length) {
      s = both(s);
      cash.push(s.players[0].cash);
      debt.push(s.projects[0]?.loanOutstanding ?? 0);
      phases.push(s.projects[0]?.phase ?? 'clos');
    }
    expect(phases[0]).toBe('permis');
    expect(phases).toContain('chantier');
    expect(phases).toContain('livraison');
    expect(phases).not.toContain('preventes');
    const buildStart = run.permitRounds;
    // Permis : rien ne rentre ; à la fin du permis, les préventes suffisent et la banque refinance le terrain.
    for (let k = 1; k < buildStart; k++) expect(cash[k]).toBeCloseTo(cash[0], 4);
    expect(cash[buildStart]).toBeCloseTo(cash[0] + run.landRefund, 2);
    // Pendant le chantier, les appels de fonds remboursent la banque en priorité : la dette baisse à chaque trimestre.
    for (let k = buildStart + 1; k <= buildStart + run.buildRounds; k++) expect(debt[k]).toBeLessThan(debt[k - 1]);
    // Puis la trésorerie remonte une fois la dette soldée.
    expect(cash[cash.length - 1]).toBeGreaterThan(cash[0]);
    // Durée : permis + chantier + 1 trimestre de livraison.
    expect(phases.length - 1).toBe(run.permitRounds + run.buildRounds + 1);
  });

  it('les ventes lentes coûtent : durée et intérêts augmentent, le résultat baisse', () => {
    const result = (demand: number) => {
      let s = launch(newGame({ salesDemand: demand }), 'a', 'T1');
      const bilanMargin = s.projects[0].bilan.margin;
      let guard = 0;
      while (s.projects.length && guard++ < 80) s = both(s);
      return { cash: s.players[0].cash, rounds: s.round, bilanMargin, open: s.projects.length };
    };
    const fast = result(10_000);
    const slow = result(1);
    expect(slow.open).toBe(0);
    expect(slow.rounds).toBeGreaterThan(fast.rounds);
    expect(slow.cash).toBeLessThan(fast.cash);
  });

  it('plusieurs opérations se partagent la demande : l’offre concurrente ralentit chacune', () => {
    let s = newGame({ salesDemand: 4 });
    s = launch(s, 'a', 'T1');
    const alone = expectedSales(s).get('P1')!;
    s = launch(s, 'b', 'T2');
    const shared = expectedSales(s);
    expect(shared.get('P1')!).toBeLessThan(alone);
    expect([...shared.values()].reduce((t, x) => t + x, 0)).toBeLessThanOrEqual(marketDemand(s) + 1e-9);
    expect(unitsOnOffer(s)).toBe(s.projects.reduce((t, p) => t + lotsLeft(p), 0));
  });

  it('une remise attire les acheteurs, une prime les éloigne ; la politique de prix se règle par action', () => {
    let s = newGame({ salesDemand: 4 });
    s = launch(launch(s, 'a', 'T1'), 'b', 'T2');
    const even = expectedSales(s);
    expect(even.get('P1')!).toBeCloseTo(even.get('P2')!, 6);
    s = play(s, { type: 'setPrice', player: 'a', project: 'P1', policy: -0.1 });
    const withDiscount = expectedSales(s);
    expect(withDiscount.get('P1')!).toBeGreaterThan(withDiscount.get('P2')!);
    expect(err(s, { type: 'setPrice', player: 'b', project: 'P1', policy: 0 })).toMatch(/appartient/);
    expect(err(s, { type: 'setPrice', player: 'a', project: 'P9', policy: 0 })).toMatch(/inconnue/);
    s = play(s, { type: 'setPrice', player: 'a', project: 'P1', policy: -5 });
    expect(s.projects[0].pricePolicy).toBe(MIN_PRICE_POLICY);
    s = play(s, { type: 'setPrice', player: 'a', project: 'P1', policy: 5 });
    expect(s.projects[0].pricePolicy).toBe(MAX_PRICE_POLICY);
  });

  it('un lot vendu garde son prix quand le marché baisse ensuite', () => {
    let s = launch(newGame({ salesDemand: 10_000, marketReversion: 0 }), 'a', 'T1');
    s = both(s); // tout se vend au premier trimestre, au prix de lancement
    const sold = s.projects[0].soldRevenue;
    expect(s.projects[0].lotsSold).toBe(s.projects[0].lots);
    s = { ...s, marketIndex: 0.7 };
    s = both(s);
    expect(s.projects[0]?.soldRevenue ?? sold).toBeCloseTo(sold, 4);
  });

  it('les taux élevés et les retournements de marché réduisent la demande', () => {
    const s = newGame({ salesDemand: 20 });
    expect(marketDemand(s)).toBeCloseTo(20, 6);
    expect(marketDemand({ ...s, interestRate: s.interestRate + 0.03 })).toBeLessThan(20 * 0.8);
    expect(marketDemand({ ...s, demandShock: -0.35 })).toBeCloseTo(20 * 0.65, 6);
    expect(marketDemand({ ...s, demandShock: 0.25 })).toBeGreaterThan(20);
    // le choc s'estompe
    let g = s;
    g = { ...g, demandShock: -0.35 };
    for (let i = 0; i < 10; i++) g = both(g);
    expect(Math.abs(g.demandShock)).toBeLessThan(0.05);
  });

  it('la valeur nette ne bondit pas pendant les ventes, et la demande automatique dépend du nombre de parcelles', () => {
    let s = launch(newGame({ salesDemand: 10_000 }), 'a', 'T1');
    const w0 = netWorth(s, 'a');
    while (s.projects.length > 1 || (s.projects.length === 1 && s.projects[0].phase !== 'livraison')) {
      s = both(s);
      expect(Math.abs(netWorth(s, 'a') - w0)).toBeLessThan(w0 * 0.1);
    }
    expect(newGame().config.salesDemand).toBe(6); // plancher pour une petite carte
    const many = createGame({ players: [{ id: 'a', name: 'A' }], plots: Array.from({ length: 400 }, (_, i) => ({ id: `T${i}`, parcel: lot(i * 30), askingPrice: 100_000 })), config: { askMargin: 0.07 } });
    expect(many.config.salesDemand).toBe(12);
  });

  it('le bilan des opérations soldées est tenu à jour pour l’écran de fin de partie', () => {
    let s = launch(newGame({ salesDemand: 10_000 }), 'a', 'T1');
    expect(s.players[0].stats).toBeUndefined();
    while (s.projects.length) s = both(s);
    const st = s.players[0].stats!;
    expect(st.closed).toBe(1);
    expect(st.lots).toBeGreaterThan(5);
    expect(st.netTotal).toBeCloseTo(st.bestNet, 6);
    expect(st.bestNet).toBe(st.worstNet);
    expect(Number.isFinite(st.netTotal)).toBe(true);
    expect(JSON.parse(JSON.stringify(s)).players[0].stats).toEqual(st); // sérialisable
  });
});
