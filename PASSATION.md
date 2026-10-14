# Passation : d'Urbasim (outil de pré-faisabilité) au jeu « Urbasim »

Ce dossier est autonome : copiez `./` dans le nouveau dépôt. `moteur/` contient le moteur de calcul, ses
services réseau et ses 129 tests (`npm install && npm test` dans ce dossier). Origine : dépôt `maxpyroli/urbasim`,
branche `claude/beautiful-goldberg-1wk8jn`, commit `50ead9f`. L'outil tourne sur https://maxpyroli.github.io/urbasim/.

## 1. Le projet d'origine

Outil web (Vite + TypeScript + CesiumJS) : on choisit un terrain sur une carte 3D (dessin à la main, ou parcelle
cadastrale IGN), on saisit des critères (R+x, retraits, hauteur, emprise, stationnement, mix de typologies…) et on obtient
un bâtiment généré sur le terrain avec logements, surface de plancher, parking, contrôles, plan masse, vue 3D dans son
environnement, exports KML/GeoJSON. Cible : petits immeubles étroits, constructions mitoyennes, contexte français.

## 2. Le moteur (`moteur/src/engine/`) — TypeScript pur, sans navigateur, déterministe

| Fichier | Rôle |
|---|---|
| `types.ts`, `defaults.ts` | Types (Criteria, Parcel, Project…), critères et hypothèses par défaut (`DEFAULT_ASSUMPTIONS` : ratios noyau, rampes, SHAB/SDP, places…) |
| `geometry.ts` | Projection locale, polygones (polygon-clipping), repère de rue `Frame`, capsules, largeur minimale |
| `layout.ts` | Classement des côtés (rue / latéral / fond), retraits, enveloppe constructible, rôle des façades |
| `footprint.ts` | Emprise : « adaptée » (tranche depuis la rue, L sur terrain d'angle) ou « rectangle inscrit » ; implantation rue / fond / automatique |
| `program.ts` | Niveaux, surface de plancher, noyau, local vélos, remplissage en logements par typologie |
| `parking.ts`, `access.ts` | Places requises, surface / rez-de-chaussée / sous-sol (niveaux, rampe), entrée de parking (porte 3,5 m, allée, rampe) |
| `project.ts` | `computeProject(parcel, criteria)` : orchestre tout et rend un `Project` (indicateurs, contrôles) |
| `scenarios.ts` | Comparaison R+0 à R+9 |
| `buildings.ts` | Bâti voisin IGN BD TOPO : lecture, hauteurs, découpage par le terrain, mention de licence |
| `plu.ts` | Lecture des réponses du Géoportail de l'Urbanisme (zone, règlement PDF, prescriptions) |
| `export.ts`, `ringEdit.ts` | KML / GeoJSON ; édition de contour |

`moteur/src/app/services.ts` : appels réseau sans clé et avec CORS ouvert — cadastre IGN (`fetchCadastreParcel`),
bâtiments (`fetchNearbyBuildings`, WFS Géoplateforme), voies OSM (Overpass), PLU (`fetchPlu`, API Carto GPU), géocodage.
`state.ts` : état de l'appli (non nécessaire au jeu, gardé pour `sanitize`).

L'interface (Cesium, plan masse SVG, panneaux, `main.ts`) est restée dans le dépôt d'origine : à reprendre au besoin.

## 3. Ce qui est vérifié, ce qui ne l'est pas

Vérifié : 129 tests unitaires (dont 5 vrais bâtiments BD TOPO, le client WFS avec faux réseau, l'implantation, le terrain
d'angle, l'entrée de parking) ; parcours navigateur sur le vrai service IGN (parcelle cadastrale AS 0043, Paris : 208
bâtiments, 1 retiré) ; bloc PLU sur Paris (zone UG).

Non vérifié :
- le site en ligne après les 3 derniers envois (terrain d'angle, entrée de parking, PLU) : contrôlés en local seulement ;
- le fond Google 3D avec une vraie clé (indisponible depuis l'EEE, France comprise) ;
- Overpass/OSM (injoignable depuis l'environnement de développement) ;
- le PLU hors Paris (PLUi, cartes communales, plusieurs zones) ;
- l'ouverture du KML dans Google Earth.

Limites connues du moteur : pré-faisabilité, pas un dossier réglementaire ; toiture plate, terrain plat ; ratios
(noyaux, rampes, SHAB/SDP) = ordres de grandeur ; le règlement du PLU n'est pas lu (texte libre dans un PDF) ; un seul
bâtiment par terrain ; accès au bâtiment en fond de parcelle et défense incendie non modélisés.

## 4. L'idée du jeu (à orienter)

Un « Monopoly de la vraie vie » : une carte réelle (échelle à choisir), plusieurs joueurs, chacun promoteur en
concurrence. On achète des terrains, on construit, démolit, surélève, démolit-reconstruit, pour générer des bénéfices ;
il faut rester rentable, avec des variables ajustables. Réalisme fondé sur le moteur. Les **appels d'offres** d'une
collectivité jouent le rôle des enchères du Monopoly.

### Ce qui manque, par priorité
1. **Bilan du promoteur** (cœur du jeu) : prix du terrain, coût de construction au m² de SDP, prix de vente au m²,
   frais, crédit et taux, durée de chantier, marge. Données réelles possibles : ventes immobilières publiques (DVF, prix
   au m² par quartier), indices de coûts de construction.
2. **Serveur** (l'outil est un site statique) : base partagée (propriétés, argent), serveur qui fait foi (validation des
   actions, anti-triche). Le moteur déterministe permet de rejouer et valider.
3. **Tour de jeu** : un tour par trimestre, jouable en asynchrone.
4. **Règles d'urbanisme du jeu** : règles simplifiées par type de zone (hauteur, emprise, retraits), le zonage réel du
   Géoportail servant à choisir la règle applicable.
5. **Appels d'offres** : la commune propose un terrain avec cahier des charges (part de logement social, hauteur max,
   commerces en rez-de-chaussée…) ; offres sur prix + programme + qualité ; sélection par pondération annoncée.
6. **Aléas / événements** : hausse des taux, recours des voisins, sol pollué, fouilles archéologiques, retournement du
   marché (équivalent des cartes chance).

### Décisions à prendre
- Échelle : conseil de départ = un quartier (quelques centaines de parcelles), pas une ville entière.
- Prix réels ou seulement inspirés du réel (à Paris rien n'est rentable en vrai).
- Nombre de joueurs, synchrone ou asynchrone, concurrents gérés par l'ordinateur pour jouer seul.
- Condition de victoire (fortune au bout de N années, autre).
- Nom : le jeu reprend « Urbasim » ; l'outil d'origine peut être renommé.

### Ordre proposé
1. Bilan du promoteur au-dessus du moteur (utile aussi à l'outil de pré-faisabilité).
2. Mode solo : acheter, construire, vendre, avec concurrents gérés par l'ordinateur.
3. Serveur et multijoueur.
4. Appels d'offres et événements.

## 5. Données et licences
- Cadastre et BD TOPO : IGN, Licence Ouverte 2.0 — mention de la source **et de la date de mise à jour** obligatoire
  (`buildingsCredit` produit le texte). Voir README du dépôt d'origine.
- PLU : Géoportail de l'Urbanisme via `apicarto.ign.fr/api/gpu` ; règlements PDF sous `data.geopf.fr/annexes/gpu`.
- Limites du WFS IGN : 30 requêtes/s/IP (blocage 5 s au-delà), 5 000 objets/requête ; le client réessaie (1 s puis 5,5 s).
- Fonds de carte : OpenStreetMap (attribution), photo aérienne IGN. Google 3D Tiles : clé de l'utilisateur, quotas payants.

## 5 bis. État d'avancement (nouveau dépôt)
- Structure : `moteur/` à la racine (`npm install && npm test`, 136 tests).
- Fait : `moteur/src/engine/bilan.ts` — bilan du promoteur (`computeBilan`, `suggestLandPrice`, `MARKETS`,
  `DEFAULT_BILAN_PARAMS`). Prix HT, approximatifs mais proches du réel, 4 marchés (Paris, petite couronne, grande ville,
  ville moyenne) calibrés pour qu'un terrain au prix « normal » donne une marge de 0 à 20 %. Sorties : CA, coûts,
  frais financiers, marge, durée (en trimestres pour le tour de jeu), prix de terrain maximal, seuil de rentabilité.
- Décisions prises : prix approximatifs proches du réel ; un quartier pour la version de test ; multijoueur visé dès le
  début, concurrents ordinateur pour tester.
- Fait : `moteur/src/game/` — état de partie pur, sérialisable et déterministe (`createGame`, `applyAction`,
  `advanceRound`, `netWorth`, `ranking`). Un tour = un trimestre ; actions `buy`, `sellPlot`, `launch`, `ready` ;
  le trimestre se résout quand tous les joueurs sont prêts (asynchrone possible). Indice de marché aléatoire (graine
  dans l'état, rejouable). Flux de trésorerie : terrain payé comptant, refinancé à 80 % au lancement, fonds propres du
  chantier mis sous séquestre, solde encaissé à la fin des ventes ; à marché stable le gain = marge du bilan (testé).
  Après livraison le terrain redevient achetable avec le bâti existant (démolition-reconstruction, surélévation).
  Limites : premier arrivé premier servi pour un même terrain (les appels d'offres viendront), pas de faillite
  (le séquestre garantit le chantier), pas de zonage/PLU de jeu.
- Fait : `moteur/src/game/bot.ts` — concurrents ordinateur (`playBotTurn`, `playBots`, `simulateAllBots`,
  `bestPlan`, `BOT_PROFILES`). Trois tempéraments (prudent / équilibré / agressif : marge minimale, R+x maximal,
  réserve de trésorerie, achats par trimestre). Un bot lance d'abord ses terrains, puis achète le terrain à plus forte
  marge absolue, puis passe. Fonction pure de l'état (pas de hasard propre) ; mélangeable avec des humains
  (le trimestre attend les humains). Simulation d'une partie de 40 trimestres : ~0,1 s.
- Fait : équilibrage (v1). Mécanismes ajoutés dans `game.ts` :
  - prix de terrain = prix de référence × indice de marché × « chaleur » de la demande (chaque achat +2 % sur tous les
    terrains, retombe de 20 %/tour) ; le prix de départ est ce que le meilleur projet jusqu'à R+5 peut payer en
    gardant 7 % de marge (`askMargin`), ±8 % selon le terrain ; trésorerie de départ automatique = 2,5 × prix médian ;
  - les prix de vente suivent l'indice de marché, pas les coûts (cycles : acheter quand le marché est bas) ;
  - crédit à taux variable (marche aléatoire rappelée vers 4,5 %, bornes 1,5–9 %) : intérêts à la livraison selon
    le taux moyen constaté ;
  - portage des terrains sans opération (0,5 %/tour du prix payé) ;
  - événements (40 %/tour, tirés dans l'état) : retournement ou regain de marché, recours (permis +1 tour), sol
    pollué (+3 à 8 % des travaux), fouilles (+2 tours), hausse/baisse des taux. Surcoûts retranchés à la livraison.
  Résultats (24 terrains de 10×30 m, 3 bots, 40 tours, 12 graines) : patrimoine final / départ, médiane ≈ 1,3–1,7
  (prudent, équilibré, avec des pertes possibles, min 0,3–0,6) et ≈ 2,3–4,5 (agressif, dispersion la plus forte).
  Limites : en « ville moyenne » les parties restent trop faciles (terrains très bon marché) ; le profil agressif
  domine encore en moyenne ; les bots ignorent le cycle de marché (n'achètent pas exprès quand il est bas) ;
  parcelles de test identiques (rectangles) — à refaire sur de vraies parcelles cadastrales.
- Fait : **vraies parcelles** (`moteur/src/game/district.ts`, `moteur/src/app/districtFetch.ts`). `npm run district --
  <id> "<nom>" <lon> <lat> <rayon> <marché>` télécharge le cadastre (API Carto IGN) et le bâti (BD TOPO) d'un quartier et
  enregistre un instantané hors ligne dans `moteur/data/districts/<id>.json` (licence : mentions dans `credits`).
  `buildDistrict` (pur) déduit les façades sur rue (arêtes sans parcelle voisine), la SDP existante (emprise × niveaux)
  et écarte miettes (<60 m²), très grandes (>3000 m²) et enclavées ; `districtToSeeds` écarte les parcelles où rien
  n'est constructible ; `withBasePrices` mémorise les prix (calcul ~6 s). Quartier fourni : **Montreuil – Mairie**
  (rayon 300 m, 267 parcelles dont 246 jouables, marché « petite couronne », données au 2026-10-14).
  Équilibrage refait sur ce quartier : prix du terrain × 0,9 à 1,5 selon la parcelle (attentes du vendeur), demande
  +5 %/achat qui retombe de 10 %/tour ; patrimoine final / départ ≈ 1,1 à 4,8 (médiane ≈ 2) sur 4 graines, 40 tours.
  Limites : toutes les parcelles utilisent les mêmes critères par défaut (pas de PLU de jeu) ; le bâti existant n'a pas
  de valeur propre ; parcelles voisines pas fusionnables ; les bots ne regroupent pas de parcelles.
- Fait : **assemblage de parcelles** (`moteur/src/game/merge.ts`, action `merge`) : le joueur possède plusieurs
  parcelles mitoyennes (≥ 1,5 m de limite commune, jours de numérisation ≤ 20 cm tolérés), il les fusionne en un terrain
  unique ; contour fusionné, façades sur rue conservées, SDP existante / prix payé / prix de référence additionnés ;
  refus si elles ne se touchent pas ou enferment une cour. Les bots n'assemblent pas encore.
- Fait : **interface avec carte** (`jeu/`, Vite + TypeScript + Leaflet, fond OpenStreetMap). Lancer : `cd moteur &&
  npm install`, puis `cd jeu && npm install && npm run dev` (build : `npm run build`). Une partie solo contre 3 bots
  (prudent, équilibré, agressif) sur le quartier de Montreuil, sauvegardée dans le navigateur (localStorage).
  Carte : parcelles colorées par propriétaire, prix au m² des terrains libres en dégradé, opérations en pointillés,
  emprise du bâtiment projeté en orange. Panneaux : terrain (acheter, revendre, assembler via Maj+clic ou « sélection
  multiple »), projet (R+x, attique, stationnement, bilan en direct, lancement), opérations, journal, classement.
  Vérifié dans Chromium (parcours achat → assemblage → opération → 6 trimestres, sans erreur) ; pas de test
  automatisé de l'interface. `window.__urbasim` (serveur de développement seulement) sert aux essais automatisés.
- Fait : **coûts fixes d'opération** (`Market.fixedCostPerOperation`, ligne `costs.fixed` du bilan) : étude de sol,
  géomètre, diagnostics, dossier de permis, garantie d'achèvement, raccordements, installation de chantier, dus quelle
  que soit la taille (150 k€ Paris, 90 k€ petite couronne, 65 k€ grande ville, 45 k€ ville moyenne ; ordres de
  grandeur à valider). C'est la raison réelle qui décourage les micro-projets : un terrain de 100 m² ne peut plus
  payer son prix. Les terrains trop petits pour un projet rentable ont un prix plancher (0,6 × surface × charge
  foncière) : ils servent surtout à être assemblés. Sur le quartier réel, la plus petite opération des bots passe de
  30–60 m² à ~170 m² de SDP (médiane ~890 m²).
- Fait : **couche « hauteur du bâti existant »** sur la carte (BD TOPO, instantané du quartier : 666 bâtiments avec
  hauteur) : 5 classes de couleur (≤ 6 m, 6–10, 10–16, 16–25, > 25 m, avec équivalent R+x), légende, bascule avec la vue
  « prix des terrains » ; hauteur existante affichée dans la fiche du terrain. Limite : le bâti dessiné est celui de
  l'instantané (2025) ; les bâtiments construits ou démolis pendant la partie ne sont pas redessinés.
- Fait : **valeur selon le lieu** (`moteur/src/game/location.ts`). Équipements issus de la BD TOPO (transports :
  métro, gare, tramway ; mairie = centre-ville ; écoles ; espaces publics ; hôpitaux), stockés dans l'instantané du
  quartier (`pois`, récupérés par `fetchPois`). Chaque parcelle reçoit un coefficient `locationFactor` sur les prix de
  vente : somme, par type d'équipement le plus proche, de bonus × exp(−distance/échelle) (métro +14 % à 350 m d'échelle,
  gare +14 %, mairie +8 %, tram +5 %, école +2 %, parc +2 %, hôpital +2 %), normalisée sur la parcelle médiane du
  quartier et bornée à 0,85–1,30. Le coefficient s'applique aux prix de vente du bilan (pas aux coûts) : le prix du
  terrain en découle car il est calculé en résiduel (+8 % de prix de vente ≈ +15 à 30 % de foncier). L'assemblage moyenne
  les coefficients pondérés par la surface. Interface : vue « Valeur du lieu » (parcelles colorées, équipements,
  légende) et détail dans la fiche du terrain. Montreuil : coefficients de 0,95 à 1,09. Poids = ordres de grandeur,
  à calibrer sur des prix réels (DVF). Pas encore : nuisances (voie ferrée, bruit, trafic), commerces (absents de la
  BD TOPO — OSM/Overpass était injoignable depuis l'environnement de développement), emplacements en bord de rue.
- **Taxes de construction** : seul un forfait de 100 €/m² de SDP (`taxPerSdp`) approxime la taxe d'aménagement et les
  participations. À affiner : valeur forfaitaire au m² × (taux communal + départemental [+ régional en Île-de-France]),
  forfait par place de stationnement, redevance d'archéologie préventive, PUP, participation à l'assainissement ;
  à paramétrer par commune/quartier (dans `Market` ou le fichier du quartier). Taux exacts à vérifier.
- Fait : **marché de l'immobilier et cycle d'une opération** (`moteur/src/game/sales.ts`, `game.ts`). Les logements se
  vendent par lots, trimestre après trimestre : demande du quartier (3 % du nombre de parcelles par trimestre, au moins
  6 ; réduite par la hausse des taux et par les chocs de demande des retournements de marché), répartie entre toutes les
  opérations selon leurs lots restants, leur avancement (sur plan < chantier < livré) et leur prix (élasticité). Chaque
  opération a une **politique de prix** (−20 % à +15 % par rapport au marché, action `setPrice`). Phases : permis →
  (attente de préventes) → chantier → livraison et dernières ventes → clôture quand tout est vendu. **Seuil de préventes
  de 60 %** (`presaleThreshold`) : tant qu'il n'est pas atteint, la banque ne débloque pas le crédit (refinancement de
  80 % du terrain + financement des travaux) et le chantier ne démarre pas ; le terrain est payé comptant et les fonds
  propres du chantier (20 %) sont mis sous séquestre au lancement. Appels de fonds des acquéreurs pendant le chantier
  (95 % au prorata de l'avancement, solde à la livraison), qui remboursent d'abord la banque ; intérêts proportionnels à
  la durée réelle (donc les invendus et l'attente coûtent). Durées raccourcies : permis 6 mois, chantier 6 mois + 1 mois
  par niveau (+2 par sous-sol) ; une opération R+3 dure ~7 trimestres au lieu de 9. Les bots règlent leurs prix selon le
  rythme des ventes et évitent de saturer le marché.
- Fait : **terrains non constructibles seuls** (`Plot.issue` : trop petite, enclavée, inconstructible) : affichés (violet
  pointillé), achetables (prix plancher), mais le lancement d'une opération est refusé avec l'explication ; l'assemblage
  avec des voisines les rend constructibles (une enclavée gagne l'accès à la rue). Quartier : 345 parcelles dont 95 à
  assembler. L'interface grise les terrains hors de portée, indique « il vous manque X € » et propose un filtre.
- Interface : bouton « Avancer ▶▶ » (jusqu'à la prochaine étape d'une opération ou un aléa, 8 trimestres au plus), cartes
  d'opération avec barre de préventes et curseur de prix, indicateur de demande du quartier.
- Équilibrage actuel (4 parties de 40 trimestres sur Montreuil, 3 bots) : patrimoine final / départ ≈ 1,3–1,7 (prudent,
  équilibré) et 2,9–4,2 (agressif) : le profil agressif domine encore. Les bots n'attendent presque jamais les préventes
  (peu de concurrence) : la tension viendra surtout des humains, des retournements de marché et des hausses de taux.
- Fait (retours de test) : **stationnement** : nouveau mode « places achetées à proximité » (`hors-site`, concession ou
  copropriété voisine, coût `Market.offsiteParkingPlace`, ajouté aux travaux) ; le mode automatique y recourt pour ce que
  le terrain ne peut pas loger (avertissement + surcoût au lieu d'un blocage) ; en sous-sol imposé, le blocage reste mais le
  message propose des solutions. **Assemblage** : diagnostic en direct dans le panneau (pas seulement un message
  fugitif : « il faut posséder… », « ne se touchent pas (1,5 m) », « une parcelle au milieu »), deux parcelles enclavées
  peuvent s'assembler entre elles. **Constructibilité** : un terrain est aussi signalé « à assembler » si aucun projet
  n'est rentable même terrain offert (forme ou taille) ; l'analyse est mémorisée dans l'instantané du quartier
  (`npm run district` ~15 s) : 218 parcelles constructibles seules, 66 trop petites, 57 enclavées, 5 de forme inadaptée.
  Formulaire de projet : profondeur maximale du bâtiment (10 à 22 m, utile sur les parcelles profondes), bouton « Meilleur
  projet ». Curseur de prix de vente : pourcentage, prix du lot et rythme de vente suivent le curseur en temps réel.
- Fait : **PLU simplifié** (`moteur/src/game/plu.ts`). Le vrai règlement (dizaines de pages par zone, hauteurs sur un plan
  à part) est réduit à **7 familles de zones** (renouvellement urbain R+7, centralité R+6, zone mixte R+4, préservation R+2,
  activités économiques R+3 bureaux uniquement, équipement public et naturelle inconstructibles) et **5 règles lisibles** :
  hauteur maximale (R+x, l'attique compte comme un niveau), emprise au sol, pleine terre, retraits, destination. Les familles
  viennent du vrai zonage (API Carto GPU `zone-urba` : `typezone` + `libelong`, stockées dans l'instantané : 36 zones,
  parcelle rattachée par son centre) ; les valeurs sont des ordres de grandeur inspirés du type de zone. Le PLU s'impose à
  tout : lancement d'opération (le joueur ne peut pas contourner les limites), bots, prix du terrain (une zone de préservation
  vaut bien moins qu'une centralité), terrains de zone inconstructible (`issue: 'zone'`). Un terrain à cheval sur plusieurs
  zones (assemblage) suit la règle la plus restrictive. Interface : carte de la zone dans la fiche (5 pastilles + phrase),
  niveaux du formulaire plafonnés, vue « Règles d'urbanisme (PLU) » avec légende. Montreuil : 176 parcelles en centralité,
  110 en zone mixte, 47 en préservation, 8 en renouvellement, 4 en activités. Équilibrage après PLU (4 parties) :
  patrimoine final / départ ≈ 1,1–2,2, l'agressif ne domine plus aussi nettement.
  Pistes : bonus de constructibilité (logement social, performance énergétique), révision du PLU en cours de partie
  (événement), recours des riverains selon la zone, vraies hauteurs du plan des hauteurs (prescriptions GPU).
- Fait : **affichage simplifié** (`jeu/src/main.ts`, `jeu/src/style.css`). Barre du haut sur une ligne (trimestre, trésorerie,
  patrimoine, un seul bloc « Marché » : indice des prix · taux · demande), boutons « Fin du trimestre », « ▶▶ » et menu « ⋯ »
  (nouvelle partie). Réglages de la carte (vue, filtre des terrains libres, sélection multiple) dans une petite barre sur
  la carte ; légende de carte repliable (fermée par défaut sur téléphone) avec les propriétaires et les symboles. Fiche d'un
  terrain : titre + pastille d'état, 4 faits (surface, prix, zone, bâti), action d'achat/vente, puis le projet (niveaux, attique,
  « Meilleur projet »), trois indicateurs (marge, fonds propres, durée) ; tout le reste est replié (Options, Détail du bilan,
  Règles d'urbanisme, Situation). Cartes d'opération plus courtes ; badge du nombre d'opérations sur l'onglet.
- Fait : **identité du promoteur, mode d'emploi, fin de partie**. `moteur/src/game/identity.ts` : palette de 8 couleurs, 24
  noms parodiques manifestement fictifs avec slogan (testés : aucun ne reprend un nom réel), monogramme, nettoyage du nom
  saisi, tirage au hasard reproductible, identités des trois concurrents toutes distinctes. Interface : fenêtre de création
  de société à la première visite et à « Nouvelle partie » (nom, slogan, couleur, « au hasard », aperçu) ; « Ma société »
  dans le menu pour la modifier en cours de partie ; mode d'emploi en 8 étapes (but, achat, PLU, assemblage, projet, ventes et
  financement, temps, lexique) proposé après la création puis relançable depuis le menu ; liste « premiers pas » qui se
  coche seule ; couleurs et noms de chaque société partout (carte, classement, barre du haut). Écran de **fin de partie** :
  verdict selon le multiple du patrimoine, classement, bilan des opérations soldées (`Player.stats`), rejouer ou changer de
  société ; bouton « Résultats » pour le rouvrir.
- Fait : **enjeux** (réponse au retour « il n'y a aucun enjeu »). Mode campagne (`moteur/src/game/rules.ts`,
  `campaignConfig(difficulté)`) ; le moteur seul garde ses règles simples par défaut (achat immédiat, pas de frais de
  structure) pour rester testable.
  - **Marché foncier à enchères** (`moteur/src/game/market.ts`, action `offer` / `withdraw`) : plus d'achat immédiat. Chaque
    trimestre ~3 % des terrains libres sont **mis en vente** : offres ouvertes 2 trimestres, **sous pli fermé** (on voit le
    nombre d'offres, pas les prix), **le plus offrant l'emporte** (à égalité le premier arrivé), prix de départ minimal,
    perdants remboursés. Les autres terrains se **prospectent** : offre spontanée au propriétaire, résolue à la fin du
    trimestre, acceptée seulement si le prix atteint son seuil caché (1 à 1,2–1,3 × le prix affiché selon le terrain),
    frais de prospection non remboursés ; si deux promoteurs prospectent, le plus offrant gagne. L'offre bloque la
    trésorerie (prix + notaire), comptée dans le patrimoine. Les bots enchérissent (entre le prix de départ et leur prix
    maximal selon leur tempérament) et prospectent.
  - **Dette et faillite** : frais de structure chaque trimestre (0,2 / 0,4 / 0,6 % de la mise selon la difficulté : ne rien
    faire coûte), charges impayées = **découvert** qui porte intérêt (taux du crédit + 3 pts) et se rembourse sur les premiers
    encaissements, aucune offre ni opération tant qu'il y a un découvert, **patrimoine négatif = faillite** (terrains saisis,
    chantiers arrêtés, offres rendues, le joueur ne joue plus ; partie finie si plus aucun humain en lice).
  - **Objectif et difficulté** : facile / normal / difficile (trésorerie ×1,25 / ×1 / ×0,85, volatilité, aléas,
    propriétaires plus ou moins exigeants) ; objectif de patrimoine final ×1,4 / ×1,7 / ×2,2 la mise, suivi dans la barre du haut
    et jugé à l'écran de fin.
  - Simulations (5 parties par niveau, 3 bots + 1 humain passif, Montreuil) : le joueur passif finit à ×0,76–0,91 ; les bots
    de ×0,5 à ×1,9 (certains perdent : malédiction du vainqueur) ; ~22 % des enchères sont disputées ; aucun bot en faillite.
  Interface : onglet « Marché » (mes offres, terrains en vente), contour doré des terrains en vente, filtre « en vente »,
  panneau d'offre dans la fiche d'un terrain (prix libre, somme bloquée, frais), choix de la difficulté à la création,
  objectif et découvert en haut, écran de fin avec faillite et objectif. Pistes : surenchère en direct, négociation avec le propriétaire, réputation, scénarios (crise, remontée des taux).
- Fait : **appels d'offres de la commune** (`moteur/src/game/tender.ts`, actions `tenderBid` / `tenderWithdraw`), dans l'esprit
  des opérations d'aménagement (ZAC, PUP…) : la commune garde quelques terrains (`municipal`, 6 en campagne, jamais en vente
  ni prospectables, ni assemblables) et les cède au **meilleur projet**, pas au plus offrant.
  - **Cahier des charges** tiré au hasard (état rejouable) : part minimale de logements sociaux (20–35 %), hauteur max,
    commerces en rez-de-chaussée, qualité minimale, délai de livraison (5 à 7–9 trimestres), **prix de cession minimal**
    (décote sur ce que le meilleur projet imposé peut payer, `tenderWorth`) et **pondération annoncée** des critères
    (4 profils : prix, mixité, qualité, rapidité). Un appel dure 3 trimestres, un nouveau tous les 3 trimestres, 2 ouverts au plus.
  - **Cadres d'opération** (avantages contre contraintes, `PROGRAMMES`) : **ZAC** (prix de cession ×0,6, pas de taxe
    d'aménagement, +1 niveau au-delà du PLU), **PUP** (prix ×0,9, taxe réduite à 60 €/m², permis en 3 mois au lieu de 6),
    **quartier prioritaire** (prix ×0,75, TVA à 5,5 % : prix de vente du libre +5 %). Appliqués par `programmeParams`
    (taxe, délai de permis), `criteriaFor(plot, base, bonusLevels)` et `BilanInput.salesPremium`.
  - **Proposition** = prix, part de logements sociaux, qualité (0/1/2 : travaux +0/3/7 %, prix +0/2/4 %), délai promis. Chaque
    critère est noté de 0 à 1 (`scoreBid`), pondéré : le joueur voit sa note en direct, pas celles des autres (sous pli
    fermé). La somme (prix + notaire) est bloquée, remplaçable ou retirable. Meilleure note l'emporte (égalité : prix, puis
    premier arrivé) ; perdants remboursés ; sans proposition : infructueux.
  - **Engagements du lauréat** (`Plot.obligation`) : lancer avant `launchBy` (3 trimestres) sinon la commune reprend le
    terrain et garde 10 % ; hauteur et commerces imposés au lancement ; logements sociaux cédés en bloc à 55 % du prix dès le
    lancement (comptent dans les préventes) ; livraison en retard = pénalités ; terrain ni revendable ni assemblable avant le
    lancement ; saisi en cas de faillite (retourne à la commune). Patrimoine : un terrain obtenu est valorisé au plus à son
    prix de cession (pas au prix affiché).
  - Bots (`tenderTurn`) : cherchent la proposition la mieux notée qui leur laisse leur marge, selon leur tempérament.
    Simulation (5 parties, Montreuil, normal) : 3 à 6 appels attribués sur 14, aucun bot en faillite, quelques terrains
    repris faute de lancement (~2 par partie).
  Interface : onglet « Commune » (cahier des charges, cadre, pondération, formulaire avec note et marge en direct, résultats,
  engagements), terrains communaux en turquoise sur la carte, fiche d'engagements sur le terrain gagné (hauteur et bonus de
  la ZAC pris en compte dans le projet), arrêt du ▶▶ à l'ouverture d'un appel et au dernier trimestre pour répondre, étape du
  mode d'emploi. Pistes : programmes à TVA 5,5 % en accession sur toute la ville, PUP négocié, surenchère, réputation (elle
  pourrait peser dans la note), bots qui assemblent des parcelles.
- Fait : **clarté** (retour « plus clair »). Journal d'événements enrichi (`GameEvent.kind/tone/code/ref/popup`) ;
  `moteur/src/game/alerts.ts` : `watchList` (échéances et points de vigilance : délai pour lancer accordé par la commune,
  délai de livraison promis avec projection du retard, préventes à atteindre, appels d'offres ouverts, offres en cours,
  découvert) et `isRelevant`/`relevantEvents` (événements du joueur et annonces publiques). Interface : cloche de
  notifications (panneau latéral : « À surveiller » avec barres de progression, historique filtrable, nouveautés, lien « Voir »),
  **fenêtres d'alerte** pour les aléas et verdicts (explication pédagogique et conseil), frise des étapes d'une opération
  (permis, préventes, chantier, ventes), barres de délai (lancer, livrer, répondre à un appel d'offres), avancement de la
  partie en haut. Le ▶▶ s'arrête aussi sur les événements publics importants.
- À faire ensuite : valeur selon le lieu (gares, centre), PLU de jeu par zone, programmes plus variés (TVA 5,5 %,
  ZAC propres à un territoire), multijoueur pair-à-pair ; côté interface : critères avancés (retraits, mix de typologies), vue 3D, mobile.

- Fait : **publication automatique** (`.github/workflows/pages.yml`) : à chaque push sur la branche de développement ou sur
  `main`, GitHub Actions reconstruit le jeu (`jeu/`, avec les vraies tuiles de carte) et le publie sur la branche `gh-pages`,
  servie par GitHub Pages à https://maxpyroli.github.io/UrbasimGame/. Réglage unique à faire dans le dépôt :
  Settings → Pages → Source « Deploy from a branch » → branche `gh-pages`, dossier `/ (root)`.

- Fait : **écran d'accueil** (`showHome` dans `jeu/src/main.ts`) : logo, badge « bêta », reprise de la partie (société, trimestre,
  patrimoine, objectif, barre d'avancement), nouvelle partie, mode d'emploi, lieu de la partie (Montreuil – Mairie, « autres
  lieux bientôt »), encart bêta et « à venir » (choix du lieu, multijoueur sans serveur, programmes, carte plus belle puis 3D),
  crédits des données. Accessible aussi par le menu « ⋯ ». Annuler la création de société ramène à l'accueil.

- Hébergement de secours : `netlify.toml` (dossier `jeu`, commande `npm ci --prefix ../moteur && npm ci && npm run build`,
  sortie `dist`). Pour Cloudflare Pages ou Vercel : mêmes réglages à saisir à la main (racine `jeu`, sortie `dist`, `npm ci` dans
  `moteur` avant le build). Le premier déploiement GitHub Pages d'un dépôt neuf peut rester bloqué à `updating_pages` (observé
  le jour de la création du dépôt) : relancer le workflow « Publier le jeu » ou attendre.
- Bots : à l'approche de l'échéance de lancement d'un terrain de la commune (dernier trimestre), ils acceptent une marge nulle
  et ignorent la saturation du marché, pour ne pas perdre 10 % du prix.

## 5 ter. Idées notées pour plus tard
- **Valeur selon le lieu** : un terrain vaut plus près d'une gare, du centre-ville, de commerces, etc. Pistes : bonus
  de prix de vente et de terrain selon la distance à des points d'intérêt (OSM/Overpass ou BPE de l'INSEE pour gares,
  métro, écoles, commerces) ; multiplicateur par parcelle dans le prix de référence (`basePrice`) et dans les prix de
  vente du bilan. À brancher sur `Plot` (champ `locationFactor`) sans toucher au moteur de calcul.
- **Programmes et dispositifs** : TVA à 5,5 % (zones ANRU/QPV, accession sociale), logement social / PLS / PLUS,
  bail réel solidaire, dispositifs propres à un territoire (zonage A/B/C, taxe d'aménagement locale, aides
  communales), **ZAC** (charges foncières imposées, cahier des charges, aménageur). À modéliser comme des « règles
  de programme » attachées à une parcelle ou une zone, qui modifient le bilan (TVA/prix de vente plafonné, aides,
  contraintes de programme) et se combinent avec les appels d'offres.

### Notes de la partie « clarté » (à traiter plus tard)
- **Voir les bâtiments construits par les autres sur la carte** : les opérations (en cours et livrées) doivent remplacer le
  bâti existant sur la carte, avec leur hauteur réelle, au lieu de seulement colorer la parcelle.
- **Choix de l'implantation du bâtiment** : le joueur choisit de construire **le long de la route** (à l'alignement, en front
  de rue) **ou en retrait, à l'arrière / au cœur du terrain** (cour ou jardin côté rue). Aujourd'hui le bâtiment est
  placé automatiquement avec les retraits de la zone. À ajouter : option d'implantation dans le formulaire de projet, règles de
  PLU associées (alignement ou retrait obligatoire sur rue, retrait de fond, limites séparatives, prospects, mitoyenneté,
  distance entre bâtiments) et effets sur le bilan (stationnement, vue, éclairement, valeur des logements).
- **Vue 3D des bâtiments** (pour bien plus tard) : visualiser les immeubles en volume, existants et construits par les
  joueurs (les hauteurs sont déjà dans les données et dans les projets).
- **Un affichage plus joli et plus lisible** : routes, parcelles, bâtiments, parcs, équipements avec des icônes (gare,
  école, mairie, commerces…), hiérarchie visuelle claire, thèmes.

## 5 quater. Multijoueur pair-à-pair (souhait, sans serveur à gérer)
Le moteur est déjà adapté : état pur, sérialisable, déterministe, aléa dans l'état (graine). Pistes :
- **Hôte faisant foi** (le plus simple) : un joueur héberge la partie, les autres lui envoient leurs actions via WebRTC
  (PeerJS ou WebRTC direct) et reçoivent l'état ; `applyAction` valide tout. Il faut un service de signalisation
  (gratuit : PeerJS cloud, ou échange manuel d'un code/QR). L'hôte peut tricher et sa déconnexion arrête la partie :
  prévoir « sauvegarde de l'état » (JSON) pour reprendre avec un autre hôte.
- **Lockstep** : chacun rejoue le même journal d'actions avec la même graine et vérifie que l'empreinte de l'état
  est identique (détecte la triche d'un pair). Plus robuste, plus complexe (ordre des actions, reconnexion).
- **Asynchrone** (un trimestre par jour) : état échangé par fichier/lien ou stockage partagé ; pas de temps réel.
Limite : le P2P pur n'empêche pas un hôte malhonnête ; acceptable entre amis, à reconsidérer pour un jeu public.

- **Identité du promoteur** (idée notée) : au début de la partie, on choisit le nom de sa société de promotion et son
  identité visuelle (couleur, logo/monogramme, slogan). À défaut, noms tirés au hasard parmi des parodies légèrement
  modifiées de promoteurs réels, y compris pour les concurrents ordinateur (aujourd'hui « Prudent », « Équilibré »,
  « Agressif »). Les parodies doivent rester manifestement fictives (jeux de mots, pas de nom réel reconnaissable
  ni de logo copié) ; la couleur choisie remplace `COLORS` dans `jeu/src/main.ts`.

## 6. Pour démarrer la nouvelle session
Donnez-lui ce fichier et dites par exemple : « Reprends le moteur de `./moteur`, crée la structure du jeu, et
commence par le bilan du promoteur (module pur, testé), à brancher sur `computeProject`. » Vérifiez que la session a
bien accès au nouveau dépôt.
