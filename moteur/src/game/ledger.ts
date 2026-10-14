import type { GameEvent, GameState, Player, Plot, ProjectRun } from './types';

/** Fonctions de comptabilité et de mise à jour partagées par le moteur de partie et le marché foncier. */

export const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;

export function withEvent(s: GameState, e: Omit<GameEvent, 'round'>): GameState {
  return { ...s, log: [...s.log, { round: s.round, ...e }] };
}

export const mapPlayer = (s: GameState, id: string, f: (p: Player) => Player): GameState => ({
  ...s,
  players: s.players.map((p) => (p.id === id ? f(p) : p)),
});
export const mapPlot = (s: GameState, id: string, f: (p: Plot) => Plot): GameState => ({
  ...s,
  plots: s.plots.map((p) => (p.id === id ? f(p) : p)),
});
export const mapProject = (s: GameState, id: string, f: (p: ProjectRun) => ProjectRun): GameState => ({
  ...s,
  projects: s.projects.map((p) => (p.id === id ? f(p) : p)),
});

/** Débite un joueur : ce que la trésorerie ne couvre pas devient découvert bancaire. */
export function charge(s: GameState, id: string, amount: number): GameState {
  if (amount <= 0) return s;
  return mapPlayer(s, id, (p) => {
    const pay = Math.min(p.cash, amount);
    return { ...p, cash: p.cash - pay, debt: p.debt + (amount - pay) };
  });
}

/** Crédite un joueur d'un encaissement : le découvert se rembourse en premier. */
export function credit(s: GameState, id: string, amount: number): GameState {
  if (amount <= 0) return s;
  return mapPlayer(s, id, (p) => {
    const repay = Math.min(p.debt, amount);
    return { ...p, debt: p.debt - repay, cash: p.cash + amount - repay };
  });
}
