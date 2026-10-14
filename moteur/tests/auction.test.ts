import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA, LocalProjection, MARKETS, type Parcel, type Vec2 } from '../src/engine';
import {
  DIFFICULTIES,
  applyAction,
  campaignConfig,
  charge,
  committedCash,
  createGame,
  credit,
  netWorth,
  offerOf,
  offersOn,
  playBots,
  reserveFactor,
  type Action,
  type GameState,
} from '../src/game';

const O = new LocalProjection(2.35, 48.85);
const lot = (i: number): Parcel => ({
  ring: ([[i * 20, 0], [i * 20 + 14, 0], [i * 20 + 14, 30], [i * 20, 30]] as Vec2[]).map((p) => O.toLonLat(p)),
  streetEdges: [0],
});
const PLOTS = Array.from({ length: 6 }, (_, i) => ({ id: `T${i}`, parcel: lot(i), askingPrice: 400_000 }));
const players = [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }, { id: 'c', name: 'Cyril' }];
const make = (over: Parameters<typeof createGame>[0]['config'] = {}) =>
  createGame({
    players,
    plots: PLOTS,
    config: { market: MARKETS['petite-couronne'], startCash: 3_000_000, landMarket: 'auction', listingShare: 1, eventChance: 0, marketVolatility: 0, rateVolatility: 0, holdingCostRate: 0, salesDemand: 100, ...over },
    seed: 4,
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
const next = (s: GameState) => players.reduce((st, p) => (st.over || st.players.find((x) => x.id === p.id)!.bankrupt ? st : play(st, { type: 'ready', player: p.id })), s);
const cash = (s: GameState, id: string) => s.players.find((p) => p.id === id)!.cash;

describe('marché foncier : enchères et prospection', () => {
  it('le marché ouvre avec des terrains mis en vente, et l’achat au prix affiché n’existe plus', () => {
    const s = make();
    expect(s.plots.every((p) => p.listing)).toBe(true);
    expect(s.plots[0].listing!.minPrice).toBe(400_000);
    expect(err(s, { type: 'buy', player: 'a', plot: 'T0' })).toMatch(/offre/);
  });

  it('le plus offrant l’emporte, paie son prix et les frais, les perdants sont remboursés', () => {
    let s = make();
    const start = cash(s, 'a');
    s = play(s, { type: 'offer', player: 'a', plot: 'T0', price: 450_000 });
    s = play(s, { type: 'offer', player: 'b', plot: 'T0', price: 520_000 });
    s = play(s, { type: 'offer', player: 'c', plot: 'T0', price: 410_000 });
    expect(offersOn(s, 'T0')).toHaveLength(3);
    expect(cash(s, 'a')).toBeCloseTo(start - 450_000 * 1.075, 0); // somme bloquée
    expect(committedCash(s, 'a')).toBeCloseTo(450_000 * 1.075, 0);
    s = next(s); // trimestre 1 : encore ouvert
    expect(s.plots[0].owner).toBeNull();
    s = next(s); // trimestre 2 : échéance
    const plot = s.plots[0];
    expect(plot.owner).toBe('b');
    expect(plot.paid).toBeCloseTo(520_000 * 1.075, 0);
    expect(cash(s, 'a')).toBeCloseTo(start, 0); // remboursé
    expect(cash(s, 'c')).toBeCloseTo(start, 0);
    expect(cash(s, 'b')).toBeCloseTo(start - 520_000 * 1.075, 0);
    expect(s.offers.filter((o) => o.plot === 'T0')).toHaveLength(0);
    expect(s.log.some((e) => /Bob remporte/.test(e.text) && /3 offres/.test(e.text))).toBe(true);
    expect(s.log.some((e) => e.player === 'a' && /Vous perdez/.test(e.text))).toBe(true);
  });

  it('à prix égal, le premier arrivé l’emporte', () => {
    let s = make();
    s = play(s, { type: 'offer', player: 'c', plot: 'T1', price: 500_000 });
    s = play(s, { type: 'offer', player: 'a', plot: 'T1', price: 500_000 });
    s = next(next(s));
    expect(s.plots[1].owner).toBe('c');
  });

  it('remplacer une offre ajuste la somme bloquée ; la retirer rend tout', () => {
    let s = make();
    const start = cash(s, 'a');
    s = play(s, { type: 'offer', player: 'a', plot: 'T2', price: 450_000 });
    s = play(s, { type: 'offer', player: 'a', plot: 'T2', price: 600_000 });
    expect(offersOn(s, 'T2')).toHaveLength(1);
    expect(committedCash(s, 'a')).toBeCloseTo(600_000 * 1.075, 0);
    expect(cash(s, 'a')).toBeCloseTo(start - 600_000 * 1.075, 0);
    s = play(s, { type: 'withdraw', player: 'a', plot: 'T2' });
    expect(cash(s, 'a')).toBeCloseTo(start, 0);
    expect(err(s, { type: 'withdraw', player: 'a', plot: 'T2' })).toMatch(/pas d’offre/);
  });

  it('refuse une offre sous le prix de mise en vente ou au-delà de la trésorerie', () => {
    const s = make();
    expect(err(s, { type: 'offer', player: 'a', plot: 'T0', price: 300_000 })).toMatch(/trop basse/);
    expect(err(s, { type: 'offer', player: 'a', plot: 'T0', price: 9_000_000 })).toMatch(/fonds insuffisants/);
    expect(err(s, { type: 'offer', player: 'a', plot: 'T0', price: Number.NaN })).toMatch(/invalide/);
  });

  it('l’argent bloqué par les offres compte dans le patrimoine, et s’engage : plusieurs offres épuisent la trésorerie', () => {
    let s = make({ startCash: 1_300_000 });
    const w0 = netWorth(s, 'a');
    s = play(s, { type: 'offer', player: 'a', plot: 'T0', price: 600_000 });
    expect(netWorth(s, 'a')).toBeCloseTo(w0, 0);
    s = play(s, { type: 'offer', player: 'a', plot: 'T1', price: 600_000 });
    expect(err(s, { type: 'offer', player: 'a', plot: 'T2', price: 400_000 })).toMatch(/fonds insuffisants/);
  });

  it('un terrain qui n’est pas en vente se prospecte : frais non remboursés, résolu en un trimestre, accepté seulement si le propriétaire est satisfait', () => {
    // un seul terrain en vente ; les autres se prospectent
    let s = make({ listingShare: 0, reserveSpread: 0.2 });
    const unlisted = s.plots.filter((p) => !p.listing);
    expect(unlisted.length).toBeGreaterThan(3);
    const p = unlisted[0];
    // trop bas : refusé
    const start = cash(s, 'a');
    const low = Math.round(p.askingPrice * 0.9);
    expect(err(s, { type: 'offer', player: 'a', plot: p.id, price: Math.round(p.askingPrice * 0.5) })).toMatch(/trop basse/);
    s = play(s, { type: 'offer', player: 'a', plot: p.id, price: low });
    expect(cash(s, 'a')).toBeLessThan(start - low); // frais de prospection en plus
    const withFee = cash(s, 'a');
    s = next(s);
    expect(s.plots.find((x) => x.id === p.id)!.owner).toBeNull();
    expect(cash(s, 'a')).toBeCloseTo(withFee + low * 1.075, 0); // somme rendue, frais perdus
    expect(s.log.some((e) => e.player === 'a' && /pas vendeur/.test(e.text))).toBe(true);
    // assez haut : accepté dès la fin du trimestre (partie neuve : le marché ne mélange pas les cas)
    let t = make({ listingShare: 0, reserveSpread: 0.2 });
    const q = t.plots.filter((x) => !x.listing)[0];
    const enough = Math.ceil(q.askingPrice * reserveFactor(q, 0.2)) + 1;
    t = play(t, { type: 'offer', player: 'a', plot: q.id, price: enough });
    t = next(t);
    expect(t.plots.find((x) => x.id === q.id)!.owner).toBe('a');
  });

  it('les terrains non vendus reviennent sur le marché et de nouveaux sont mis en vente chaque trimestre', () => {
    let s = make({ listingShare: 0.34 });
    const listed0 = s.plots.filter((p) => p.listing).length;
    expect(listed0).toBeGreaterThan(0);
    s = next(next(s)); // échéance sans offre : mises en vente closes, d'autres ouvertes
    expect(s.plots.some((p) => p.listing)).toBe(true);
    expect(s.plots.every((p) => !p.listing || p.listing.until > s.round)).toBe(true);
  });

  it('l’enchère est reproductible : mêmes actions, même graine, même résultat', () => {
    const run = () => {
      let s = make({ listingShare: 0.5 });
      s = play(s, { type: 'offer', player: 'a', plot: s.plots.find((p) => p.listing)!.id, price: 700_000 });
      for (let i = 0; i < 6; i++) s = next(s);
      return s;
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it('une offre sur un terrain acquis puis lancé en projet reste cohérente : le gagnant peut lancer', () => {
    let s = make();
    s = play(s, { type: 'offer', player: 'a', plot: 'T3', price: 450_000 });
    s = next(next(s));
    s = play(s, { type: 'launch', player: 'a', plot: 'T3', criteria: { ...DEFAULT_CRITERIA, levels: 2 } });
    expect(s.projects).toHaveLength(1);
  });
});

describe('concurrents ordinateur aux enchères', () => {
  it('les bots déposent des offres, remportent des terrains et la partie va au bout sans incohérence', () => {
    const plots = Array.from({ length: 30 }, (_, i) => ({ id: `P${i}`, parcel: lot(i), askingPrice: 350_000 + (i % 5) * 40_000 }));
    let s = createGame({
      players: [{ id: 'p', name: 'P', bot: true, profile: 'prudent' }, { id: 'e', name: 'E', bot: true }, { id: 'a', name: 'A', bot: true, profile: 'agressif' }],
      plots,
      config: { market: MARKETS['petite-couronne'], rounds: 20, ...campaignConfig('normal'), startCash: 3_500_000 },
      seed: 11,
    });
    let sawOffers = false;
    while (!s.over) {
      s = playBots(s);
      if (s.offers.length) sawOffers = true;
      for (const p of s.players) {
        expect(p.cash).toBeGreaterThanOrEqual(-1e-6);
        expect(p.debt).toBeGreaterThanOrEqual(0);
      }
    }
    expect(sawOffers).toBe(true);
    expect(s.log.some((e) => /remporte/.test(e.text))).toBe(true);
    // les enchères avec plusieurs offres existent
    expect(s.log.some((e) => /\d+ offres/.test(e.text))).toBe(true);
  });
});

describe('dettes et faillite', () => {
  const idle = () => make({ listingShare: 0, structureCostRate: 0.02 });

  it('les frais de structure pèsent chaque trimestre : un joueur passif perd de l’argent', () => {
    let s = idle();
    const start = netWorth(s, 'a');
    expect(s.config.structureCost).toBe(60_000);
    s = next(next(next(s)));
    expect(netWorth(s, 'a')).toBeCloseTo(start - 3 * 60_000, 0);
  });

  it('quand la trésorerie manque, les charges deviennent un découvert qui porte intérêt, et les encaissements le remboursent d’abord', () => {
    let s = idle();
    s = { ...s, players: s.players.map((p) => (p.id === 'a' ? { ...p, cash: 10_000 } : p)) };
    s = charge(s, 'a', 70_000);
    expect(s.players[0].cash).toBe(0);
    expect(s.players[0].debt).toBe(60_000);
    s = credit(s, 'a', 100_000);
    expect(s.players[0].debt).toBe(0);
    expect(s.players[0].cash).toBe(40_000);
    // intérêts du découvert au trimestre suivant
    let t = idle();
    t = { ...t, players: t.players.map((p) => (p.id === 'a' ? { ...p, cash: 1_000_000, debt: 100_000 } : p)) };
    t = next(t);
    // intérêts du découvert : (taux du crédit + 3 points) / 4 par trimestre ; les frais de structure se paient sur la trésorerie
    expect(t.players[0].debt).toBeCloseTo(100_000 * (1 + (0.045 + 0.03) / 4), 0);
    expect(t.players[0].cash).toBeCloseTo(1_000_000 - 60_000, 0);
  });

  it('la banque ne laisse rien engager à un joueur à découvert', () => {
    let s = idle();
    s = { ...s, players: s.players.map((p) => (p.id === 'a' ? { ...p, debt: 1_000 } : p)) };
    expect(err(s, { type: 'offer', player: 'a', plot: s.plots.find((p) => p.listing)!.id, price: 500_000 })).toMatch(/découvert/);
  });

  it('patrimoine négatif : faillite, la banque saisit tout, le joueur ne joue plus', () => {
    let s = make({ listingShare: 0.5, structureCostRate: 0.01 });
    const listed = s.plots.find((p) => p.listing)!;
    s = play(s, { type: 'offer', player: 'a', plot: listed.id, price: 500_000 });
    s = next(next(s)); // 'a' gagne le terrain si personne d'autre n'offre
    expect(s.plots.find((p) => p.id === listed.id)!.owner).toBe('a');
    s = { ...s, players: s.players.map((p) => (p.id === 'a' ? { ...p, cash: 0, debt: 5_000_000 } : p)) };
    s = next(s);
    const a = s.players.find((p) => p.id === 'a')!;
    expect(a.bankrupt).toBe(true);
    expect(a.cash).toBe(0);
    expect(a.debt).toBe(0);
    expect(s.plots.every((p) => p.owner !== 'a')).toBe(true);
    expect(netWorth(s, 'a')).toBe(0);
    expect(s.log.some((e) => /fait faillite/.test(e.text))).toBe(true);
    expect(err(s, { type: 'offer', player: 'a', plot: s.plots.find((p) => p.listing)!.id, price: 500_000 })).toMatch(/faillite/);
    // les autres continuent : le trimestre se résout sans attendre le failli
    const round = s.round;
    s = next(s);
    expect(s.round).toBe(round + 1);
  });

  it('la partie s’arrête quand plus aucun joueur humain n’est en lice', () => {
    let s = createGame({ players: [{ id: 'h', name: 'Humain' }, { id: 'b', name: 'Bot', bot: true }], plots: PLOTS, config: { market: MARKETS['petite-couronne'], startCash: 1_000_000, landMarket: 'auction', eventChance: 0 } });
    s = { ...s, players: s.players.map((p) => (p.id === 'h' ? { ...p, cash: 0, debt: 3_000_000 } : p)) };
    s = playBots(s);
    s = play(s, { type: 'ready', player: 'h' });
    expect(s.players.find((p) => p.id === 'h')!.bankrupt).toBe(true);
    expect(s.over).toBe(true);
  });

  it('un offre en cours est rendue en cas de faillite (aucun argent ne disparaît)', () => {
    let s = make({ listingShare: 1 });
    s = play(s, { type: 'offer', player: 'a', plot: 'T0', price: 500_000 });
    s = { ...s, players: s.players.map((p) => (p.id === 'a' ? { ...p, debt: 99_000_000 } : p)) };
    s = next(s);
    expect(offerOf(s, 'T0', 'a')).toBeUndefined();
    expect(s.players.find((p) => p.id === 'a')!.bankrupt).toBe(true);
  });
});

describe('difficulté et objectif', () => {
  it('trois niveaux avec un objectif croissant et des règles de plus en plus dures', () => {
    const f = DIFFICULTIES.facile.config;
    const n = DIFFICULTIES.normal.config;
    const d = DIFFICULTIES.difficile.config;
    expect(f.goalMultiple!).toBeLessThan(n.goalMultiple!);
    expect(n.goalMultiple!).toBeLessThan(d.goalMultiple!);
    expect(f.startCashFactor!).toBeGreaterThan(d.startCashFactor!);
    expect(f.structureCostRate!).toBeLessThan(d.structureCostRate!);
    expect(d.marketVolatility!).toBeGreaterThan(f.marketVolatility!);
    for (const k of ['facile', 'normal', 'difficile'] as const) expect(campaignConfig(k).landMarket).toBe('auction');
  });

  it('la partie applique le niveau : trésorerie de départ, frais de structure, objectif', () => {
    const mk = (d: 'facile' | 'normal' | 'difficile') =>
      createGame({ players: [{ id: 'a', name: 'A' }], plots: PLOTS, config: { market: MARKETS['petite-couronne'], ...campaignConfig(d) }, seed: 1 });
    const f = mk('facile');
    const nn = mk('normal');
    const d = mk('difficile');
    expect(f.config.startCash).toBeGreaterThan(nn.config.startCash);
    expect(nn.config.startCash).toBeGreaterThan(d.config.startCash);
    expect(f.config.goalMultiple).toBe(1.4);
    expect(d.config.structureCost).toBeGreaterThan(nn.config.structureCost);
    expect(nn.config.structureCost).toBeGreaterThan(f.config.structureCost);
    expect(nn.config.difficulty).toBe('normal');
  });
});
