import { eur, mapPlayer, mapPlot, withEvent } from './ledger';
import { nextRandom } from './rng';
import type { GameState, Offer, Plot } from './types';

/**
 * Marché foncier (mode `auction`). Les terrains mis en vente restent ouverts aux offres quelques trimestres ; les autres
 * se prospectent (une offre spontanée au propriétaire, résolue à la fin du trimestre). Les offres sont sous pli fermé,
 * la somme est bloquée sur la trésorerie, et en cas de concurrence le plus offrant l'emporte (à égalité, le premier arrivé).
 */

const hashFrac = (id: string) => {
  let h = 0;
  for (const ch of id) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  return (h % 1000) / 999;
};

/** Ce qu'un propriétaire non vendeur exige, en multiple du prix affiché (propre à chaque terrain, caché au joueur). */
export const reserveFactor = (plot: Pick<Plot, 'id'>, spread: number) => 1 + spread * hashFrac(`${plot.id}#reserve`);

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

/** Retire une offre : la somme bloquée est rendue (les frais de prospection restent acquis). */
export function withdrawOffer(s: GameState, playerId: string, plotId: string): MarketResult {
  const existing = offerOf(s, plotId, playerId);
  if (!existing) return { ok: false, error: 'vous n’avez pas d’offre sur ce terrain' };
  let next = mapPlayer(s, playerId, (p) => ({ ...p, cash: p.cash + existing.reserved }));
  next = { ...next, offers: next.offers.filter((o) => o !== existing) };
  return { ok: true, state: next };
}

/** Retire toutes les offres d'un joueur (faillite) et rend les sommes bloquées. */
export function dropOffers(s: GameState, playerId: string): GameState {
  const total = committedCash(s, playerId);
  return { ...mapPlayer(s, playerId, (p) => ({ ...p, cash: p.cash + total })), offers: s.offers.filter((o) => o.player !== playerId) };
}

/** Résout les enchères échues et les prospections du trimestre : le plus offrant l'emporte. */
export function resolveMarket(state: GameState): GameState {
  let s = state;
  const { config } = s;
  for (const plot of state.plots) {
    if (plot.owner !== null) continue;
    const offers = offersOn(s, plot.id);
    const due = plot.listing ? s.round >= plot.listing.until : offers.length > 0;
    if (!due) continue;
    const label = plot.label ? plot.label.replace(' · Montreuil', '') : plot.id;
    const ranked = [...offers].sort((a, b) => b.price - a.price || a.round - b.round || s.offers.indexOf(a) - s.offers.indexOf(b));
    const best = ranked[0];
    const threshold = plot.listing ? plot.listing.minPrice : plot.askingPrice * reserveFactor(plot, config.reserveSpread);
    const refund = (o: Offer) => (s = mapPlayer(s, o.player, (p) => ({ ...p, cash: p.cash + o.reserved })));
    const humanEvent = (o: Offer, text: string) => {
      if (!s.players.find((p) => p.id === o.player)?.bot) s = withEvent(s, { player: o.player, text });
    };
    if (best && best.price >= threshold) {
      const winner = s.players.find((p) => p.id === best.player)!;
      s = mapPlot(s, plot.id, (p) => ({ ...p, owner: best.player, paid: best.reserved, listing: undefined }));
      s = { ...s, landHeat: s.landHeat * (1 + config.landHeatStep) };
      s = withEvent(s, { player: best.player, text: `${winner.name} remporte ${label} pour ${eur(best.price)}${ranked.length > 1 ? ` (${ranked.length} offres, la 2e : ${eur(ranked[1].price)})` : ''}` });
      for (const o of ranked.slice(1)) {
        refund(o);
        humanEvent(o, `Vous perdez ${label} : ${winner.name} a offert ${eur(best.price)} contre ${eur(o.price)}`);
      }
    } else {
      for (const o of ranked) {
        refund(o);
        humanEvent(o, plot.listing ? `Aucune offre acceptée sur ${label}` : `Prospection de ${label} : le propriétaire n’est pas vendeur à ${eur(o.price)}, essayez plus haut`);
      }
      if (plot.listing) s = mapPlot(s, plot.id, (p) => ({ ...p, listing: undefined }));
    }
    s = { ...s, offers: s.offers.filter((o) => o.plot !== plot.id) };
  }
  return s;
}

/** Met en vente `count` terrains libres tirés au hasard (dans l'état : rejouable). */
export function listPlots(state: GameState, count: number): GameState {
  let s = state;
  const pool = s.plots.filter((p) => p.owner === null && !p.municipal && !p.listing && !p.projectId && p.issue !== 'zone' && offersOn(s, p.id).length === 0);
  const picked: string[] = [];
  const n = Math.min(count, pool.length);
  for (let k = 0; k < n; k++) {
    const [u, rng] = nextRandom(s.rng);
    s = { ...s, rng };
    const i = Math.floor(u * pool.length);
    picked.push(pool.splice(i, 1)[0].id);
  }
  for (const id of picked) s = mapPlot(s, id, (p) => ({ ...p, listing: { until: s.round + s.config.auctionRounds, minPrice: p.askingPrice } }));
  return picked.length ? withEvent(s, { text: `${picked.length} terrain${picked.length > 1 ? 's' : ''} mis en vente : offres ouvertes jusqu’au trimestre ${s.round + s.config.auctionRounds + 1}` }) : s;
}

/** Nombre de terrains à mettre en vente ce trimestre. */
export const listingCount = (s: GameState) => Math.max(1, Math.round(s.config.listingShare * s.plots.filter((p) => p.owner === null && !p.municipal && !p.issue).length));
