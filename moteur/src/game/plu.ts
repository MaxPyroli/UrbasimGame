import type { Criteria } from '../engine';
import type { Density, ZoneFamily } from './types';

/**
 * PLU simplifié du jeu. Le vrai règlement (plusieurs dizaines de pages par zone, dont la hauteur sur un plan à part)
 * est résumé en 7 familles de zones et 5 règles faciles à lire. Les familles viennent du vrai zonage (Géoportail de
 * l'Urbanisme) ; les valeurs sont des ordres de grandeur inspirés du type de zone, pas le règlement réel.
 */
export interface ZoneRule {
  family: ZoneFamily;
  /** Nom court affiché au joueur. */
  label: string;
  /** Une phrase qui dit ce que cette zone permet. */
  summary: string;
  /** Peut-on y construire (un promoteur) ? */
  buildable: boolean;
  /** Hauteur maximale en niveaux (R+x), attique compris. */
  maxLevels: number;
  /** Emprise au sol maximale (part de la parcelle). */
  maxCoverage: number;
  /** Pleine terre minimale (part de la parcelle). */
  minOpenGround: number;
  /** Retraits imposés (m) : en fond de parcelle et sur les côtés. */
  setbackFond: number;
  setbackLateral: number;
  /** Nombre maximal de bâtiments sur un même terrain, et distance minimale entre eux (m) : 2 permet un bâtiment arrière. */
  maxBuildings: number;
  buildingGap: number;
  /** Implantation : « rue » = le bâtiment doit s'aligner sur la rue (front bâti continu), « libre » = au choix du promoteur (rue ou fond de parcelle). */
  alignment: 'rue' | 'libre';
  /** Destination : logements ou bureaux et activités. */
  use: 'logement' | 'bureaux';
  /** Couleur de la zone sur la carte. */
  color: string;
}

export const ZONE_RULES: Record<ZoneFamily, ZoneRule> = {
  centre: { family: 'centre', maxBuildings: 2, buildingGap: 8, alignment: 'rue', label: 'Centralité', summary: 'Centre-ville dense : on peut construire haut, jusqu’en limite de parcelle, mais le bâtiment doit s’aligner sur la rue.', buildable: true, maxLevels: 6, maxCoverage: 0.8, minOpenGround: 0.1, setbackFond: 0, setbackLateral: 0, use: 'logement', color: '#d95f02' },
  renouvellement: { family: 'renouvellement', maxBuildings: 4, buildingGap: 6, alignment: 'libre', label: 'Renouvellement urbain', summary: 'Secteur à densifier : la hauteur la plus généreuse du quartier.', buildable: true, maxLevels: 7, maxCoverage: 0.7, minOpenGround: 0.15, setbackFond: 3, setbackLateral: 0, use: 'logement', color: '#c2185b' },
  mixte: { family: 'mixte', maxBuildings: 3, buildingGap: 6, alignment: 'libre', label: 'Zone mixte', summary: 'Habitat et activités mêlés : immeubles moyens.', buildable: true, maxLevels: 4, maxCoverage: 0.6, minOpenGround: 0.2, setbackFond: 4, setbackLateral: 0, use: 'logement', color: '#e6ab02' },
  pavillonnaire: { family: 'pavillonnaire', maxBuildings: 3, buildingGap: 4, alignment: 'libre', label: 'Habitat individuel', summary: 'Quartier pavillonnaire : petits gabarits (R+1 avec combles), peu d’emprise, de grands jardins. Il faut assembler des terrains pour faire un projet de taille.', buildable: true, maxLevels: 2, maxCoverage: 0.4, minOpenGround: 0.35, setbackFond: 5, setbackLateral: 3, use: 'logement', color: '#b08968' },
  preservation: { family: 'preservation', maxBuildings: 1, buildingGap: 8, alignment: 'libre', label: 'Préservation', summary: 'Tissu ancien à préserver : petit gabarit, jardins protégés.', buildable: true, maxLevels: 2, maxCoverage: 0.45, minOpenGround: 0.35, setbackFond: 5, setbackLateral: 3, use: 'logement', color: '#7570b3' },
  activites: { family: 'activites', maxBuildings: 3, buildingGap: 6, alignment: 'libre', label: 'Activités économiques', summary: 'Zone d’activités : bureaux et locaux d’activité, pas de logements.', buildable: true, maxLevels: 3, maxCoverage: 0.65, minOpenGround: 0.15, setbackFond: 4, setbackLateral: 0, use: 'bureaux', color: '#1b9e77' },
  equipement: { family: 'equipement', maxBuildings: 1, buildingGap: 0, alignment: 'libre', label: 'Équipement public', summary: 'Réservé aux équipements publics (écoles, services) : inconstructible pour un promoteur.', buildable: false, maxLevels: 0, maxCoverage: 0, minOpenGround: 1, setbackFond: 0, setbackLateral: 0, use: 'logement', color: '#6c8ebf' },
  nature: { family: 'nature', maxBuildings: 1, buildingGap: 0, alignment: 'libre', label: 'Zone naturelle', summary: 'Parc, cimetière ou espace naturel : inconstructible.', buildable: false, maxLevels: 0, maxCoverage: 0, minOpenGround: 1, setbackFond: 0, setbackLateral: 0, use: 'logement', color: '#66a61e' },
};

