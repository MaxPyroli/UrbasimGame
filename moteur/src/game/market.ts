import { eur, hashFrac, mapPlayer, mapPlot, withEvent } from './ledger';
import { nextRandom } from './rng';
import type { GameState, Offer, Plot } from './types';

/**
 * Marché foncier (mode `auction`). Les terrains mis en vente restent ouverts aux offres quelques trimestres ; les autres
 * se prospectent (une offre spontanée au propriétaire, résolue à la fin du trimestre). Les offres sont sous pli fermé,
 * la somme est bloquée sur la trésorerie, et en cas de concurrence le plus offrant l'emporte (à égalité, le premier arrivé).
 */

/** Ce qu'un propriétaire non vendeur exige, en multiple du prix affiché (propre à chaque terrain, caché au joueur). */
export const reserveFactor = (plot: Pick<Plot, 'id' | 'speculator'>, spread: number) => (1 + spread * hashFrac(`${plot.id}#reserve`)) * (plot.speculator ? 1.2 : 1);

export const offersOn = (s: GameState, plotId: string) => s.offers.filter((o) => o.plot === plotId);
export const offerOf = (s: GameState, plotId: string, playerId: string) => s.offers.find((o) => o.plot === plotId && o.player === playerId);
/** Somme bloquée par les offres en cours d'un joueur. */
export const committedCash = (s: GameState, playerId: string) => s.offers.filter((o) => o.player === playerId).reduce((t, o) => t + o.reserved, 0);

export const prospectFee = (s: GameState, price: number) => Math.round(Math.max(s.config.prospectFeeMin, price * s.config.prospectFeeRate));

/** Prix minimum d'une offre : le prix de mise en vente, ou 80 % du prix affiché pour une prospection. */
export const minOfferPrice = (plot: Plot) => (plot.listing ? plot.listing.minPrice : Math.round(plot.askingPrice * 0.8));

export const isListed = (plot: Plot) => !!plot.listing;

export type MarketResult = { ok: true; state: GameState } | { ok: false; error: string };

/** Dépose (ou remplace) l'offre d'un joueur sur un terrain libre. */
export function placeOffer(s: GameState, playerId: string, plotId: string, rawPrice: number): MarketResult {
  const fail = (error: string): MarketResult => ({ ok: false, error });
  if (s.config.landMarket !== 'auction') return fail('les offres ne sont pas ouvertes dans ce mode de jeu');
  const player = s.players.find((p) => p.id === playerId)!;
  const plot = s.plots.find((p) => p.id === plotId);
  if (!plot) return fail('terrain inconnu');
  if (plot.owner !== null) return fail('ce terrain a déjà un propriétaire');
  if (plot.municipal) return fail('terrain communal : il ne se vend que par appel d’offres');
  if (player.bankrupt) return fail('vous êtes en faillite');
  if (player.debt > 0) return fail('la banque refuse tout engagement tant que votre découvert n’est pas remboursé');
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) return fail('prix invalide');
  const price = Math.round(rawPrice);
  const min = minOfferPrice(plot);
  if (price < min) return fail(`offre trop basse : minimum ${eur(min)}${plot.listing ? ' (prix de mise en vente)' : ''}`);
  const reserved = Math.round(price * (1 + s.config.bilanParams.acquisitionFeeRate));
  const existing = offerOf(s, plotId, playerId);
  if (existing?.bundle) return fail('cette offre fait partie d’une offre groupée : retirez-la (toutes les offres du groupe seront retirées) avant d’en déposer une autre');
  const fee = !plot.listing && !existing ? prospectFee(s, price) : 0;
  const delta = reserved - (existing?.reserved ?? 0);
  if (player.cash < delta + fee) {
    return fail(`fonds insuffisants : il faut bloquer ${eur(delta + fee)} de plus (offre et frais de notaire${fee ? `, dont ${eur(fee)} de frais de prospection` : ''})`);
  }
  let next = mapPlayer(s, playerId, (p) => ({ ...p, cash: p.cash - delta - fee }));
  const offer: Offer = { plot: plotId, player: playerId, price, round: s.round, reserved };
  next = { ...next, offers: existing ? next.offers.map((o) => (o === existing ? { ...existing, price, reserved } : o)) : [...next.offers, offer] };
  return { ok: true, state: next };
}

