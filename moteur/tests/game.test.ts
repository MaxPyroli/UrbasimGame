import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA, LocalProjection, type Parcel, type Vec2 } from '../src/engine';
import { applyAction, createGame, netWorth, projectPhase, ranking, type Action, type GameState } from '../src/game';

const O = new LocalProjection(2.35, 48.85);
const lot = (x: number): Parcel => ({
  ring: ([[x, 0], [x + 10, 0], [x + 10, 30], [x, 30]] as Vec2[]).map((p) => O.toLonLat(p)),
  streetEdges: [0],
});
const newGame = (over: Parameters<typeof createGame>[0]['config'] = {}) =>
  createGame({
    players: [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob', bot: true }],
    plots: [{ id: 'T1', parcel: lot(0) }, { id: 'T2', parcel: lot(20) }, { id: 'T3', parcel: lot(40), existingSdp: 200 }],
    config: { marketVolatility: 0, startCash: 3_000_000, ...over },
    seed: 7,
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
const crit = { ...DEFAULT_CRITERIA, levels: 3 };

describe('état de partie', () => {
  it('crée des terrains avec un prix affiché et aucun propriétaire', () => {
    const s = newGame();
    expect(s.plots.every((p) => p.owner === null && p.askingPrice >= 20_000)).toBe(true);
    expect(s.players.map((p) => p.cash)).toEqual([3_000_000, 3_000_000]);
    expect(() => createGame({ players: [{ id: 'a', name: 'x' }, { id: 'a', name: 'y' }], plots: [] })).toThrow();
  });

  it('acheter paie le prix et les frais, un terrain ne s’achète qu’une fois', () => {
    let s = newGame();
    const ask = s.plots[0].askingPrice;
    s = play(s, { type: 'buy', player: 'a', plot: 'T1' });
    expect(s.players[0].cash).toBeCloseTo(3_000_000 - ask * 1.075, 4);
    expect(err(s, { type: 'buy', player: 'b', plot: 'T1' })).toMatch(/déjà/);
    expect(err(s, { type: 'launch', player: 'b', plot: 'T1', criteria: crit })).toMatch(/appartient/);
  });

  it('refuse d’acheter sans fonds', () => {
    const s = newGame({ startCash: 1000 });
    expect(err(s, { type: 'buy', player: 'a', plot: 'T1' })).toMatch(/insuffisants/);
  });

  it('revendre à la banque fait perdre le spread', () => {
    let s = play(newGame(), { type: 'buy', player: 'a', plot: 'T1' });
    s = play(s, { type: 'sellPlot', player: 'a', plot: 'T1' });
    expect(s.players[0].cash).toBeLessThan(3_000_000);
    expect(s.plots[0].owner).toBeNull();
  });

  it('refuse un projet non constructible', () => {
    let s = play(newGame(), { type: 'buy', player: 'a', plot: 'T1' });
    expect(err(s, { type: 'launch', player: 'a', plot: 'T1', criteria: { ...crit, setbackLateral: 6 } })).toMatch(/constructible|conforme/);
  });

  it('le tour se résout quand tous les joueurs sont prêts', () => {
    let s = newGame();
    s = play(s, { type: 'ready', player: 'a' });
    expect(s.round).toBe(0);
    expect(err(s, { type: 'buy', player: 'a', plot: 'T1' })).toMatch(/tour terminé/);
    s = play(s, { type: 'ready', player: 'b' });
    expect(s.round).toBe(1);
    expect(s.players.every((p) => !p.ready)).toBe(true);
  });

  it('une opération complète rapporte exactement la marge du bilan quand le marché est stable', () => {
    let s = play(newGame(), { type: 'buy', player: 'a', plot: 'T1' });
    s = play(s, { type: 'launch', player: 'a', plot: 'T1', criteria: crit });
    const run = s.projects[0];
    const cashAfterLaunch = s.players[0].cash;
    expect(s.plots[0].projectId).toBe(run.id);
    expect(projectPhase(run, 0)).toBe('permis');
    const total = run.permitRounds + run.buildRounds + run.sellRounds;
    let guard = 0;
    while (s.projects.length && guard++ < 50) s = both(s);
    expect(s.round).toBe(total);
    const initial = 3_000_000;
    // Gain final = initial + marge (terrain et travaux se remboursent, marché stable).
    expect(s.players[0].cash).toBeCloseTo(initial + run.bilan.margin, 0);
    expect(s.players[0].cash).not.toBe(cashAfterLaunch);
    expect(s.plots[0].owner).toBeNull();
    expect(s.plots[0].existingSdp).toBeCloseTo(run.sdp, 6);
  });

  it('refuse un lancement quand les fonds propres manquent', () => {
    let s = newGame({ startCash: 400_000 });
    s = play(s, { type: 'buy', player: 'a', plot: 'T1' });
    expect(err(s, { type: 'launch', player: 'a', plot: 'T1', criteria: { ...crit, levels: 6 } })).toMatch(/fonds propres/);
  });

  it('démolir l’existant coûte (bilan) et la partie s’arrête au dernier tour', () => {
    let s = newGame({ rounds: 2 });
    s = play(s, { type: 'buy', player: 'a', plot: 'T3' });
    s = play(s, { type: 'launch', player: 'a', plot: 'T3', criteria: crit });
    expect(s.projects[0].bilan.costs.demolition).toBeGreaterThan(0);
    s = both(both(s));
    expect(s.over).toBe(true);
    expect(err(s, { type: 'ready', player: 'a' })).toMatch(/terminée/);
    expect(ranking(s)[0].netWorth).toBeGreaterThan(0);
  });

  it('déterministe : mêmes actions et même graine ⇒ même état, JSON compris', () => {
    const run = () => {
      let s = newGame({ marketVolatility: 0.05 });
      s = play(s, { type: 'buy', player: 'a', plot: 'T2' });
      for (let i = 0; i < 5; i++) s = both(s);
      return s;
    };
    const x = run();
    expect(JSON.stringify(x)).toBe(JSON.stringify(run()));
    expect(JSON.parse(JSON.stringify(x))).toEqual(x);
    expect(x.marketIndex).not.toBe(1);
  });

  it('la valeur nette d’un joueur est stable après achat (hors frais) et ne dépend pas de l’adversaire', () => {
    const s = play(newGame(), { type: 'buy', player: 'a', plot: 'T1' });
    expect(netWorth(s, 'b')).toBe(3_000_000);
    expect(netWorth(s, 'a')).toBeLessThan(3_000_000);
  });
});
