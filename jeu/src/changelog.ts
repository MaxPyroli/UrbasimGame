/** Nouveautés par version bêta (la plus récente en premier). Une entrée par version publiée. */
export interface Release {
  version: string;
  title: string;
  notes: string[];
}

export const CHANGELOG: Release[] = [
  { version: '0.17.1', title: 'Nouveautés discrètes', notes: ['Les notes de version ne s’ouvrent plus d’elles-mêmes : une icône en haut de l’accueil s’anime quand il y a du nouveau'] },
  { version: '0.17.0', title: 'Classement façon Mario Party', notes: ['Plus d’objectif chiffré : on joue pour la 1re place, avec un classement vertical animé (bilan chaque année, fin de partie) ; l’accueil suit l’heure de la journée'] },
  { version: '0.16.0', title: 'Nouvel écran d’accueil', notes: ['Accueil animé (quartier qui sort de terre, grue, nuages) ; nouvelle partie : villes prédéfinies ou ville de votre choix (bêta)'] },
  { version: '0.15.1', title: 'Recherche de commune plus fiable', notes: ['Si le service des communes ne répond pas, la recherche passe par le géocodeur de l’IGN'] },
  { version: '0.15.0', title: 'Un seul mode de jeu', notes: ['Plus de choix de difficulté : une partie, objectif ×2 la mise'] },
  { version: '0.14.2', title: 'Carte libre : communes lentes', notes: ['Communes dont le cadastre répondait trop lentement (Noisy, Bourges, Chamonix) : sélection par contour ; secteur seulement pour les grandes villes'] },
  { version: '0.14.1', title: 'Carte libre : grandes villes et reprise', notes: ['Secteur autour du centre pour les très grandes villes, reprise après coupure, ventes réelles lues depuis le navigateur'] },
  { version: '0.14.0', title: 'Carte libre (bêta)', notes: ['Cartes › Une autre commune : cherchez n’importe quelle commune de France, elle se prépare en une à deux minutes puis reste sur l’appareil'] },
  { version: '0.13.6', title: 'Fini les bandes interminables', notes: ['Bâtiments de 55 m au plus de long et 8 m au moins de large (6 m en tissu dense) ; le reste du terrain accueille d’autres bâtiments'] },
  { version: '0.13.5', title: 'Bâtiments plus nets', notes: ['Les emprises qui contournent un terrain par plusieurs rues redeviennent un rectangle net'] },
  { version: '0.13.4', title: 'Barres du haut stables', notes: ['Les barres Objectif et Trimestre ne rejouent plus leur animation à chaque clic'] },
  { version: '0.13.3', title: 'Meilleur projet par défaut', notes: ['Chaque terrain s’ouvre sur son meilleur projet (immeuble ou maisons, niveaux, attique)'] },
  { version: '0.13.2', title: 'Chargement des cartes beaucoup plus rapide', notes: ['Prix par zone (avec bonus de situation), sans parcelles naturelles ni équipements publics à l’achat, ZAC de part et d’autre d’une rue'] },
  { version: '0.13.1', title: 'Zones mixtes et prix', notes: ['Zones du PLU qui se recouvrent : la plus précise s’applique (mixte de Sucy) ; prix demandés alignés sur le potentiel du terrain'] },
  { version: '0.13.0', title: 'Prix réalistes et ensembles de maisons', notes: ['Prix des terrains alignés sur le bâti existant, type « maisons » en zone pavillonnaire, terrain refinancé par la banque au lancement'] },
  { version: '0.12.5', title: 'Quartiers pavillonnaires un peu plus souples', notes: ['Habitat individuel : 50 % d’emprise, retraits de 4 m au fond et 2 m sur les côtés (réglage provisoire avant les ensembles de maisons)'] },
  { version: '0.12.4', title: 'Carte limitée à la commune', notes: ['Le bâti, le zonage et les voies ne dépassent plus sur les communes voisines : on ne voit que l’intérieur du contour de la commune'] },
  { version: '0.12.3', title: 'Fenêtre des nouveautés', notes: ['S’ouvre en haut et ne montre que les dernières versions (les anciennes sont repliées)'] },
  {
    version: '0.12.2',
    title: 'PLU : les quartiers pavillonnaires',
    notes: [
      'Correction importante du zonage : les zones « habitat individuel » (pavillons) étaient prises pour des zones mixtes constructibles jusqu’en R+4. Nouvelle famille « Habitat individuel » : R+1 avec combles, 40 % d’emprise, 35 % de pleine terre, retraits de 5 m au fond et 3 m sur les côtés',
      'Le jeu lit mieux les PLU de chaque ville (libellés, et à défaut la lettre du code de zone) : Paris 11e passe en zone de centre, les quartiers pavillonnaires de Sucy, Brie, Biarritz et Murat sont reconnus, les tissus mixtes habitat et activités de Villeurbanne ne sont plus pris pour des zones d’activités, les zones vertes sont inconstructibles',
      'Conséquence : les prix des terrains pavillonnaires baissent fortement (Sucy : 223 k€ médians au lieu de 600 k€, soit 471 €/m² au lieu de 1 316 €/m²) et la mise de départ de Sucy passe de 1,5 M€ à 1,05 M€. Des parcelles trop étroites pour les retraits demandent maintenant d’être assemblées',
    ],
  },
  {
    version: '0.12.1',
    title: 'Nouveau logo et une seule police',
    notes: [
      'Nouveau logo : une skyline qui monte vers une tour à balise, avec un soleil levant. Le même dessin partout : icône du navigateur, écran d’accueil, barre du haut, icône installée sur le téléphone',
      'La police Alte Haas Grotesk s’applique maintenant partout, y compris sur la carte (cartes flottantes, légende, infobulles, boutons de zoom), les cases à cocher, les menus et les pastilles d’équipement',
      'Barre du haut : sur les écrans moyens elle passe sur deux lignes (le menu ne sort plus de l’écran) et le numéro de version la quitte au profit du joueur',
    ],
  },
  {
    version: '0.12.0',
    title: 'Page des cartes et six nouvelles villes',
    notes: [
      'Nouvelle page « Choisir une carte » : on télécharge une ville une fois (barre de progression), elle reste sur l’appareil et se joue ensuite même sans réseau ; on peut la supprimer pour libérer la place',
      'Six villes à tester, de 1 900 à 11 800 €/m² : Paris 11e, Villeurbanne, Brie-Comte-Robert, Biarritz, Bourges (centre) et Murat (rural, presque sans ventes)',
      'Les prix de chaque ville suivent ses ventes réelles : le niveau de prix du neuf se déduit de l’ancien (prime plus forte dans les villes bon marché), le foncier suit plus fort, les coûts de construction bien moins',
      'La mise de départ a un plancher : dans une ville où les terrains valent presque rien, elle finance quand même un chantier',
      'Correction : le jeu installable (hors ligne) fonctionne de nouveau après le chargement des cartes',
    ],
  },
  {
    version: '0.11.1',
    title: 'Calculs plus rapides',
    notes: ['Le placement du bâtiment est réutilisé d’un niveau à l’autre : estimer un terrain, « Meilleur projet » et le tour des concurrents sont 2 à 4 fois plus rapides, avec exactement les mêmes résultats'],
  },
  {
    version: '0.11.0',
    title: 'Le marché réel et la répartition des logements',
    notes: [
      'Statistiques de marché tirées des ventes réelles de la commune (DVF 2022-2025) : part de T1 à T5 achetés, taille et prix au m² de chacun. Les petits logements se vendent plus cher au m², les grands moins cher : à Sucy un T1 se vend environ 4 400 €/m², un T5 environ 2 900 €/m²',
      'Nouveau panneau « Répartition des logements » dans le projet : vous choisissez votre mix, voyez celui du marché et l’adéquation de votre programme. Un programme mal calé se vend plus lentement ; le prix moyen de vente suit la taille des logements',
      'Les concurrents et l’estimation des terrains partent du mix du marché de la carte (Montreuil : plutôt petits logements ; Sucy : plutôt des T3 et plus)',
      'Le nombre de logements par étage suit désormais la surface (règle de surface plutôt qu’une recherche de combinaisons) : calculs bien plus rapides, résultats voisins',
      'Recalcul des prix de Sucy en 4 minutes au lieu de 30',
    ],
  },
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
