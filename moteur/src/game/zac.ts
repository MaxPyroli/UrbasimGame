import { hashFrac, withEvent } from './ledger';
import { PROGRAMMES, openTender, openTenders } from './tender';
import type { GameState, Plot, Programme, TenderSpec, Zac, ZacEquipment } from './types';

/**
 * ZAC (zone d'aménagement concerté) : la commune aménage un morceau de quartier. Elle attribue ses lots l'un après l'autre
 * par appels d'offres (phasage) et prévoit des équipements publics (école, square, crèche) sur ses terrains. Chaque lot
 * lancé verse une participation au m² de SDP ; quand assez de lots sont lancés, les équipements sont construits, puis
 * livrés : les logements de la ZAC se vendent alors plus cher.
 */

/** Participation aux équipements, €/m² de SDP (moins que la taxe d'aménagement ordinaire de 100 €). */
export const ZAC_PARTICIPATION = 60;
/** Trimestres entre l'ouverture de deux lots, et durée de construction d'un équipement. */
export const ZAC_LOT_GAP = 2;
export const EQUIPMENT_BUILD_ROUNDS = 4;

const NAMES = ['Clos des Capucins', 'Ruffins-Nord', 'La Boissière', 'Villiers-Sud', 'Place de la Fraternité', 'Les Couvents'];
const KINDS: Pick<ZacEquipment, 'kind' | 'label' | 'cost' | 'premium'>[] = [
  { kind: 'ecole', label: 'groupe scolaire', cost: 1_800_000, premium: 0.04 },
  { kind: 'parc', label: 'square public', cost: 600_000, premium: 0.03 },
  { kind: 'creche', label: 'crèche municipale', cost: 700_000, premium: 0.02 },
];

const centre = (p: Plot) => ({ x: p.parcel.ring.reduce((t, q) => t + q.lon, 0) / p.parcel.ring.length, y: p.parcel.ring.reduce((t, q) => t + q.lat, 0) / p.parcel.ring.length });
const metres = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot((a.x - b.x) * 73_000, (a.y - b.y) * 111_000);

/** Cadre d'opération des lots d'une ZAC : celui des ZAC (prix réduit, étage de plus) avec la participation aux équipements. */
export function zacProgramme(zac: Zac): Programme {
  return {
    ...PROGRAMMES.zac,
    label: 'ZAC',
    taxPerSdp: zac.participation,
    summary: `Lot de la ZAC ${zac.name} : terrain aménagé à prix réduit et un étage de plus que le PLU. En échange, une participation de ${zac.participation} € par m² de plancher finance les équipements publics du quartier (${zac.equipment.map((e) => e.label).join(', ')}), qui valorisent ensuite vos logements.`,
  };
}

/**
 * Choisit la ou les ZAC d'une partie : un lot de départ constructible de bonne taille, ses plus proches voisins comme autres
 * lots, et à proximité les terrains qui accueilleront les équipements (de préférence les petits bouts inutilisables).
 * Marque les terrains concernés comme publics. Déterministe.
 */
export function planZacs(plots: Plot[], count: number): Zac[] {
  const zacs: Zac[] = [];
  const taken = new Set<string>();
  for (let n = 0; n < count; n++) {
    const eligible = plots.filter((p) => !taken.has(p.id) && !p.issue && p.area >= 300 && p.area <= 1000);
    if (eligible.length < 3) break;
    const seed = eligible.slice().sort((a, b) => hashFrac(`${a.id}#zac${n}`) - hashFrac(`${b.id}#zac${n}`))[0];
    const c0 = centre(seed);
    const lots = [seed, ...eligible.filter((p) => p !== seed).sort((a, b) => metres(centre(a), c0) - metres(centre(b), c0)).slice(0, 3)];
    lots.forEach((p) => taken.add(p.id));
    // Équipements : terrains proches, de préférence non constructibles seuls (délaissés, petits, enclavés), sinon les plus petits.
    const nearby = plots
      .filter((p) => !taken.has(p.id) && !p.municipal && p.issue !== 'zone' && p.area >= 60 && p.area <= 1200 && metres(centre(p), c0) < 260)
      .sort((a, b) => (a.issue ? 0 : 1) - (b.issue ? 0 : 1) || metres(centre(a), c0) - metres(centre(b), c0));
    const sites = nearby.slice(0, 2);
    sites.forEach((p) => taken.add(p.id));
    const id = `ZAC${n + 1}`;
    const equipment: ZacEquipment[] = sites.map((p, i) => ({ ...KINDS[(i + n) % KINDS.length], plot: p.id, status: 'prevu' as const }));
    zacs.push({ id, name: NAMES[Math.floor(hashFrac(`${seed.id}#nom`) * NAMES.length)], lots: lots.map((p) => p.id), equipment, participation: ZAC_PARTICIPATION, opened: 0, launched: 0, collected: 0, openedAt: 0 });
    for (const p of lots) Object.assign(p, { municipal: true, zacId: id, zacRole: 'lot' as const });
    sites.forEach((p) => Object.assign(p, { municipal: true, zacId: id, zacRole: 'equipement' as const, issue: undefined }));
  }
  return zacs;
}

