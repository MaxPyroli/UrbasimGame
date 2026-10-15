import { LAUNCH_GRACE, openTenders, tenderBidOf } from './tender';
import type { GameEvent, GameState, PlayerId } from './types';

/**
 * Ce qu'un joueur doit surveiller : échéances accordées par la commune, appels d'offres ouverts, préventes à atteindre,
 * offres en cours, découvert. Calculé à partir de l'état, donc toujours à jour (et rejouable).
 */
export interface Watch {
  id: string;
  tone: 'good' | 'info' | 'warn' | 'bad';
  title: string;
  detail?: string;
  /** Barre de progression : `value` sur `max` ; `late` quand l'échéance est dépassée ou sera manquée. */
  progress?: { value: number; max: number; label: string; late?: boolean };
  ref?: { plot?: string; project?: string; tender?: string };
}

const TONE_ORDER: Record<Watch['tone'], number> = { bad: 0, warn: 1, info: 2, good: 3 };
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
const label = (state: GameState, plotId: string) => {
  const p = state.plots.find((x) => x.id === plotId);
  return p?.label ? p.label.replace(' · Montreuil', '').replace(/ · \d+ m²$/, '') : plotId;
};

/** Trimestres qu'il reste à une opération avant sa livraison, si rien ne l'arrête (attente de préventes : au moins 1). */
export function roundsToDelivery(run: GameState['projects'][number]): number {
  switch (run.phase) {
    case 'permis':
      return run.permitRounds - run.phaseElapsed + 1 + run.buildRounds;
    case 'preventes':
      return 1 + run.buildRounds;
    case 'chantier':
      return run.buildRounds - run.phaseElapsed;
    default:
      return 0;
  }
}

