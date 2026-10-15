/** Nouveautés par version bêta (la plus récente en premier). Une entrée par version publiée. */
export interface Release {
  version: string;
  title: string;
  notes: string[];
}

export const CHANGELOG: Release[] = [
  {
    version: '0.10.0',
    title: 'Sucy-en-Brie et bâtiments multiples',
    notes: [
      'Nouvelle carte : Sucy-en-Brie, toute la ville (plus de 7 000 parcelles), banlieue éloignée du Val-de-Marne avec de grands terrains et des prix plus bas. Choix de la carte sur l’écran d’accueil, une sauvegarde par carte',
      'Les promoteurs (vous, les concurrents, les appels d’offres) occupent maintenant le terrain au mieux : un ou plusieurs bâtiments, derrière celui sur rue ou à côté, dès que le PLU le permet et qu’il y a la place. Plus de case à cocher : c’est automatique, et « Meilleur projet » compare avec un seul bâtiment',
      'Les parcelles ne débordent plus sur la chaussée : la partie sous les voies est retirée, les « parcelles » qui sont surtout de la voirie sont écartées',
      'PLU : jusqu’à 4 bâtiments en renouvellement urbain, 3 en zone mixte ou d’activités, 2 en centre, 1 en préservation',
      'Plus de fluidité sur les grandes cartes (affichage allégé, infobulles à la demande, sauvegarde compacte) ; les prix de référence ont été recalculés',
    ],
  },
  {
    version: '0.9.2',
    title: 'Deux bâtiments sur un terrain',
    notes: [
      'Si le PLU de la zone l’autorise, un second bâtiment peut être construit au fond du terrain, derrière celui sur rue (case « deuxième bâtiment au fond » du projet)',
      'Il faut un terrain assez profond : un recul entre les bâtiments est exigé, et le fond est desservi par une allée ou, à défaut, un porche percé dans le bâtiment sur rue',
      'Le « Meilleur projet » essaie désormais aussi un bâtiment arrière ; les deux bâtiments sont dessinés sur la carte',
      'L’emprise et la densité du terrain sont partagées entre les deux bâtiments',
    ],
  },
  {
    version: '0.9.1',
    title: 'Projets sur plusieurs terrains',
    notes: [
      'Offre groupée « tout ou rien » : si une parcelle échappe, rien n’est acheté ; si tout est remporté, les parcelles sont assemblées d’office',
      'Plan d’acquisition : statut de chaque parcelle, prix prévu, chance d’acceptation, concurrents, parcelles bloquées, total à bloquer et prix maximal pour la marge visée',
      'Niveau d’offre standard ou sûr, voisines à ajouter en un clic, simulation du projet sur l’ensemble',
    ],
  },
  {
    version: '0.9',
    title: 'ZAC, densité, simulation',
    notes: [
      'ZAC : quartier de plusieurs lots attribués l’un après l’autre, équipements publics (école, square) financés par les promoteurs, qui font monter les prix une fois livrés',
      'Règles d’urbanisme adaptées à la densité du quartier : en centre dense, construction en limite et alignement sur la rue',
      'Choix de l’implantation du bâtiment (rue ou fond) et de sa forme ; emprises plus réalistes',
      'Simulation d’un projet sur plusieurs parcelles avant d’acheter ; offres groupées ; propriétaires spéculateurs',
      'Parcelles « délaissées » grisées ; résumé de lecture d’un terrain ; carte agrandie ; animations',
    ],
  },
  {
    version: '0.8',
    title: 'Installation et notifications',
    notes: [
      'Écran d’accueil, installation de l’application, utilisable hors ligne',
      'Notifications, fenêtres d’alerte sur les aléas, barres de progression des délais',
      'Bâtiments des promoteurs sur la carte (hachurés en chantier), pictogrammes d’équipements',
    ],
  },
  {
    version: '0.7',
    title: 'Appels d’offres de la commune',
    notes: ['Terrains communaux attribués au meilleur projet : logements sociaux, qualité, délai', 'Cadres ZAC, PUP et quartier prioritaire avec leurs avantages'],
  },
  {
    version: '0.6',
    title: 'Enjeux',
    notes: ['Enchères et prospection des terrains', 'Dettes, faillite, objectif de fin de partie et niveaux de difficulté'],
  },
  {
    version: '0.5',
    title: 'Première version jouable',
    notes: ['Vraies parcelles de Montreuil, assemblage, PLU simplifié', 'Ventes sur plan, financement bancaire, concurrents ordinateur, société personnalisable'],
  },
];