const norm = (s: string) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, ' ');

/**
 * Famille de jeu d'une zone du PLU, d'après son type (U, AU, A, N), son code et son libellé long. Les libellés varient
 * beaucoup d'une commune à l'autre (« Habitat individuel », « Zone urbaine générale », « UDa »…) : on cherche des mots
 * clés, dans l'ordre du plus spécifique au plus général, et à défaut du libellé on se rabat sur la lettre du code.
 * Reste en « zone mixte » quand rien ne permet de trancher.
 */
export function zoneFamily(typezone: string, libelle: string, libelong: string): ZoneFamily {
  const t = (typezone || '').toUpperCase();
  if (t === 'N' || t === 'A') return 'nature';
  const long = norm(libelong);
  const code = (libelle || '').trim();
  const has = (...words: string[]) => words.some((w) => long.includes(w));
  if (has('equipement', 'grands services', 'vocation d equipement')) return 'equipement';
  // Parcs, jardins familiaux, zones vertes, naturelles ou agricoles : pas constructibles.
  if (has('zone urbaine verte', 'jardins familiaux', 'naturel', 'agricole', 'forestier', 'cimetiere')) return 'nature';
  // Activités économiques, sauf quand le libellé parle aussi d'habitat (« forte mixité de l'habitat et des activités »).
  if (has('activit', 'industri', 'artisanal', 'entrepot') && !has('habitat', 'residentiel', 'logement', 'mixte', 'mixite')) return 'activites';
  if (has('renouvellement')) return 'renouvellement';
  if (has('coeur de ville', 'centre ville', 'centre-ville', 'centralit', 'zone urbaine generale') || (has('centre') && !has('peripher'))) return 'centre';
  if (has('peripherie immediate') && has('centre ville')) return 'centre';
  // Quartiers pavillonnaires : habitat individuel sauf s'il s'agit d'un front bâti, de collectif ou de mixité.
  if (has('habitat individuel', 'individuel', 'pavillonn', 'faible densite', 'extensions en peripherie') && !has('collectif', 'immeuble', 'front bati', 'mixte', 'mixite')) return 'pavillonnaire';
  if (has('preservation', 'patrimoine', 'patrimonial', 'traditionnel', 'sauvegard', 'jardins ou d espaces libres', 'a proteger', 'paysager')) return 'preservation';
  if (has('mixte', 'mixite')) return 'mixte';
  // Libellé absent ou identique au code : la lettre du code donne souvent la famille (UA centre, UD pavillonnaire…), à défaut on reste prudent.
  // (« Urbaine » seul ne dit rien non plus : plusieurs communes l'ont pour libellé de toutes leurs zones U.)
  if (!long || long === norm(code) || /^(zone )?(urbaine|a urbaniser)$/.test(long)) {
    const c = code.toUpperCase();
    if (/^UA/.test(c)) return 'centre';
    if (/^(UD|UE|UH|UP)/.test(c)) return 'pavillonnaire';
    if (/^(UY|UI|UX)/.test(c)) return 'activites';
    if (/^UL/.test(c)) return 'equipement';
  }
  return 'mixte';
}