/** Tour auquel une offre sur ce terrain sera tranchée : à l'échéance de la mise en vente, sinon à la fin de ce trimestre. */
export const dueRound = (s: GameState, plot: Plot) => (plot.listing ? plot.listing.until : s.round + 1);

/**
 * Offre groupée « tout ou rien » : une offre sur chaque terrain d'un projet, tranchées ensemble. Il faut qu'elles soient
 * tranchées au même tour (mêmes échéances). Les terrains remportés sont assemblés ; si un seul manque, rien n'est acheté.
 */
export function placeBundle(s: GameState, playerId: string, items: { plot: string; price: number }[], extra: string[] = []): MarketResult {
  const fail = (error: string): MarketResult => ({ ok: false, error });
  const ids = [...new Set(items.map((i) => i.plot))];
  if (ids.length !== items.length) return fail('une offre groupée ne peut pas porter deux fois sur le même terrain');
  if (ids.length + extra.length < 2) return fail('une offre groupée porte sur au moins deux terrains différents');
  if (ids.length < 1) return fail('il faut au moins un terrain à acheter');
  for (const id of extra) {
    const mine = s.plots.find((p) => p.id === id);
    if (!mine || mine.owner !== playerId || mine.projectId || mine.obligation) return fail(`${id} : il faut déjà posséder cette parcelle (sans opération en cours ni engagement envers la commune)`);
  }
  const plots = ids.map((id) => s.plots.find((p) => p.id === id));
  if (plots.some((p) => !p)) return fail('terrain inconnu');
  const list = plots as Plot[];
  if (list.some((p) => offerOf(s, p.id, playerId))) return fail('vous avez déjà une offre sur l’un de ces terrains : retirez-la d’abord');
  const rounds = new Set(list.map((p) => dueRound(s, p)));
  if (rounds.size > 1) return fail('ces terrains ne sont pas tranchés au même moment (certains sont mis en vente jusqu’à une autre échéance) : une offre groupée doit être décidée en une fois');
  const bundle = `${playerId}:${s.round}:${ids[0]}`;
  let next = s;
  for (const it of items) {
    const r = placeOffer(next, playerId, it.plot, it.price);
    if (!r.ok) return fail(`${it.plot} : ${r.error}`);
    next = { ...r.state, offers: r.state.offers.map((o) => (o.plot === it.plot && o.player === playerId ? { ...o, bundle, ...(extra.length ? { extra } : {}) } : o)) };
  }
  return { ok: true, state: next };
}

/** Retire une offre : la somme bloquée est rendue (les frais de prospection restent acquis). */
export function withdrawOffer(s: GameState, playerId: string, plotId: string): MarketResult {
  const existing = offerOf(s, plotId, playerId);
  if (!existing) return { ok: false, error: 'vous n’avez pas d’offre sur ce terrain' };
  // Une offre groupée se retire en entier.
  const group = existing.bundle ? s.offers.filter((o) => o.player === playerId && o.bundle === existing.bundle) : [existing];
  const back = group.reduce((t, o) => t + o.reserved, 0);
  let next = mapPlayer(s, playerId, (p) => ({ ...p, cash: p.cash + back }));
  next = { ...next, offers: next.offers.filter((o) => !group.includes(o)) };
  return { ok: true, state: next };
}

/** Retire toutes les offres d'un joueur (faillite) et rend les sommes bloquées. */
export function dropOffers(s: GameState, playerId: string): GameState {
  const total = committedCash(s, playerId);
  return { ...mapPlayer(s, playerId, (p) => ({ ...p, cash: p.cash + total })), offers: s.offers.filter((o) => o.player !== playerId) };
}

