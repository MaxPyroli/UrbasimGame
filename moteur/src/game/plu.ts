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
  /** Implantation : « rue » = le bâtiment doit s'aligner sur la rue (front bâti continu), « libre » = au choix du promoteur (rue ou fond de parcelle). */
  alignment: 'rue' | 'libre';
  /** Destination : logements ou bureaux et activités. */
  use: 'logement' | 'bureaux';
  /** Couleur de la zone sur la carte. */
  color: string;
}

export const ZONE_RULES: Record<ZoneFamily, ZoneRule> = {
  centre: { family: 'centre', alignment: 'rue', label: 'Centralité', summary: 'Centre-ville dense : on peut construire haut, jusqu’en limite de parcelle, mais le bâtiment doit s’aligner sur la rue.', buildable: true, maxLevels: 6, maxCoverage: 0.8, minOpenGround: 0.1, setbackFond: 0, setbackLateral: 0, use: 'logement', color: '#d95f02' },
  renouvellement: { family: 'renouvellement', alignment: 'libre', label: 'Renouvellement urbain', summary: 'Secteur à densifier : la hauteur la plus généreuse du quartier.', buildable: true, maxLevels: 7, maxCoverage: 0.7, minOpenGround: 0.15, setbackFond: 3, setbackLateral: 0, use: 'logement', color: '#c2185b' },
  mixte: { family: 'mixte', alignment: 'libre', label: 'Zone mixte', summary: 'Habitat et activités mêlés : immeubles moyens.', buildable: true, maxLevels: 4, maxCoverage: 0.6, minOpenGround: 0.2, setbackFond: 4, setbackLateral: 0, use: 'logement', color: '#e6ab02' },
  preservation: { family: 'preservation', alignment: 'libre', label: 'Préservation', summary: 'Tissu ancien à préserver : petit gabarit, jardins protégés.', buildable: true, maxLevels: 2, maxCoverage: 0.45, minOpenGround: 0.35, setbackFond: 5, setbackLateral: 3, use: 'logement', color: '#7570b3' },
  activites: { family: 'activites', alignment: 'libre', label: 'Activités économiques', summary: 'Zone d’activités : bureaux et locaux d’activité, pas de logements.', buildable: true, maxLevels: 3, maxCoverage: 0.65, minOpenGround: 0.15, setbackFond: 4, setbackLateral: 0, use: 'bureaux', color: '#1b9e77' },
  equipement: { family: 'equipement', alignment: 'libre', label: 'Équipement public', summary: 'Réservé aux équipements publics (écoles, services) : inconstructible pour un promoteur.', buildable: false, maxLevels: 0, maxCoverage: 0, minOpenGround: 1, setbackFond: 0, setbackLateral: 0, use: 'logement', color: '#6c8ebf' },
  nature: { family: 'nature', alignment: 'libre', label: 'Zone naturelle', summary: 'Parc, cimetière ou espace naturel : inconstructible.', buildable: false, maxLevels: 0, maxCoverage: 0, minOpenGround: 1, setbackFond: 0, setbackLateral: 0, use: 'logement', color: '#66a61e' },
};

/** Famille de zone à partir des champs du Géoportail de l'Urbanisme (`typezone`, `libelle`, `libelong`). */
export function zoneFamily(typezone: string, libelle: string, libelong: string): ZoneFamily {
  const t = (typezone || '').toUpperCase();
  if (t === 'N' || t === 'A') return 'nature';
  const long = (libelong || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (long.includes('equipement')) return 'equipement';
  if (long.includes('activit')) return 'activites';
  if (long.includes('renouvellement')) return 'renouvellement';
  if (long.includes('centralit') || long.includes('centre')) return 'centre';
  if (long.includes('preservation') || long.includes('patrimoine') || long.includes('pavillon')) return 'preservation';
  if (long.includes('mixte')) return 'mixte';
  // Libellés non reconnus : le code donne souvent la famille (UA, UB… varient d'une commune à l'autre : on reste prudent).
  void libelle;
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
    upperUse: rule.use,
    groundFloorUse: rule.use === 'bureaux' ? 'commerce' : base.groundFloorUse,
  };
}

/** Niveaux (R+x) autorisés, attique compris : l'attique compte comme un niveau. */
export const allowedLevels = (rule: ZoneRule, attic: boolean) => Math.max(0, rule.maxLevels - (attic ? 1 : 0));