/** Règle applicable à un terrain qui touche plusieurs zones : la plus restrictive sur chaque point. */
export function combineRules(families: ZoneFamily[]): ZoneRule {
  const rules = families.map((f) => ZONE_RULES[f]);
  if (rules.length === 1) return rules[0];
  const blocked = rules.find((r) => !r.buildable);
  if (blocked) return blocked;
  const base = rules.reduce((a, b) => (b.maxLevels < a.maxLevels ? b : a));
  return {
    ...base,
    maxCoverage: Math.min(...rules.map((r) => r.maxCoverage)),
    minOpenGround: Math.max(...rules.map((r) => r.minOpenGround)),
    setbackFond: Math.max(...rules.map((r) => r.setbackFond)),
    setbackLateral: Math.max(...rules.map((r) => r.setbackLateral)),
    alignment: rules.some((r) => r.alignment === 'rue') ? 'rue' : 'libre',
    maxBuildings: Math.min(...rules.map((r) => r.maxBuildings)),
    buildingGap: Math.max(...rules.map((r) => r.buildingGap)),
    use: rules.some((r) => r.use === 'bureaux') ? 'bureaux' : 'logement',
  };
}

/**
 * Les règles d'une zone s'adaptent au tissu bâti autour du terrain : dans un tissu dense (ultra-centre), les bâtiments sont
 * mitoyens, donc pas de retrait latéral, un retrait de fond réduit et plus d'emprise ; en tissu diffus, la règle de la zone
 * s'applique telle quelle.
 */
export function adaptToDensity(rule: ZoneRule, density: Density | undefined): ZoneRule {
  if (!rule.buildable || density !== 'dense') return rule;
  return {
    ...rule,
    setbackLateral: 0,
    alignment: 'rue',
    setbackFond: Math.min(rule.setbackFond, 2),
    maxCoverage: Math.min(0.85, rule.maxCoverage + 0.15),
    minOpenGround: Math.max(0.1, rule.minOpenGround - 0.1),
    summary: `${rule.summary} Tissu dense : bâtiments mitoyens, construction en limite séparative, alignement sur la rue.`,
  };
}

/** Hauteur (m) correspondant à R+x : rez-de-chaussée puis étages courants (valeurs par défaut du moteur). */
export const heightOfLevels = (levels: number, c: Pick<Criteria, 'groundFloorHeight' | 'floorHeight'>) => c.groundFloorHeight + c.floorHeight * levels;

/**
 * Critères d'un projet une fois le PLU appliqué : les choix du joueur (niveaux, attique, stationnement, profondeur)
 * sont conservés, les contraintes de la zone (hauteur, emprise, pleine terre, retraits, destination) s'imposent.
 */
export function applyRule(base: Criteria, rule: ZoneRule): Criteria {
  return {
    ...base,
    maxHeight: heightOfLevels(rule.maxLevels, base) + 0.05,
    maxCoverage: rule.maxCoverage,
    minOpenGround: rule.minOpenGround,
    // La règle de la zone fait foi : ses retraits remplacent ceux par défaut du moteur.
    setbackFond: rule.setbackFond,
    setbackLateral: rule.setbackLateral,
    // Alignement obligatoire sur rue : le bâtiment longe la rue, pas de bâtiment en fond de parcelle.
    placement: rule.alignment === 'rue' ? 'rue' : base.placement,
    // Deuxième bâtiment : seulement si la zone l'autorise ; le bâtiment arrière est plus bas que celui sur rue.
    secondBuilding: base.secondBuilding && rule.maxBuildings >= 2,
    buildingGap: Math.max(base.buildingGap, rule.buildingGap),
    maxBuildings: Math.min(base.maxBuildings, rule.maxBuildings),
    secondLevels: base.secondLevels === null ? null : Math.max(0, Math.min(base.secondLevels, rule.maxLevels)),
    upperUse: rule.use,
    groundFloorUse: rule.use === 'bureaux' ? 'commerce' : base.groundFloorUse,
  };
}

/** Niveaux (R+x) autorisés, attique compris : l'attique compte comme un niveau. */
export const allowedLevels = (rule: ZoneRule, attic: boolean) => Math.max(0, rule.maxLevels - (attic ? 1 : 0));