export function watchList(state: GameState, playerId: PlayerId): Watch[] {
  const me = state.players.find((p) => p.id === playerId);
  if (!me || me.bankrupt) return [];
  const out: Watch[] = [];

  if (me.debt > 0) {
    out.push({ id: 'debt', tone: 'bad', title: 'Vous êtes à découvert', detail: 'Les intérêts s’accumulent et la banque ne finance plus rien tant que la dette n’est pas remboursée.' });
  }

  // Délais accordés par la commune : lancer l'opération.
  for (const plot of state.plots) {
    const ob = plot.obligation;
    if (plot.owner !== playerId || !ob || plot.projectId) continue;
    const left = ob.launchBy - state.round;
    out.push({
      id: `launch:${plot.id}`,
      tone: left <= 1 ? 'bad' : left === 2 ? 'warn' : 'info',
      title: `Lancer ${label(state, plot.id)}`,
      detail: left > 0 ? `Encore ${plural(left, 'trimestre', 'trimestres')} avant que la commune reprenne le terrain (10 % du prix perdus).` : 'Délai dépassé.',
      progress: { value: LAUNCH_GRACE - left, max: LAUNCH_GRACE, label: `${LAUNCH_GRACE - left}/${LAUNCH_GRACE} trim.`, late: left <= 0 },
      ref: { plot: plot.id },
    });
  }

  for (const run of state.projects) {
    if (run.owner !== playerId) continue;
    const where = label(state, run.plotId);
    // Délai de livraison promis à la commune.
    if (run.terms && run.phase !== 'livraison') {
      const promised = run.terms.delivery;
      const projected = run.roundsRun + roundsToDelivery(run);
      const late = projected > promised;
      out.push({
        id: `delivery:${run.id}`,
        tone: late ? 'bad' : projected === promised ? 'warn' : 'info',
        title: `Livraison de ${run.id} (${where})`,
        detail: late
          ? `Livraison prévue en ${projected} trimestres pour ${promised} promis : pénalités à prévoir (2 % du chiffre d’affaires par trimestre de retard).`
          : `Livraison prévue en ${projected} trimestres pour ${promised} promis à la commune.`,
        progress: { value: Math.min(run.roundsRun, promised), max: promised, label: `trim. ${run.roundsRun}/${promised} promis`, late },
        ref: { project: run.id, plot: run.plotId },
      });
    }
    // Préventes à atteindre pour débloquer le crédit.
    if (!run.financed && run.lots > 0) {
      const need = Math.ceil(run.lots * state.config.presaleThreshold);
      out.push({
        id: `presales:${run.id}`,
        tone: 'info',
        title: `Préventes de ${run.id} (${where})`,
        detail: run.lotsSold >= need ? 'Seuil atteint : le crédit sera débloqué.' : `Encore ${plural(need - run.lotsSold, 'lot', 'lots')} à vendre sur plan pour débloquer le crédit bancaire.`,
        progress: { value: Math.min(run.lotsSold, need), max: need, label: `${run.lotsSold}/${need} lots` },
        ref: { project: run.id, plot: run.plotId },
      });
    }
  }

  // Appels d'offres de la commune.
  for (const t of openTenders(state)) {
    const left = t.closesAt - state.round;
    const mine = !!tenderBidOf(t, playerId);
    out.push({
      id: `tender:${t.id}`,
      tone: mine ? 'info' : left <= 1 ? 'warn' : 'info',
      title: `${t.id} · ${label(state, t.plotId)} (${t.spec.programme.label})`,
      detail: mine ? `Votre proposition est déposée : verdict dans ${plural(left, 'trimestre', 'trimestres')}.` : `Vous n’avez pas répondu : ${left <= 1 ? 'dernier trimestre' : `encore ${left} trimestres`}.`,
      progress: { value: state.round - t.opensAt, max: t.closesAt - t.opensAt, label: `${plural(left, 'trimestre', 'trimestres')} restant${left > 1 ? 's' : ''}` },
      ref: { tender: t.id, plot: t.plotId },
    });
  }

  // ZAC en cours : lots lancés et équipements en chantier.
  for (const z of state.zacs) {
    const pending = z.equipment.filter((e) => e.status !== 'livre');
    if (z.launched >= z.lots.length && pending.length === 0) continue;
    const building = pending.filter((e) => e.status === 'chantier' && e.deliverAt !== undefined);
    const soonest = building.length ? Math.min(...building.map((e) => e.deliverAt!)) - state.round : null;
    out.push({
      id: `zac:${z.id}`,
      tone: 'info',
      title: `ZAC ${z.name}`,
      detail: `${z.launched}/${z.lots.length} lots lancés${pending.length ? `, ${pending.length} équipement${pending.length > 1 ? 's' : ''} à livrer (${pending.map((e) => e.label).join(', ')})` : ''}${soonest !== null ? ` : prochaine livraison dans ${plural(Math.max(0, soonest), 'trimestre', 'trimestres')}` : ''}.`,
      progress: { value: z.launched, max: z.lots.length, label: `${z.launched}/${z.lots.length} lots lancés` },
      ref: { plot: z.lots[0] },
    });
  }

  // Offres sur des terrains en vente.
  for (const o of state.offers) {
    if (o.player !== playerId) continue;
    const plot = state.plots.find((p) => p.id === o.plot);
    if (!plot?.listing) continue;
    const left = plot.listing.until - state.round;
    const span = state.config.auctionRounds;
    out.push({
      id: `offer:${plot.id}`,
      tone: 'info',
      title: `Offre sur ${label(state, plot.id)}`,
      detail: `Réponse dans ${plural(left, 'trimestre', 'trimestres')}.`,
      progress: { value: Math.max(0, span - left), max: span, label: `${plural(left, 'trimestre', 'trimestres')} restant${left > 1 ? 's' : ''}` },
      ref: { plot: plot.id },
    });
  }

  return out.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}

/** Événements qui concernent le joueur : les siens et les annonces publiques (marché, taux, commune). */
export const isRelevant = (e: GameEvent, playerId: PlayerId): boolean => e.player === playerId || (!e.player && e.kind !== undefined && e.kind !== 'terrain') || e.kind === 'commune';

export function relevantEvents(state: GameState, playerId: PlayerId): GameEvent[] {
  return state.log.filter((e) => isRelevant(e, playerId));
}
