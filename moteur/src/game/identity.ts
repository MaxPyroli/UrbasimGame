import { nextRandom } from './rng';

/** Identité d'une société de promotion : nom, slogan et couleur (utilisée sur la carte et dans les classements). */
export interface Identity {
  name: string;
  slogan: string;
  color: string;
}

/** Couleurs proposées : bien distinctes les unes des autres sur la carte, lisibles sur fond clair comme sombre. */
export const PALETTE = ['#1a9850', '#3b6fd4', '#8e54c9', '#d6336c', '#e8590c', '#0c8599', '#b08900', '#495057'] as const;

/**
 * Noms tirés au hasard : des jeux de mots manifestement fictifs, inspirés du ton des promoteurs, qui ne reprennent aucun
 * nom réel tel quel. À utiliser pour les concurrents ordinateur et pour le bouton « au hasard ».
 */
export const PARODIES: { name: string; slogan: string }[] = [
  { name: 'Nexitoi Promotion', slogan: 'Votre voisin de demain, dès aujourd’hui' },
  { name: 'Bougres Immobilier', slogan: 'On construit, vous grognez' },
  { name: 'Vain-Si Constructions', slogan: 'Tout est possible, sauf le permis' },
  { name: 'Kauffmane & Brode', slogan: 'Des murs, des idées, des broderies' },
  { name: 'Icarre Aménagement', slogan: 'Voir plus haut, tomber moins bas' },
  { name: 'Alta Rhéa Cogitem', slogan: 'Réfléchir avant de bétonner' },
  { name: 'Eiffelage Immobilier', slogan: 'La tour de contrôle de vos marges' },
  { name: 'Pichtre Développement', slogan: 'Peuchère, quel beau chantier' },
  { name: 'Maringant Résidences', slogan: 'La bataille du m² est gagnée d’avance' },
  { name: 'Emergie Urbaine', slogan: 'De terre en terre, nous émergeons' },
  { name: 'Sauge-Prompt Promotion', slogan: 'Livraison immédiate (ou presque)' },
  { name: 'Quart-Tus & Fils', slogan: 'Le quart du prix, le tout du bruit' },
  { name: 'Les Nouveaux Constricteurs', slogan: 'Nous serrons les coûts, pas les délais' },
  { name: 'Linkcitron Immobilier', slogan: 'Une ville pleine de peps' },
  { name: 'Sprite & Pierre', slogan: 'Fraîcheur garantie sur toute la façade' },
  { name: 'Redmen Habitat', slogan: 'Rouge à lèvres, rouge à lots' },
  { name: 'Brique-Moi Promotion', slogan: 'Prix ferme, mur porteur' },
  { name: 'SCI Trop-Beau-Pour-Être-Vrai', slogan: 'Plan masse, marge masse' },
  { name: 'Grue & Associés', slogan: 'Toujours en l’air, jamais en retard' },
  { name: 'Parpaing Prestige', slogan: 'Le luxe à l’état brut' },
  { name: 'Toit Pour Vous Immobilier', slogan: 'Des logements qui tiennent la route' },
  { name: 'Béton Fontaine Développement', slogan: 'Coulé sur place' },
  { name: 'Fondations & Illusions', slogan: 'On creuse, on rêve, on vend' },
  { name: 'Maison Plus-Value', slogan: 'Votre rendement a de la hauteur' },
];

/** Mots qui ne comptent pas pour les initiales. */
const NOISE = new Set(['immobilier', 'promotion', 'développement', 'developpement', 'aménagement', 'amenagement', 'résidences', 'residences', 'habitat', 'constructions', 'sci', 'et', 'les', 'le', 'la', 'des', 'de', 'du', '&', 'associés', 'associes', 'fils']);

/** Deux lettres pour le monogramme : initiales des deux premiers mots significatifs. */
export function monogram(name: string): string {
  const words = name
    .split(/[\s\-’']+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  const main = words.filter((w) => !NOISE.has(w.toLowerCase()));
  const pick = (main.length >= 2 ? main : words).slice(0, 2);
  const letters = pick.length >= 2 ? pick.map((w) => w[0]).join('') : (pick[0] ?? '??').slice(0, 2);
  return letters.toUpperCase();
}

/** Nom saisi par le joueur : espaces nettoyés, sans caractères de contrôle, 28 caractères au plus ; défaut si vide. */
export function sanitizeName(raw: string, fallback = 'Ma Promotion'): string {
  const cleaned = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 28).trim();
  return cleaned || fallback;
}

/** Slogan facultatif : 60 caractères au plus. */
export const sanitizeSlogan = (raw: string) => raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);

/** Tirage déterministe d'un entier dans [0, n) à partir d'un état de générateur. */
function draw(state: number, n: number): [number, number] {
  const [u, next] = nextRandom(state);
  return [Math.floor(u * n), next];
}

/** Identité au hasard (reproductible avec la même graine), en évitant les noms et couleurs donnés. */
export function randomIdentity(seed: number, avoid: { names?: string[]; colors?: string[] } = {}): Identity {
  let st = seed >>> 0;
  const names = PARODIES.filter((p) => !(avoid.names ?? []).includes(p.name));
  const colors = PALETTE.filter((c) => !(avoid.colors ?? []).includes(c));
  let i: number;
  let j: number;
  [i, st] = draw(st, names.length);
  [j, st] = draw(st, colors.length);
  const pick = names[i];
  return { name: pick.name, slogan: pick.slogan, color: colors[j] };
}

/** Identités des trois concurrents ordinateur : toutes différentes entre elles et de celle du joueur. */
export function botIdentities(seed: number, player: Identity): Identity[] {
  const out: Identity[] = [];
  const names = [player.name];
  const colors = [player.color];
  for (let k = 0; k < 3; k++) {
    const id = randomIdentity((seed + 7919 * (k + 1)) >>> 0, { names, colors });
    out.push(id);
    names.push(id.name);
    colors.push(id.color);
  }
  return out;
}