/** Résout les enchères échues et les prospections du trimestre : le plus offrant l'emporte ; une offre groupée tombe si un de ses terrains manque. */
export function resolveMarket(state: GameState): GameState {
  let s = state;
  const { config } = s;
  const labelOf = (plot: Plot) => (plot.label ? plot.label.replace(' · Montreuil', '') : plot.id);
  const due = state.plots.filter((plot) => {
    if (plot.owner !== null) return false;
    const offers = offersOn(s, plot.id);
    return plot.listing ? s.round >= plot.listing.until : offers.length > 0;
  });
  const dueIds = new Set(due.map((p) => p.id));
  // Offres en jeu : celles d'un groupe dont tous les terrains ne sont pas tranchés ce tour attendent (elles ne comptent pas encore).
  const bundlePlots = new Map<string, string[]>();
  for (const o of s.offers) if (o.bundle) bundlePlots.set(o.bundle, [...(bundlePlots.get(o.bundle) ?? []), o.plot]);
  const waiting = new Set([...bundlePlots].filter(([, plots]) => !plots.every((id) => dueIds.has(id))).map(([b]) => b));
  const failedBundles = new Set<string>();
  const rank = (plot: Plot) =>
    offersOn(s, plot.id)
      .filter((o) => !(o.bundle && (waiting.has(o.bundle) || failedBundles.has(o.bundle))))
      .sort((a, b) => b.price - a.price || a.round - b.round || s.offers.indexOf(a) - s.offers.indexOf(b));
  const thresholdOf = (plot: Plot) => (plot.listing ? plot.listing.minPrice : plot.askingPrice * reserveFactor(plot, config.reserveSpread));
  const winnerOf = (plot: Plot) => {
    const best = rank(plot)[0];
    return best && best.price >= thresholdOf(plot) ? best : null;
  };
  // Un groupe tombe si un de ses terrains n'est pas remporté par son auteur ; on recalcule jusqu'à stabilité (les terrains
  // abandonnés reviennent au meilleur autre offrant).
  for (let guard = 0; guard < 20; guard++) {
    let changed = false;
    for (const [bundle, plots] of bundlePlots) {
      if (waiting.has(bundle) || failedBundles.has(bundle)) continue;
      const owner = s.offers.find((o) => o.bundle === bundle)!.player;
      const ok = plots.every((id) => {
        const w = winnerOf(s.plots.find((p) => p.id === id)!);
        return w?.player === owner && w.bundle === bundle;
      });
      if (!ok) {
        failedBundles.add(bundle);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const refund = (o: Offer) => (s = mapPlayer(s, o.player, (p) => ({ ...p, cash: p.cash + o.reserved })));
  const humanEvent = (o: Offer, text: string) => {
    if (!s.players.find((p) => p.id === o.player)?.bot) s = withEvent(s, { player: o.player, kind: 'terrain', tone: 'info', text });
  };
  const decided: Offer[] = [];
  for (const plot of due) {
    const label = labelOf(plot);
    const offers = offersOn(s, plot.id).filter((o) => !(o.bundle && waiting.has(o.bundle)));
    const ranked = rank(plot);
    const best = winnerOf(plot);
    // Offres d'un groupe tombé : somme rendue (les frais de prospection restent acquis).
    for (const o of offers.filter((x) => x.bundle && failedBundles.has(x.bundle))) {
      refund(o);
      decided.push(o);
    }
    if (best) {
      const winner = s.players.find((p) => p.id === best.player)!;
      s = mapPlot(s, plot.id, (p) => ({ ...p, owner: best.player, paid: best.reserved, listing: undefined }));
      s = { ...s, landHeat: s.landHeat * (1 + config.landHeatStep) };
      if (!best.bundle) s = withEvent(s, { player: best.player, kind: 'terrain', tone: 'good', popup: true, code: 'terrain-remporte', ref: { plot: plot.id }, text: `${winner.name} remporte ${label} pour ${eur(best.price)}${ranked.length > 1 ? ` (${ranked.length} offres, la 2e : ${eur(ranked[1].price)})` : ''}` });
      decided.push(best);
      for (const o of ranked.slice(1)) {
        refund(o);
        decided.push(o);
        humanEvent(o, `Vous perdez ${label} : ${winner.name} a offert ${eur(best.price)} contre ${eur(o.price)}`);
      }
    } else {
      for (const o of ranked) {
        refund(o);
        decided.push(o);
        humanEvent(o, plot.listing ? `Aucune offre acceptée sur ${label}` : plot.speculator ? `Prospection de ${label} : le propriétaire spécule, il refuse ${eur(o.price)} et attend nettement plus (son prix monte chaque trimestre)` : `Prospection de ${label} : le propriétaire n’est pas vendeur à ${eur(o.price)}, essayez plus haut`);
      }
      if (plot.listing) s = mapPlot(s, plot.id, (p) => ({ ...p, listing: undefined }));
    }
  }
  // Bilan des offres groupées : remportées (assemblage à faire) ou tombées.
  for (const [bundle, plots] of bundlePlots) {
    if (waiting.has(bundle)) continue;
    const owner = state.offers.find((o) => o.bundle === bundle)!.player;
    if (failedBundles.has(bundle)) {
      const missing = plots.filter((id) => winnerOf(state.plots.find((p) => p.id === id)!)?.bundle !== bundle).map((id) => labelOf(state.plots.find((p) => p.id === id)!));
      if (!s.players.find((p) => p.id === owner)?.bot) s = withEvent(s, { player: owner, kind: 'terrain', tone: 'bad', popup: true, code: 'groupe-perdu', text: `Offre groupée annulée : vous n’avez pas remporté toutes les parcelles (il manquait ${missing.join(', ') || 'au moins une'}). Aucune n’est achetée et vos sommes bloquées vous sont rendues.` });
    } else {
      const extra = state.offers.find((o) => o.bundle === bundle)?.extra ?? [];
      s = { ...s, pendingMerges: [...s.pendingMerges, { player: owner, plots: [...plots, ...extra] }] };
      s = withEvent(s, { player: owner, kind: 'terrain', tone: 'good', popup: true, code: 'groupe-remporte', ref: { plot: plots[0] }, text: `${s.players.find((p) => p.id === owner)!.name} remporte son offre groupée : ${plots.length} parcelle${plots.length > 1 ? 's' : ''}${extra.length ? ` avec les ${extra.length} que vous possédiez` : ''}` });
    }
  }
  const done = new Set(decided);
  return { ...s, offers: s.offers.filter((o) => !done.has(o)) };
}

/** Met en vente `count` terrains libres tirés au hasard (dans l'état : rejouable). */
export function listPlots(state: GameState, count: number): GameState {
  let s = state;
  const pool = s.plots.filter((p) => p.owner === null && !p.municipal && !p.listing && !p.projectId && p.issue !== 'zone' && p.issue !== 'delaisse' && !p.speculator && offersOn(s, p.id).length === 0);
  const picked: string[] = [];
  const n = Math.min(count, pool.length);
  for (let k = 0; k < n; k++) {
    const [u, rng] = nextRandom(s.rng);
    s = { ...s, rng };
    const i = Math.floor(u * pool.length);
    picked.push(pool.splice(i, 1)[0].id);
  }
  for (const id of picked) s = mapPlot(s, id, (p) => ({ ...p, listing: { until: s.round + s.config.auctionRounds, minPrice: p.askingPrice } }));
  return picked.length ? withEvent(s, { kind: 'terrain', tone: 'info', text: `${picked.length} terrain${picked.length > 1 ? 's' : ''} mis en vente : offres ouvertes jusqu’au trimestre ${s.round + s.config.auctionRounds + 1}` }) : s;
}

/** Nombre de terrains à mettre en vente ce trimestre. */
export const listingCount = (s: GameState) => Math.max(1, Math.round(s.config.listingShare * s.plots.filter((p) => p.owner === null && !p.municipal && !p.issue).length));
