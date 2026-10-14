import { describe, expect, it } from 'vitest';
import { MARKETS, LocalProjection, type Parcel, type Vec2 } from '../src/engine';
import { BOT_PROFILES, applyAction, bestPlan, createGame, netWorth, playBotTurn, playBots, simulateAllBots, type GameState } from '../src/game';

const O = new LocalProjection(2.35, 48.85);
const lot = (x: number, y: number): Parcel => ({
  ring: ([[x, y], [x + 10, y], [x + 10, y + 30], [x, y + 30]] as Vec2[]).map((p) => O.toLonLat(p)),
  streetEdges: [0],
});
const plots = Array.from({ length: 12 }, (_, i) => ({ id: `T${i}`, parcel: lot((i % 4) * 12, Math.floor(i / 4) * 40) }));
const game = (players: Parameters<typeof createGame>[0]['players'], rounds = 20) =>
  createGame({ players, plots, config: { market: MARKETS['petite-couronne'], rounds }, seed: 5 });
const bots = () => [
  { id: 'p', name: 'Prudent', bot: true, profile: 'prudent' as const },
  { id: 'e', name: 'Équilibré', bot: true },
  { id: 'a', name: 'Agressif', bot: true, profile: 'agressif' as const },
];

describe('concurrents ordinateur', () => {
  it('un bot achète un terrain rentable et lance une opération dès le premier trimestre', () => {
    const s = playBotTurn(game([{ id: 'e', name: 'Bot', bot: true }, { id: 'h', name: 'Humain' }]), 'e');
    expect(s.plots.some((p) => p.owner === 'e')).toBe(true);
    expect(s.projects.length).toBeGreaterThan(0);
    expect(s.players[0].ready).toBe(true);
    expect(s.round).toBe(0); // l'humain n'a pas fini
  });

  it('une partie entre bots va au bout, sans action refusée, et le trimestre ne se résout qu’une fois les humains prêts', () => {
    const s = simulateAllBots(game(bots()));
    expect(s.over).toBe(true);
    expect(s.round).toBe(20);
    expect(s.log.length).toBeGreaterThan(0);
    // Avec un humain qui ne joue pas, la simulation s’arrête au premier trimestre.
    const stuck = simulateAllBots(game([...bots(), { id: 'h', name: 'Humain' }]));
    expect(stuck.round).toBe(0);
    expect(stuck.players.find((p) => p.id === 'h')!.ready).toBe(false);
    // L’humain termine : le trimestre se résout.
    const r = applyAction(stuck, { type: 'ready', player: 'h' });
    expect(r.ok && r.state.round).toBe(1);
  });

  it('déterministe, et sérialisable en cours de partie', () => {
    const a = simulateAllBots(game(bots()));
    expect(JSON.stringify(a)).toBe(JSON.stringify(simulateAllBots(game(bots()))));
    // On peut sauvegarder / recharger l’état à mi-partie et obtenir la même fin.
    let mid: GameState = game(bots());
    for (let i = 0; i < 7; i++) mid = playBots(mid);
    const reloaded: GameState = JSON.parse(JSON.stringify(mid));
    expect(JSON.stringify(simulateAllBots(reloaded))).toBe(JSON.stringify(a));
  });

  it('les bots ne se marchent pas dessus : aucun terrain n’a deux propriétaires et la trésorerie reste positive', () => {
    let s = game(bots());
    while (!s.over) {
      s = playBots(s);
      expect(s.players.every((p) => p.cash >= 0)).toBe(true);
      for (const pr of s.projects) expect(s.plots.find((p) => p.id === pr.plotId)!.owner).toBe(pr.owner);
    }
    expect(s.players.every((p) => netWorth(s, p.id) > 0)).toBe(true);
  });

  it('le seuil de marge filtre : un bot prudent refuse ce qu’un agressif accepte', () => {
    const s = game(bots());
    const plot = s.plots[0];
    const strict = { ...BOT_PROFILES.prudent, minMargin: 0.9 };
    expect(bestPlan(s, plot, plot.askingPrice, strict)).toBeNull();
    expect(bestPlan(s, plot, plot.askingPrice * 10, BOT_PROFILES.agressif)).toBeNull();
    expect(bestPlan(s, plot, plot.askingPrice, BOT_PROFILES.agressif)).not.toBeNull();
  });

  it('un bot sans fonds ne fait rien (il se contente de passer)', () => {
    const s = createGame({ players: [{ id: 'e', name: 'Bot', bot: true }], plots, config: { startCash: 1000 }, seed: 1 });
    const after = playBotTurn(s, 'e');
    expect(after.plots.every((p) => p.owner === null)).toBe(true);
    expect(after.round).toBe(1);
  });
});