/** Ouvre le prochain lot de chaque ZAC quand son tour de phasage est venu (un appel d'offres de ZAC à la fois). */
export function openZacLots(state: GameState, worth: (s: GameState, plot: Plot, spec: TenderSpec) => number): GameState {
  let s = state;
  for (const zac of state.zacs) {
    const current = s.zacs.find((z) => z.id === zac.id)!;
    if (openTenders(s).some((t) => t.spec.zacId === zac.id)) continue;
    // Phasage : un nouveau lot tous les `ZAC_LOT_GAP` trimestres après le dernier ouvert.
    if (current.opened > 0 && s.round < current.openedAt + ZAC_LOT_GAP) continue;
    const busy = new Set(openTenders(s).map((t) => t.plotId));
    const plotId = current.lots.find((id) => {
      const p = s.plots.find((x) => x.id === id);
      return p && p.municipal && p.owner === null && !busy.has(id);
    });
    if (!plotId) continue;
    s = openTender(s, worth, { plotId, programme: zacProgramme(current), zacId: zac.id });
    s = { ...s, zacs: s.zacs.map((z) => (z.id === zac.id ? { ...z, opened: z.opened + 1, openedAt: s.round } : z)) };
    if (current.opened === 0) {
      s = withEvent(s, {
        kind: 'commune',
        tone: 'info',
        popup: true,
        code: 'zac-ouverte',
        text: `La commune lance la ZAC ${current.name} : ${current.lots.length} lots attribués l’un après l’autre, et ${current.equipment.map((e) => e.label).join(' + ')} financés par les participations (${current.participation} € par m² de plancher). Premier lot ouvert maintenant.`,
      });
    }
  }
  return s;
}

/** Un lot de ZAC est lancé : la participation est versée, et les équipements démarrent quand assez de lots sont lancés. */
export function zacOnLaunch(state: GameState, zacId: string, sdp: number): GameState {
  const zac = state.zacs.find((z) => z.id === zacId);
  if (!zac) return state;
  const next = { ...zac, launched: zac.launched + 1, collected: zac.collected + zac.participation * sdp };
  return advanceZac({ ...state, zacs: state.zacs.map((z) => (z.id === zacId ? next : z)) }, zacId);
}

/** Fait avancer les équipements d'une ZAC : démarrage selon le nombre de lots lancés, livraison après le chantier. */
function advanceZac(state: GameState, zacId: string): GameState {
  let s = state;
  const zac = s.zacs.find((z) => z.id === zacId)!;
  const n = zac.equipment.length;
  const allLaunched = zac.launched >= zac.lots.length;
  const equipment = zac.equipment.map((e, j) => {
    if (e.status === 'prevu' && (allLaunched || zac.launched >= Math.ceil(((j + 1) * zac.lots.length) / (n + 1)))) return { ...e, status: 'chantier' as const, deliverAt: s.round + EQUIPMENT_BUILD_ROUNDS };
    if (e.status === 'chantier' && s.round >= (e.deliverAt ?? Infinity)) {
      s = withEvent(s, { kind: 'commune', tone: 'good', popup: true, code: 'zac-equipement', ref: { plot: e.plot }, text: `${zac.name} : ${e.label} livré. Les logements de la ZAC gagnent ${Math.round(e.premium * 100)} % de valeur à la vente.` });
      return { ...e, status: 'livre' as const };
    }
    return e;
  });
  const started = equipment.filter((e, j) => e.status !== zac.equipment[j].status && e.status === 'chantier');
  if (started.length) s = withEvent(s, { kind: 'commune', tone: 'info', code: 'zac-chantier', text: `${zac.name} : début des travaux (${started.map((e) => e.label).join(', ')}), livraison dans ${EQUIPMENT_BUILD_ROUNDS} trimestres.` });
  return { ...s, zacs: s.zacs.map((z) => (z.id === zacId ? { ...z, equipment } : z)) };
}

/** Chaque trimestre : les équipements en chantier avancent et se livrent. */
export function advanceZacs(state: GameState): GameState {
  let s = state;
  for (const z of state.zacs) s = advanceZac(s, z.id);
  return s;
}

/** Hausse des prix de vente des logements d'une ZAC grâce aux équipements livrés. */
export function zacPremium(state: GameState, zacId: string | undefined): number {
  if (!zacId) return 0;
  return (state.zacs.find((z) => z.id === zacId)?.equipment ?? []).filter((e) => e.status === 'livre').reduce((t, e) => t + e.premium, 0);
}
