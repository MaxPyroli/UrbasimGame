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

- Fait : **bâtiments des promoteurs sur la carte** (`drawBuildings` dans `jeu/src/main.ts`, `Plot.built` côté moteur). Une opération
  lancée remplace le bâti d'origine du terrain (les bâtiments dont le centre tombe dans le terrain disparaissent) par son
  emprise réelle (`computeProject`), colorée par hauteur (vue « Hauteur ») ou par promoteur (autres vues), avec le contour de la
  couleur du promoteur. Opacité selon l'étape (permis, préventes : pointillé et léger ; chantier : hachuré, motif SVG de la couleur du promoteur ; livré : plein).
  À la livraison, le bâtiment reste sur la carte (`Plot.built`, conservé par l'assemblage) jusqu'à la prochaine démolition.
  Infobulle du terrain : opération, promoteur, étape, hauteur, surface. Limites : pas de volume 3D, bâti partiellement
  chevauchant un terrain non démoli, emprise recalculée à partir des critères du projet.

- Fait : **affichage de la carte** : fond de plan OpenStreetMap adouci par un filtre CSS (désaturé, inversé en thème
  sombre : classe `.basemap`) pour que parcelles et bâtiments ressortent (CARTO essayé puis abandonné : ses tuiles exigent une clé d'API) ; **pictogrammes d'équipements** (M métro, T tram, G gare, mairie,
  école/supérieur, parc, hôpital : pastilles SVG colorées, majeurs dès le zoom 14, tous dès le 16, case « équipements » dans la
  barre de la carte) ; contours de parcelles plus fins ; légende, barre d'outils, contrôles et infobulles aux couleurs du thème.
  Reste à faire : parcs et espaces verts dessinés, routes hiérarchisées dans la version sans fond de plan, libellés de rues, 3D.
- Fait : **installation (PWA)** : `jeu/public/manifest.webmanifest`, icônes (`jeu/public/icons`, générées par un script Playwright
  à partir du logo des quatre immeubles), `jeu/public/sw.js` (page : réseau d'abord ; fichiers du jeu : cache d'abord, mis en
  cache dès l'installation, même hors ligne dès la première visite ; fonds de carte : cache de secours, 400 tuiles). Bouton
  « Installer l'application » sur l'écran d'accueil et dans le menu (Chrome, Edge, Android : invite native ; iPhone et iPad :
  explication du menu Partager). Pas de service worker dans la version « page unique » (artefact Claude).

- Fait : **version mobile allégée** : pied de page des crédits supprimé (menu ⋯ → « Crédits et données », lien sur l'accueil,
  attribution OpenStreetMap discrète sur la carte), barre du haut compacte sur téléphone (société et boutons sur une ligne,
  indicateurs en bandeau défilant), outils de carte repliables (« Carte et filtres »), correction d'un débordement horizontal
  de la page sur petit écran (fenêtres de création de société décalées).

- Fait (notes « finitions ») : **règles d'urbanisme selon la densité** (`Density`, `adaptToDensity` dans `moteur/src/game/plu.ts`,
  `withDensity` dans `district.ts`) : la densité du bâti dans les 70 m autour de chaque parcelle (≥ 35 % de surface bâtie = dense,
  < 26 % = diffus) adapte la règle de la zone : en tissu dense, pas de retrait latéral, retrait de fond ≤ 2 m, plus d'emprise
  (+15 pts, 85 % max), moins de pleine terre. Les retraits de la zone font désormais foi (ils remplaçaient seulement le maximum avec
  les 4 m de fond par défaut du moteur). À Montreuil : 129 parcelles denses, 147 moyennes, 70 diffuses ; 213 parcelles
  constructibles seules au lieu de 198.
  **Emprises plus réalistes** (`regularize` dans `moteur/src/engine/footprint.ts`) : une emprise de plus de 8 côtés ou en lanière
  est simplifiée (décrochements de moins d'1 m effacés, recoupée dans l'enveloppe), sinon remplacée par le plus grand rectangle
  si elle garde 70 % de la surface ; les L des terrains d'angle sont conservés. Emprises « bizarres » : 53/212 → 16/212.
  **Délaissés** (`withWasteland`, `PlotIssue 'delaisse'`) : 27 parcelles non constructibles dont l'assemblage n'apporte presque
  rien (aucun voisin, ou gain de valeur inférieur à leur prix plancher) sont marquées « délaissé » : grisées, achetables pour
  presque rien, ni mises en vente ni convoitées par les bots. Les 96 autres parcelles « à assembler » restent utiles.
  L'instantané se recalcule sans réseau par `npm run reprice -- montreuil-mairie` (environ 6 minutes) ; à relancer quand les
  règles ou la géométrie changent.

- Fait (notes « finitions », suite) :
  - **Implantation au choix** : formulaire de projet avec « Implantation » (automatique, le long de la rue, en retrait au fond du
    terrain) et « Forme » (adaptée ou rectangle) ; le moteur savait déjà les calculer. Règle de PLU associée : `ZoneRule.alignment`
    (`'rue'` = alignement obligatoire sur la rue, pour la centralité et tout tissu dense ; `'libre'` ailleurs) ; `applyRule` impose
    alors `placement: 'rue'`.
  - **Carte agrandie** (bouton ⤢ sous le zoom) : le panneau latéral se masque, une fiche flottante résume le terrain choisi.
  - **Animations** : entrée des panneaux et fenêtres, barres qui se remplissent, montants de la barre du haut qui défilent avec
    un éclair vert/rouge, pulsation du trimestre, hachures des chantiers qui respirent ; tout est désactivé si le système demande
    moins de mouvement.
  - **Simuler un projet sur plusieurs parcelles** : en sélectionnant plusieurs parcelles (même non achetées), la fiche affiche le
    bilan du terrain assemblé (`virtualPlot`) avec « Meilleur projet » et l'emprise sur la carte, sans rien acheter.
  - **Prospection groupée** : bouton « Déposer N offres » sur une sélection de terrains libres. **Spéculateurs**
    (`Plot.speculator`, `speculatorShare` = 15 % en campagne) : prix affiché en hausse de 2,5 % par trimestre (jusqu'à +80 %), jamais
    mis en vente, seuil de réserve ×1,2 ; la hausse est visible (infobulle, fiche), les bots les ignorent.
  - **Résumé de lecture d'un terrain** (`plotBrief`) : règles applicables en puces, meilleur projet (niveaux, logements, marge, prix
    de terrain max) et position du prix par rapport à la médiane des terrains libres, sans rien déplier.
  - **ZAC développées** (`moteur/src/game/zac.ts`, `Zac`, `GameState.zacs`, `config.zacs` = 1 en campagne) : un quartier de 4 lots
    voisins attribués l'un après l'autre (phasage, un appel d'offres de ZAC à la fois) et d'équipements publics (groupe scolaire,
    square, crèche) sur des terrains voisins, de préférence les petits bouts inutilisables. Chaque lot lancé verse une participation
    de 60 €/m² de plancher (au lieu de la taxe d'aménagement) ; les équipements démarrent quand assez de lots sont lancés, se livrent
    4 trimestres plus tard, et chaque équipement livré augmente de 2 à 4 % le prix de vente des logements de la ZAC (`zacPremium`
    dans `lotPrice`). Interface : périmètre en pointillés et pastilles d'équipements sur la carte (prévu / en travaux / livré), fiche
    de ZAC dans l'onglet Commune (lots, équipements, avancement), fiche d'équipement, suivi dans les notifications, fenêtres d'alerte.
    Les sauvegardes d'avant les ZAC ne se rechargent pas.
  - Simulation d'équilibrage après ces changements (4 parties, Montreuil, normal, un humain inactif et 3 bots) : le joueur inactif finit
    vers ×0,8 de sa mise, les bots de ×0,6 à ×1,6 (un cas à ×3,3), aucune faillite ; la ZAC voit 3 à 4 lots lancés sur 4 et tous ses
    équipements livrés ; 7 à 10 appels d'offres attribués sur ~27, 1 à 3 terrains repris par la commune. À surveiller : les règles plus
    permissives en tissu dense et la hausse de prix des ZAC rendent les bons parcours plus rentables (cas à ×3,3), le niveau
    « difficile » n'a pas été resimulé.
  - Performance : les concurrents calculent plus qu'avant (appels d'offres, projets de ZAC) ; leurs projets sont mémorisés par terrain
    et critères (`projectOf`), la prospection n'étudie qu'environ 15 % des terrains par trimestre ; première fin de trimestre de
    l'ordre de 3 à 5 s, indiquée par « Les concurrents jouent… ».

- Fait : **numéro de version et de build** pour suivre les mises à jour. Version bêta `0.x` dans `jeu/package.json` (`version`, actuellement
  0.9.0) ; **build = nombre de commits** de la branche (`git rev-list --count HEAD`, injecté par `jeu/vite.config.ts` en `__APP_BUILD__`,
  avec `__APP_VERSION__`, `__APP_COMMIT__`, `__APP_DATE__` ; le workflow GitHub clone l'historique complet pour le calculer). Affichés dans
  la barre du haut (« bêta 0.9 · #37 »), sur l'écran d'accueil, dans le menu ⋯ et dans la fenêtre « Version et nouveautés »
  (`jeu/src/changelog.ts`). À chaque ouverture après une mise à jour : un message indique la nouvelle build, et la fenêtre des nouveautés
  s'ouvre seule quand la version bêta change. **Pour publier une nouvelle bêta** : monter `version` dans `jeu/package.json` et ajouter une
  entrée en tête de `CHANGELOG`.

- Fait : **projets sur plusieurs terrains plus simples** (retour « l'achat est compliqué et on manque d'informations »).
  - **Offre groupée « tout ou rien »** (`bundleOffer`, `placeBundle` et `resolveMarket` dans `moteur/src/game/market.ts`) : une offre par
    terrain, tranchées ensemble (même échéance exigée) ; si une seule n'est pas remportée (propriétaire qui refuse, concurrent qui
    devance), aucune ne l'est, les sommes sont rendues (les frais de prospection restent perdus) et chaque parcelle abandonnée revient
    à l'autre meilleur offrant. Si tout est remporté, les parcelles (et celles déjà possédées, `extra`) sont **assemblées d'office**
    (`pendingMerges`, `mergePlots` factorisé). Retirer une offre du groupe retire tout le groupe.
  - **Plan d'acquisition** dans la fiche multi-parcelles (`renderMulti`) : une ligne par parcelle (à vous / en vente jusqu'à / prospection
    avec **chance d'acceptation** `acceptChance` / ↑ spéculateur / concurrents sur le terrain / ⚠ bloquée : appartient à un concurrent,
    communale, opération en cours), prix prévu, ✕ pour retirer, total à bloquer (frais de prospection compris), prix de terrain
    maximal de l'ensemble pour la marge visée, **niveau d'offre** standard (+8 %) ou sûr (au-dessus de tout seuil possible), chance
    de remporter l'ensemble, simulation du projet avec « Meilleur projet », et **voisines à ajouter** en un clic (`neighboursOf`).
  - Sur la fiche d'un terrain seul : encart « Projet sur plusieurs terrains » avec ses voisines et un bouton « + Ajouter » (active la
    sélection multiple).
  - Messages : fenêtres d'alerte « offre groupée remportée / annulée » ; onglet Marché : « offre groupée » et « Retirer le groupe ».

- Fait : **deux bâtiments sur un même terrain** (version 0.9.2), si le PLU l'autorise.
  - Moteur : `moteur/src/engine/rear.ts` (`buildRear`). Critères `secondBuilding` (faux par défaut), `secondLevels` (2), `buildingGap` (6 m).
    Le bâtiment arrière occupe la zone constructible située derrière le bâtiment sur rue, après un recul `max(buildingGap, hauteur avant / 2)`,
    avec une emprise placée « au fond » et moins de niveaux que l'avant (jamais plus). Accès : **allée** de 3,5 m si la parcelle laisse une bande
    libre à côté du bâtiment avant, sinon **porche** (surface retranchée du RDC avant). Le CES et la densité (COS) sont partagés ; si le total
    dépasse, le second bâtiment est abandonné avec la raison dans les contrôles (`rear`). Stationnement, logements, surfaces et durée de chantier
    (calculée sur le bâtiment avant) intègrent les deux bâtiments ; `Indicators.buildings`, `Project.rearFootprint/rearAccess`, `LevelPlan.building`.
  - PLU (`game/plu.ts`) : `ZoneRule.maxBuildings` et `buildingGap` (1 bâtiment en préservation, équipement, nature ; 2 ailleurs ; recul 6 à 8 m).
  - Interface : case « deuxième bâtiment au fond » + niveaux R+ de l'arrière dans le projet (grisée avec explication si le PLU l'interdit),
    « Meilleur projet » essaie aussi un bâtiment arrière, les deux emprises sont dessinées (aperçu et bâtiments construits, `footprintOf` renvoie
    une liste d'anneaux). Les bots ne l'utilisent pas encore (piste). Tests : `moteur/tests/rear.test.ts`.
  - Pas de nouveau `reprice` nécessaire : l'option est désactivée par défaut, les prix et délaissés ne changent pas.

- Fait : **bâtiments multiples automatiques, carte de Sucy-en-Brie, correction des voies** (version 0.10.0).
  - **Plusieurs bâtiments, automatique** : `PROMOTER_CRITERIA` (`moteur/src/engine/defaults.ts`) = `DEFAULT_CRITERIA` + `secondBuilding: true` ; utilisé par le
    jeu (interface, concurrents, appels d'offres, estimation des terrains). `DEFAULT_CRITERIA` garde un seul bâtiment (tests du moteur). `buildSecondary`
    (`engine/rear.ts`) pose d'abord le bâtiment arrière (allée ou porche), puis, dans l'espace libre (enveloppe moins les emprises déjà posées agrandies
    de la distance entre bâtiments), jusqu'à `maxBuildings` bâtiments (critère, plafonné par le PLU : 4 renouvellement, 3 mixte/activités, 2 centre,
    1 préservation). Niveaux des bâtiments de fond : `secondLevels` (null = autant que celui sur rue). La densité (COS) fait renoncer aux derniers bâtiments.
    `Project.extraFootprints` = troisième bâtiment et suivants. Interface : case « plusieurs bâtiments si possible » (cochée) + « fond R+ auto » ;
    « Meilleur projet » compare avec un seul bâtiment (`BestPlan.buildings/single`).
  - **Robustesse** : `computeProject` ne lève plus d'exception (la bibliothèque de découpage échoue sur certains contours) : nouvel essai sans bâtiments
    supplémentaires, puis projet infaisable expliqué.
  - **Voies** : `withRoadClip` (`game/district.ts`) retire des parcelles ce qui est sous la chaussée (couloir de demi-largeur 5/3,5/2,5 m selon l'importance
    BD TOPO), recalcule le côté sur rue, écarte les « parcelles » dont plus de 60 % est sous une voie (voirie). Appelé par `npm run reprice`. Montreuil :
    13 rognées, 11 écartées ; Sucy : 646 rognées, 110 écartées.
  - **Carte de Sucy-en-Brie, commune entière** (`moteur/data/districts/sucy-en-brie.json`, ~7 100 parcelles, 21 600 bâtiments) : `npm run commune --
    sucy-en-brie "Sucy-en-Brie" 94071 grande-couronne` (`fetchCommune` : parcelles par code INSEE, bâti/voies/zonage/équipements par carreaux de 1 km,
    dédoublonnés). Nouveau marché `grande-couronne` (`MARKETS`, banlieue éloignée : logement 4 800 €/m² habitable, terrain 520 €/m² de SDP). Limite de
    taille de parcelle montée à 8 000 m² (`MAX_PARCEL_AREA`). Parcelles en bord de commune : les voisines d'autres communes manquent, donc leur côté sur rue
    peut être surestimé.
  - **Recalcul des prix en parallèle** : `npm run reprice -- <id>` répartit l'analyse (0,2 s/parcelle) et la recherche des délaissés sur tous les cœurs
    (`analyseParcel`, `priceParcels`, `wastelandIds`). À relancer pour chaque carte quand les règles changent. `npm run simulate -- <id> [difficulté] [graines]`
    joue des parties complètes (humain inactif + 3 ordinateurs) et mesure temps et équilibre.
  - **Jeu multi-cartes** : `jeu/src/districts.ts` (registre, choix mémorisé, chargement) ; les cartes sont servies/copiées par un plugin Vite
    (`/data/districts/<id>.json?v=<build>`), intégrées compressées (gzip + base64) dans la version autonome ; changer de carte recharge la page ; une sauvegarde
    par carte (`urbasim-save-v5` pour Montreuil, `-<id>` pour les autres) ; les parcelles inchangées ne sont pas enregistrées (rechargées depuis la carte).
    Police du jeu : Alte Haas Grotesk Regular/Bold (`jeu/src/assets/fonts`, `@font-face` dans `style.css`, intégrée en base64 dans la version autonome).
  - **Performance sur une commune entière** (Sucy, 7 154 parcelles) : tour des concurrents de 22–54 s à 3–5 s (première fois), fin de trimestre dans le jeu de 80 s à ~5 s.
    Trois causes traitées : `largestRectangle` (`engine/footprint.ts`) rasterise par balayage de lignes au lieu de 4 tests point-dans-polygone par cellule
    (×20 à ×40 sur les grands terrains, résultats identiques) ; les ordinateurs étudient au plus 30 ventes + ~30 terrains non vendeurs par trimestre
    (`MAX_LISTED_STUDIED`, `MAX_PROSPECTS_STUDIED` dans `game/bot.ts` ; sans effet sur Montreuil) et ignorent les terrains hors de leur portée ;
    ils ne calculent plus les niveaux au-delà de la hauteur du PLU. Simulations (humain inactif + 3 ordinateurs, difficulté normale) : Sucy ×0,8 pour
    l'humain, ordinateurs ×0,4 à ×2,3, aucune faillite, 20–24 terrains livrés ; Montreuil inchangé (×0,8 ; ×0,5 à ×2,0).
  - Pistes : le recalcul des prix de Sucy prend ~30 min sur 4 cœurs (dont ~20 min pour les délaissés) ; fiche d'un très grand terrain : 1 à 2 s ;
    densité : 95 % des parcelles de Sucy sont « diffuses » (seuils calés sur Montreuil) ; règle PLU propre aux pavillons à affiner ; difficulté « difficile » non resimulée.
    Affichage allégé pour les grandes cartes : rendu canvas, bâti d'origine créé à la demande (vue « hauteur »), infobulles à la demande, styles mis en cache.

- Fait : **statistiques de marché (ventes réelles) et répartition des logements** (version 0.11.0).
  - **Rangement des logements simplifié** (`engine/program.ts`, `allocateLevel`) : le nombre de logements d'un étage = surface habitable / surface moyenne du mix
    (× `AVERAGE_AREA_FACTOR` 0,88, calé pour retrouver le nombre de l'ancienne recherche de combinaisons : -0,8 % au total, 10 % d'écart médian par projet), répartition
    par typologie au plus près du mix (`proportionalCounts`), surfaces ajustées pour remplir l'étage. Le bilan ne dépend que de la surface habitable, pas de la répartition.
  - **Statistiques de marché** : `app/dvf.ts` (`parseDvf`, `marketStats`, `marketMix`, `fetchMarketStats`) lit les ventes réelles DVF géolocalisées Etalab par commune et
    année (`files.data.gouv.fr/geo-dvf/latest/csv/<année>/communes/<dép>/<insee>.csv`), ne garde que les ventes simples d'un appartement, et en tire par typologie la part,
    la surface et le prix médians (mélangés à un a priori `PRIOR_*` quand les ventes sont rares). `District.marketStats/demandMix/typologyRatio` ; `marketOf(district)` =
    marché de référence + mix + prix relatifs. `npm run market -- <id> <insee>` les ajoute à un instantané existant (`fetchCommune` le fait aussi) ; relancer ensuite `npm run reprice`.
    Données : Montreuil 3 595 ventes à 6 328 €/m² (T1 16 %, T2 34 %, T3 31 %, T4 16 %, T5 4 %), Sucy 493 ventes à 3 626 €/m² (8/24/41/22/5 %).
  - **Effets en jeu** : `Market.typologyRatio` (prix relatif par typologie, moyenne pondérée par la surface = 1) joue dans le chiffre d'affaires (`typologyPriceFactor`) ;
    `Market.demandMix` est le mix par défaut des promoteurs (`promoterCriteria(market)` : interface, concurrents, estimation, appels d'offres) ; `mixFit` (0,6 à 1) mesure
    l'écart du programme à la demande, stocké à la vente dans `ProjectRun.mixFit` et appliqué au poids de l'opération dans `expectedSales` (ventes plus lentes).
    Interface : panneau « Répartition des logements » (marché, votre mix, logements obtenus, adéquation, effet sur le prix moyen ; boutons « Caler sur le marché » et « Standard »).
  - **Performance** : recalcul de Montreuil 17 s, de Sucy 4 min 23 s (30 min avant). Simulations (humain inactif + 3 ordinateurs, normal) : Sucy ×0,8 / ordinateurs ×1,0 à ×2,3 ;
    Montreuil ×0,8 / ×0,8 à ×3,3 ; aucune faillite.
  - **Communes à ajouter pour les tests** (prix d'appartements 2024 en €/m²) : Paris 11e 9 808 (hyper-dense), Villeurbanne 3 506 (10 769 parcelles), Noisy-le-Grand 4 233 (ville
    nouvelle), Brie-Comte-Robert 3 520 (6 422 parcelles, banlieue lointaine), Biarritz 7 267 (9 982, littoral), Chamonix 9 161 (montagne), Bourges 1 500 (marché bas), Murat (rural,
    pas de ventes d'appartements : teste l'a priori). Rezé, Albi, Saint-Nazaire et Saint-Denis (Réunion) sont trop grosses en commune entière. Le cadastre n'a pas répondu pour Paris 11e,
    Lyon 7e, Noisy, Cergy, Bourges (à vérifier : code ou arrondissements).
  - **Idée de fond (carte ouverte)** : l'utilisateur choisit une commune, elle est téléchargée et préparée dans le navigateur (barre de progression, mise en cache) avant de jouer. Pistes
    d'allègement chiffrées : placement du bâtiment 35 % du coût d'un plan, bâtiments supplémentaires 14 %, recherche des délaissés ~620 ms par candidate.

- Fait : **mémoire du placement** (version 0.11.1). `generateFootprint` (`engine/footprint.ts`) mémorise son résultat, clé = contenu exact des entrées (zone constructible, repère, options) :
  estimer un terrain à plusieurs hauteurs redemande le même placement (la zone et le plafond d'emprise ne dépendent pas des niveaux ; le bâtiment arrière non plus tant que la hauteur reste sous 12 m).
  Mémoire courte (128 entrées, `footprintCache`, désactivable pour comparer), résultats copiés à la lecture. Mesuré : ×2,7 (Sucy, 2 000 projets) à ×3,9 (Montreuil) avec des résultats **identiques**
  (comparaison projet par projet, test dans `tests/rear.test.ts`). Recalcul des prix de Sucy : 4 min 23 s → 1 min 35 s (cartes inchangées) ; partie simulée sur Sucy 51 s → 25 s (même issue,
  tour max 3,2 → 2,1 s). Restent : placement lui-même (`adaptedFootprint`, découpes de polygones), bâtiments supplémentaires, recherche des délaissés (~60 % du recalcul de Sucy).

- Fait : **page des cartes (téléchargement) et villes de test** (version 0.12.0).
  - **Cartes** (`moteur/data/districts`, une par ville) : montreuil-mairie, sucy-en-brie, **paris-11e** (4 485 parcelles, arrondissement via `--arr=111`, DVF 75111, marché `paris` ajusté 11 800 €/m²), **villeurbanne**
    (10 006 ; 4 850), **brie-comte-robert** (5 559 ; 4 750), **biarritz** (9 200 ; 8 600), **bourges-centre** (secteur de 1 km autour de 2,3985 / 47,0825 : le service refuse la requête par commune ; 7 214 ; 2 550),
    **murat** (secteur de 1,2 km ; 1 908 parcelles ; une seule vente d'appartement : teste le cas sans données, le marché reste proche de la référence). Fabrication : `npm run commune -- <id> "<nom>" <insee> <marché>
    [--arr=] [--sector=lon,lat,rayon] [--tile=500] [--adjust]` puis `npm run reprice -- <id>` ; `npm run market -- <id> <insee> "<nom>" --adjust` recalcule statistiques et prix locaux d'une carte existante.
    Poids : 0,4 à 12,6 Mo de JSON par carte (≈ 60 Mo en tout) ; recalcul de 1 à 3 minutes chacune. Cadastre : le service ne répond pas par code pour Noisy-le-Grand, Cergy, Bourges, Chamonix, Murat (secteur à la place).
  - **Prix locaux** : `deriveMarketAdjust` (`app/dvf.ts`) adapte le marché de référence au niveau des ventes de la commune : prix du neuf = ancien × `newBuildPremium` (1,15 à 1,9 : plus forte en ville bon marché ; observé ×1,1 Montreuil,
    ×1,3 Sucy) avec plancher `MIN_NEW_PRICE` (2 200 €/m²) ; peu de ventes → niveau tiré vers la référence ; foncier ×ratio^1,2, coûts de construction ×ratio^0,4 (0,6 à 1,25). `District.marketAdjust` ; `marketOf` l'applique.
    Montreuil et Sucy n'ont pas d'ajustement (marchés réglés à la main). Mise de départ : plancher 15 × coûts fixes d'une opération (Bourges : 50 k€ → 600 k€).
  - **Page de téléchargement** (`jeu/src/districts.ts`, `openMaps` dans `main.ts`) : catalogue `DISTRICTS` (texte) + liste générée à la construction (`data/districts/index.json` : parcelles, taille, prix médian, ventes, PLU ;
    plugin Vite). Téléchargement en flux avec progression (taille connue de l'index), gardé dans le cache `urbasim-maps-v1` (clé versionnée par taille et date de la carte), lecture hors ligne ; supprimer/retélécharger ;
    première ouverture d'une carte = téléchargement avec barre de progression sur l'écran de démarrage ; le service worker laisse passer `/data/districts/` et ne purge pas `urbasim-maps*`. La version autonome n'embarque que
    Montreuil et Sucy (limite de 16 Mo) ; les autres sont signalées « voir le site publié ».
  - **Corrections** : l'enregistrement du service worker attendait l'événement « load », qui arrive avant la fin du chargement de la carte (await de haut niveau) : le jeu installable ne l'était plus depuis 0.10 ; `mergeParcels` ne lève plus
    d'exception sur un contour dégénéré (plantait la recherche des délaissés à Biarritz).
  - Simulations (normal) : Paris 11e ×0,8 / ordinateurs ×0,6 à ×1,1 ; Villeurbanne ×0,8 / ×0,4 à ×2,0 ; Brie ×0,8 / ×1,0 à ×1,7 ; Biarritz ×0,8 / ×0,7 à ×2,6 ; Bourges ×0,9 / ×1,7 à ×2,1 ; Murat ×0,8 / ×1,1 à ×1,4 ;
    aucune faillite. À surveiller : Bourges (ordinateurs très gagnants), Paris (très peu de terrains libres, 11 livrés).

- Fait : **logo unique et police partout** (version 0.12.1).
  - **Logo** : skyline de sept immeubles qui montent vers une tour à balise, soleil levant, fenêtres allumées, dans les couleurs du jeu (bleu, magenta, jaune, vert) sur tuile sombre. Source unique : `jeu/scripts/make-icons.mjs`
    (dessin en code) écrit `public/icons/logo.svg`, `src/assets/logo.svg` (importé par le jeu en `?raw` : écran d'accueil et barre du haut), `public/icons/favicon.svg` (version simplifiée de 5 immeubles, lisible à 32 px) puis les PNG
    (favicon 32 et 48, iOS 180, icônes 192 et 512, maskable 512 en plein cadre) avec Chromium (`NODE_PATH=…/playwright-core`). Avant, l'accueil dessinait en CSS une grille 2×2 : un autre logo que l'icône.
  - **Police** : `--font` dans `style.css`, imposée (`!important`) aux champs, boutons et à tout l'intérieur de `.leaflet-container` (Leaflet impose Helvetica Neue et Lucida Console, y compris sur les boutons de zoom, infobulles,
    cartes flottantes et légendes) ; les lettres M, G, T des pastilles de gare n'ont plus de police en dur. Vérifié par un recensement automatique de la police calculée de chaque élément (accueil, page des cartes, tutoriel,
    jeu, infobulles) : tout est en Alte Haas Grotesk.
  - **Barre du haut** : entre 801 et 1180 px elle passe sur deux lignes (le menu « ⋯ » sortait de l'écran), sous 1340 px le numéro de version la quitte, la pastille du joueur garde une largeur minimale.

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

- Réglage provisoire (0.12.5) : habitat individuel à 50 % d'emprise, 30 % de pleine terre, retraits 4 m fond / 2 m côtés (au lieu de 40 %, 35 %, 5 m / 3 m). Mesuré à Sucy : terrains rentables au prix demandé 70 % → 87 %, marge médiane 3 → 5 % ; le prix demandé suit le potentiel du terrain (résiduel × 0,9 à 1,5, plancher 0,6 × surface × charge foncière), donc assouplir le gabarit seul ne fait pas monter la marge au-delà de ~5 %. Le vrai levier reste le type « maisons ».
- **Idée à étudier avec les ensembles de maisons : division de terrain** : au lieu de raser un terrain pour faire un immeuble, prospecter l'achat d'un **bout** de la parcelle d'une maison individuelle (détachement d'un lot, voirie d'accès) pour y construire une autre maison ; le propriétaire garde sa maison et son jardin réduit. Suppose de découper une parcelle en deux (nouvelle parcelle, façade sur rue ou servitude), un prix pour la part vendue, et des règles de PLU (surface minimale de lot, accès).
- Fait : **carte limitée à la commune** (0.12.4) : `District.outline` (contour de la commune, `fetchCommuneOutline`, `npm run outline -- <id> <insee>`, ajouté aux cartes de Sucy, Brie, Biarritz, Villeurbanne ; absent pour Paris 11e, Bourges et Murat, qui sont un arrondissement ou un secteur). Le jeu ne dessine que le bâti, les voies (tronçons) et le zonage (découpé au contour) dans la commune ; les données restent complètes (densité et équipements voisins).
- Fait : **correction de la classification des zones de PLU** (version 0.12.2). `zoneFamily` (`game/plu.ts`) cherche des mots clés ordonnés dans le libellé long : équipement ; nature (zone verte, jardins familiaux, naturel, agricole,
  cimetière) ; activités sauf si le libellé parle aussi d'habitat ou de mixité ; renouvellement ; centre (coeur de ville, centre-ville, « zone urbaine générale », centralité, sauf « périphérie ») ; **pavillonnaire** (habitat individuel,
  pavillonnaire, faible densité, extensions en périphérie, sauf front bâti, collectif, immeuble, mixte) ; préservation (patrimoine, patrimonial, traditionnel, sauvegardé, jardins ou espaces libres, à protéger, paysager) ; mixte ; puis, quand
  le libellé est vide, égal au code ou seulement « Urbaine », la lettre du code (UA centre, UD/UE/UH/UP pavillonnaire, UY/UI/UX activités, UL équipement). Nouvelle famille `pavillonnaire` (« Habitat individuel » : R+2 attique compris, 40 % d'emprise,
  35 % de pleine terre, retraits 5 m fond et 3 m côtés, 3 bâtiments au plus, 4 m entre bâtiments). `withZoneFamilies` (`game/district.ts`) recalcule les familles d'un instantané sans le retélécharger ; `npm run reprice` l'appelle d'abord.
  Effets : Sucy 6 044 parcelles pavillonnaires (au lieu de 0), prix médian 223 k€ (600 k€ avant), mise de départ 1 050 k€ ; Brie 2 491 pavillonnaires ; Biarritz 4 644 ; Murat 257 ; Paris 11e entièrement « centre » ; Villeurbanne 1 032 en activités (3 302 avant).
  Sans type « maisons », un quartier pavillonnaire n'admet encore que de petits immeubles (R+1 avec combles) ; des parcelles étroites deviennent « à assembler » (Sucy : 720 inconstructibles seules de plus). À surveiller : Bourges (centre classé « centre », marché très bas : 4 207
  délaissés, prix de terrain médian 56 €/m²), les codes sans libellé (UP, UD…) sont des suppositions raisonnables mais pas vérifiées une à une.

### À reprendre plus tard : ensembles de maisons dans les quartiers pavillonnaires (la classification des zones est faite, voir « Fait » plus haut ; reste le type de logement « maisons »)
- **Constat (mesuré le 16/10)** : à Sucy, 6 041 parcelles sur 7 154 sont en « UH : Habitat individuel », mais `zoneFamily` (`moteur/src/game/plu.ts`) ne reconnaît que quelques mots clés et les classe par défaut en « zone mixte »
  (R+4, 60 % d'emprise) : un pavillon de 450 m² est estimé comme un terrain à immeuble (prix demandé médian 600 k€, 1 316 €/m² de terrain ; Sucy « super dur » en jeu). Même défaut ailleurs : Biarritz et Paris 11e entièrement en « mixte »,
  Villeurbanne « habitat et activités économiques » classé en activités, Brie « habitat individuel » en mixte, Murat « patrimonial » en mixte.
- **Piste testée (code mis de côté, non poussé)** : (1) `zoneFamily` plus fin (mots clés ordonnés : équipement, nature/zone verte, activités sauf mixité avec habitat, renouvellement, centre/« zone urbaine générale », pavillonnaire sauf front bâti/collectif/mixte,
  préservation/patrimoine/sauvegardé, puis lettre du code quand le libellé est vide : UA centre, UD/UE/UH pavillonnaire, UY/UI activités) ; (2) nouvelle famille `pavillonnaire` (R+1 avec combles, 40 % d'emprise, 35 % de pleine terre, retraits 5 m fond / 3 m côtés, 8 maisons au plus, maisons seulement) ;
  (3) `withZoneFamilies` pour recalculer les familles d'un instantané sans le retélécharger (appelé par `npm run reprice`) ; (4) type de logement `maison` : un logement par bâtiment, ni escalier ni ascenseur ni hall, emprise ≤ 75 m² (`HOUSE_MAX_AREA`, ≈ 125 m² habitables sur 2 niveaux),
  volume carré (`compact` dans `largestRectangle`), 2 places par maison, construction ×0,9 et 12 k€ de viabilisation par lot, prix de vente ×`houseRatio` (maisons DVF / appartements : Sucy ≈ ×1,23, Montreuil ≈ ×1,05, à calculer dans `app/dvf.ts`), plusieurs maisons par terrain via `buildSecondary`.
- **Reste à faire pour finir** : estimation des terrains et ordinateurs (`appraise`, `bestPlan`) à étendre aux maisons (aujourd'hui ils ne testent que des immeubles) ; sélecteur « immeuble / maisons » et « Meilleur projet » dans l'interface (imposé en zone pavillonnaire) ; `houseRatio` dans les statistiques DVF
  (`npm run market`) ; recalcul de toutes les cartes (`npm run reprice`) ; simulations d'équilibre ; tests de rentabilité d'un petit ensemble de maisons à prix de terrain pavillonnaire (≈ 450 €/m²).

### À faire plus tard : plusieurs types de logements pour les promoteurs (demande du 16/10)
- **Idée** : aujourd'hui un projet est toujours un immeuble collectif (escalier, ascenseur, appartements T1 à T5). Proposer plusieurs **types de programme** pour s'adapter à tout type de terrain : immeuble collectif, **petit collectif**,
  **résidentiel mitoyen** (maisons de ville en bande), ensemble de **maisons individuelles groupées** (lotissement), etc. Le « Meilleur projet » et les concurrents essaient tous les types permis et gardent le plus rentable.
- **Types envisagés** (à affiner avec les données réelles) :
  - *Immeuble collectif* (actuel) : R+3 à R+6, escalier et ascenseur, parkings en sous-sol ; terrains larges, zones denses.
  - *Petit collectif* : R+1 à R+2, un escalier sans ascenseur, 6 à 12 logements, parking en surface ; terrains moyens (400 à 1 000 m²), zones mixtes et bordures de quartiers pavillonnaires.
  - *Résidentiel mitoyen* (maisons de ville en bande) : maisons accolées de 5 à 7 m de large, R+1 avec combles, jardin en fond, un logement par maison ; terrains étroits et profonds.
  - *Maisons groupées* (petit lotissement) : maisons isolées ou jumelées de ≈ 75 m² d'emprise, voirie interne, viabilisation par lot ; grands terrains pavillonnaires.
  - Plus tard : logements intermédiaires (duplex superposés à entrée individuelle), résidences services (étudiants, seniors).
- **Ce que chaque type fixe** : gabarit (niveaux), emprise et forme d'un bâtiment, parties communes (escalier, ascenseur, hall) ou pas, stationnement, coût de construction et viabilisation, prix de vente (maisons ou appartements d'après les ventes réelles DVF),
  surface et largeur de terrain adaptées, et **types admis par zone de PLU** (hyper-centre : collectif et mitoyen ; quartier pavillonnaire : maisons groupées, mitoyen, petit collectif selon la zone ; etc.).
- **Dépendances** : d'abord corriger la classification des zones de PLU (voir la note précédente : l'habitat individuel est classé en zone mixte) ; le type `maison` de l'essai abandonné est un premier pas (`Criteria.housing`) à généraliser en une liste de types.

### Notes de la partie « clarté » (à traiter plus tard)
- ~~Voir les bâtiments construits par les autres sur la carte~~ : fait (voir plus haut).
- **Choix de l'implantation du bâtiment** : le joueur choisit de construire **le long de la route** (à l'alignement, en front
  de rue) **ou en retrait, à l'arrière / au cœur du terrain** (cour ou jardin côté rue). Aujourd'hui le bâtiment est
  placé automatiquement avec les retraits de la zone. À ajouter : option d'implantation dans le formulaire de projet, règles de
  PLU associées (alignement ou retrait obligatoire sur rue, retrait de fond, limites séparatives, prospects, mitoyenneté,
  distance entre bâtiments) et effets sur le bilan (stationnement, vue, éclairement, valeur des logements).
- **Vue 3D des bâtiments** (pour bien plus tard) : visualiser les immeubles en volume, existants et construits par les
  joueurs (les hauteurs sont déjà dans les données et dans les projets).
- **Un affichage plus joli et plus lisible** (premier passage fait, voir plus haut ; reste parcs, routes, libellés) : routes, parcelles, bâtiments, parcs, équipements avec des icônes (gare,
  école, mairie, commerces…), hiérarchie visuelle claire, thèmes.

### Notes de la partie « finitions » (à traiter plus tard, sans y travailler maintenant)
- **Animations un peu partout** : transitions de l'interface (panneaux, fenêtres, barres de progression), chantier qui avance sur
  la carte, argent qui bouge, passage de trimestre.
- **Carte en plein écran** : bouton pour masquer le panneau latéral et agrandir la carte (utile surtout sur mobile).
- **Simuler un projet sur plusieurs parcelles** : tester un assemblage sans acheter les parcelles (bilan, hauteur, emprise) avant de
  s'engager.
- **ZAC plus développées** : quartiers entiers, plusieurs lots à attribuer, équipements publics inclus (écoles, voirie, parcs) avec
  leur financement, phasage dans le temps ; à relier aux appels d'offres existants (`PROGRAMMES`).
- **Faciliter la prospection de plusieurs terrains à la fois** : sélection multiple pour faire plusieurs offres, avec la
  possibilité que certains propriétaires **spéculent** sur leur terrain (prix de réserve qui monte, refus d'offres raisonnables).
- **Encore faciliter l'affichage, et donner les infos qu'on doit aujourd'hui aller chercher** : informations directement visibles
  (règles applicables, prix au m², raison d'un blocage, rentabilité estimée) sans ouvrir des sections.
- **Règles d'urbanisme parfois étranges** : en zone très dense (ultra-centre de Montreuil), un retrait latéral exigé rend tout projet
  non rentable. À étudier : corriger par la forme du bâtiment sur le terrain (volumes en L ou en U, bâtiment en limite), ou revoir
  les règles par **niveau de densité** (centre dense : construction en limite autorisée, pas de retrait latéral ; périphérie :
  retraits), plutôt qu'une règle unique par famille de zone.
- **Formes de bâtiments parfois bizarres et peu réalistes** : emprises en pointes, redans, côtés trop courts ; à nettoyer (simplifier,
  rectifier, imposer une largeur et des angles minimaux).
- **Petits bouts de parcelles inutilisables, même assemblés** : les étudier (délaissés, fonds de parcelle, trottoirs) sans tout
  supprimer ; pistes : les marquer « délaissé » avec un prix très bas, les rendre cessibles à un voisin, ou les regrouper
  automatiquement avec la parcelle voisine la plus logique.

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

### 0.13.0 — équilibre prix / finances / maisons
- Type de logement `maison` (zones pavillonnaires = maisons seules), valeur du bâti existant en plancher du prix demandé (`existingValue`), stats DVF maisons, terrain remboursé au lancement (prêt 80 %), écart de prix demandé 0,85–1,25 × résiduel.
- Mesuré à Sucy : pavillonnaire rentable au prix demandé 81 %, marge médiane 6,5 %, prix médian 576 k€ ; trésorerie de départ 1,5 M€.

### 0.13.2 — prix par zone (calcul léger)
- `priceModel` (district.ts) : prix au m² par zone = a + b·(situation−1), étalonné sur 24 terrains types par zone (calcul exact), ×0,8 ; `estimateBest` l'applique à chaque parcelle. Les bonus d'équipements restent via `locationFactor`.
- Contrôle géométrique rapide (`structuralIssue`) et délaissés sans nouveau projet : Sucy 7 154 parcelles en ~30 s sur 4 cœurs (avant ~4 min), 8 cartes en moins de 3 min.
- Parcelles `zone` (nature, équipement, POI école/mairie/université/santé) retirées des terrains proposés. Églises : pas de donnée, à faire. Bâtiment unique sur terrain large et peu profond : à traiter (maisons en rangée).

### 0.13.6 — formes de bâtiments
- `clipLength` (footprint.ts) : emprise tronquée à 55 m (`MAX_BUILDING_LENGTH`), le reste est libre pour les bâtiments suivants ; largeur minimale d'un immeuble 8 m (`MIN_BUILDING_WIDTH`, plu.ts), 6 m en tissu dense (`ZoneRule.minBuildingWidth`), maisons 6 m. `regularize` : rectangle dès 50 % de l'emprise tarabiscotée (avant 70 %).
- À faire : conserver le bâti existant (3) et formes en L/U/plots (4).

### Carte libre — étape 1 : mesure (`npm run bench-open -- "<nom>" <insee> <marché>`)
- Préparation complète d'une commune sur un seul cœur (téléchargement puis calcul) : Sucy 7 264 parcelles **66 s** (avant parallélisation du téléchargement : 147 s), Villeurbanne 10 117 parcelles 81 s, Murat (commune entière, rurale, 1 142 requêtes, 71 Mo) 138 s.
- Le goulot était le cadastre (pages de 500 parcelles lues en série, ~58 s pour Sucy) : lu par lots de 4 pages (`getAllPages`, `PAGE_CONCURRENCY`), carreaux par lots de 4 (`pool`, `TILE_CONCURRENCY`). Reste ~16 s de cadastre, ~12 s de marché (DVF) et équipements, ~26 s de calcul (densité, modèle de prix, contrôle géométrique), ~2 s de délaissés.
- Prochaines étapes : recherche de commune, choix du marché, calcul dans un Web Worker avec progression, garde-fous (grandes communes, rurales).
- Décision : **pas de découpage en secteurs pour les petites villes ni les communes rurales** (commune entière) ; secteur ou arrondissement seulement pour les très grandes villes (Paris, Lyon, Marseille…). Murat entière : 115 s (10 326 parcelles dispersées en hameaux ; `COUNTRYSIDE_PARCEL` écarte seulement les carreaux sans petite parcelle).

### Carte libre — étape 2 : recherche de commune (visible avec `?libre`)
- `moteur/src/app/communes.ts` : `searchCommunes` (API Géo, nom ou code postal), `marketFor` (75 Paris ; 92/93/94 petite couronne ; 77/78/91/95 grande couronne ; ≥ 60 000 hab. grande ville ; sinon ville moyenne, niveau de prix recalé ensuite sur les ventes réelles), `ARRONDISSEMENTS` (Paris 20, Lyon 9, Marseille 16 : code cadastre + code DVF), `countParcels` (`totalFeatures` de l'API cadastre, une seule parcelle demandée), `estimateSeconds`, `MAX_PARCELS` = 12 000.
- UI : `jeu/src/communeSearch.ts`, bloc « Une autre commune » de la page Cartes, visible seulement avec `?libre` (la préparation n'est pas branchée). Testé dans Chromium : Sucy 7 638 parcelles / ~70 s, Paris 11e 4 629 parcelles / ~50 s. Lyon 7e : cadastre OK avec insee 69123 + arr 387.
- Attention : l'API Géo répond de façon capricieuse depuis le bac à sable (retries ajoutés) ; CORS OK (vérifié avec l'en-tête Origin).

### Carte libre — étape 4 : préparation dans le navigateur (version 0.14.0)
- `jeu/src/prepareWorker.ts` (Web Worker, importé en `?worker&inline` donc aussi dans la page autonome) : `fetchCommune` (progression structurée `CommuneOptions.progress`) puis `withZoneFamilies`, `withRoadClip`, `priceParcels` (rappel d'avancement), `wastelandIds`. `jeu/src/customMaps.ts` : `prepareMap`, cache `urbasim-maps-custom-v1` (index + une entrée par carte, nom en `urbasim-maps…` donc épargné par le service worker), ids `libre-<insee>[-<arr>]`, `loadCustomDistrict` (branché dans `loadDistrict`), suppression. UI : bloc « Une autre commune » (`communeSearch.ts`) avec barre de progression et annulation, section « Mes cartes » dans la page Cartes.
- Testé dans Chromium : Marolles-en-Brie (1 831 parcelles) prête en 40 s, jouable (sauvegarde par carte). Reste : secteur pour les très grandes villes (> 12 000 parcelles : message seulement), reprise après coupure, tests sur d'autres communes (Marseille, Noisy, Bourges, Chamonix).

### Carte libre — garde-fous (version 0.14.1)
- **Très grandes communes** (> `MAX_PARCELS` = 12 000) : secteur carré autour du centre (API Géo) aux rayons 600 m / 1 km / 1,5 km / 2,2 km, nombre de parcelles exact par rayon (`countParcelsBox`) ; id `libre-<insee>-s<rayon>`. Arrondissements trop grands : message seulement.
- **Reprise** : le worker garde les réponses des services (cache temporaire `urbasim-prep-tmp`, vidé quand la carte est prête) ; « Réessayer » ne retélécharge que le manquant. **Délais** : 45 s par requête (avant : une requête pouvait pendre indéfiniment, vu sur Albepierre-Bredons), 20 s + 5 essais pour la recherche.
- **Ventes réelles dans le navigateur** : les fichiers DVF (Etalab) renvoient un 302 vers un stockage sans en-tête CORS, donc illisibles depuis une page. Repli sur l'API DVF+ du Cerema (`fetchMarketStatsCerema`, CORS ouvert) : mêmes statistiques, mais typologie déduite de la surface (×0,9, la surface bâtie inclut des annexes) et 6 000 ventes au plus ; écarts mesurés avec les fichiers : Sucy 4 028 contre 3 626 €/m², Toulouse 3 286 contre 3 271. Option à étudier : pré-calculer les statistiques par commune (fichiers statiques par département).
- Sans PLU (zones absentes) : règles par défaut, simulé sur Murat sans zonage (pas de faillite).

### Carte libre — essais sur 4 communes (version 0.14.2), dans Chromium via l'interface
- Le cadastre par `code_insee` met parfois plus de 10 s à répondre (Noisy 93051 et Chamonix 74056 : plus de 40 s, Bourges 37 s) alors que la requête par contour (`geom`) répond en ~1 s : `cadastreSelector` essaie le code (10 s), puis bascule sur le contour de la commune (simplifié à ~100 points) et écarte les parcelles voisines qui touchent la limite. Les arrondissements (Paris, Lyon, Marseille) répondent vite par code.
- Résultats (durée de préparation dans le navigateur) : Noisy-le-Grand 11 178 parcelles, 225 s, appartements 4 348 €/m², trésorerie de départ 1,25 M€ ; Chamonix 22 895 parcelles (20 050 gardées), 305 s, 9 226 €/m², 6,10 M€ ; Bourges (37 936 parcelles : secteur) centre 1 km, 7 294 parcelles, 153 s, 1 631 €/m², 700 k€. Estimation affichée recalée : 15 s + 0,019 s par parcelle.
- `needsSector` : secteur si > 25 000 parcelles, ou > 12 000 dans une commune de 20 000 habitants ou plus (un village étendu reste entier).

### Carte libre — parties simulées sur les cartes préparées (`bench-open --save=<id>`, puis `npm run simulate`)
- Noisy-le-Grand, Chamonix, Bourges (secteur 1 km) et Marseille 7e : parties complètes (40 trimestres, difficulté normale, graine 1) sans faillite, 17 à 57 s, tour max 3,2 s. Valeur nette finale des concurrents ×1,1 à ×5,5 (Marseille ×4,2 et ×5,5, Chamonix ×3,9 : marchés généreux) ; mêmes ordres de grandeur que les cartes existantes (Sucy ×1,1 à ×4,2, Villeurbanne ×1,9 à ×3,7, Biarritz ×1,9 à ×3,0, Montreuil ×0,9 à ×2,1). Joueur inactif ×0,8. À surveiller : écart entre concurrents (Chamonix graine 1 à mi-partie : un concurrent à ×0,2).

### Équilibre des cartes préparées : mesures (outil `npm run margins -- <id>` : marge du meilleur projet au prix demandé)
- Valeur finale du meilleur concurrent en difficulté normale, 4 graines (objectif ×1,7) : Marseille 7e ≈ ×6, Chamonix ≈ ×4,3, Sucy ≈ ×3,9, Villeurbanne et Biarritz ≈ ×3,6, Noisy ≈ ×2,6, Montreuil ≈ ×1,9, Bourges ≈ ×1,8.
- Essai : coefficient du modèle de prix 0,8 → 0,92 (prix demandés +15 %, mise de départ +15 %) : effet d'environ −10 % sur ces multiples, noyé dans la dispersion entre graines ; Marseille centre tombait à une marge médiane de 1 % (44 % de terrains déficitaires). **Abandonné** (rien commité). Le concurrent « agressif » (réserve nulle, 2 achats par tour, jusqu'à R+7) gagne ×5,3 à ×5,8 à Marseille sur 4 graines sur 4 : le moteur n'est pas le prix des terrains mais l'effet de levier (prêt 80 %) sur plusieurs cycles. Leviers à étudier : levier bancaire, délais de vente, profil agressif.

### Orientations décidées (octobre 2026)
- **Mode de jeu** : un seul pour l'instant (objectif ×2 la mise, ex-« normal » ; le sélecteur de difficulté est retiré, les préréglages facile/difficile restent dans `rules.ts` pour les anciennes sauvegardes). Plus tard, des modes seulement s'ils apportent du fun : affrontements plus directs entre joueurs, contraintes qui changent beaucoup.
- **Équilibrage** : meilleur concurrent ×1,8 (Bourges, Montreuil) à ×6 (Marseille) sur la même difficulté ; le moteur des gros scores est le levier bancaire (prêt 80 %) du profil agressif, pas le prix des terrains (essai +15 % de prix : −10 % seulement). Pistes : prêt 70 % ou seuil de vente sur plan plus haut, bridage du profil agressif, objectif propre à chaque carte (simulation de bots au moment de préparer la carte).
- **Ergonomie (à faire)** : (1) fiche de verdict par terrain en haut du panneau avec une jauge rouge / orange / vert « déficitaire – limite – rentable », le gain estimé et le bouton suivant (« Faire une offre »), détail replié dessous ; (2) réorganiser la carte et ses filtres, une seule légende contextuelle, infos au survol ; (3) refaire VRAIMENT le fil du trimestre : que peut-on faire pendant son tour, et quand faut-il passer à la suite ; (4) langage simple (lexique en infobulles, messages d'erreur qui disent quoi faire) ; (5) le PC reste la base (panneau latéral), le mobile s'adapte ensuite (tiroir en bas).
- **Plus tard** : style plus « cartoon » et grand public tout en gardant l'aspect cadastre / pro ; animations et petits détails visuels ; carte plus belle, vue 3D. Pas de direction artistique pour l'instant.

### Écran d'accueil et choix du lieu (version 0.16.0)
- `jeu/src/homeScene.ts` : décor SVG généré (immeubles aux couleurs du logo qui sortent de terre, fenêtres qui s'allument, grue, nuages, soleil ou lune selon le thème), animé en CSS, figé si `prefers-reduced-motion`. Accueil : Jouer / Continuer, lieu actuel, badge « bêta ».
- Nouvelle partie → `openPlaceChooser` : « Villes prédéfinies » ou « Ville de votre choix · bêta » ; `openMaps(view)` ; `playOn(id)` enchaîne sur la création de société après un changement de carte (drapeau `urbasim-start-new` en sessionStorage).
- Question ouverte : un objectif chiffré est-il utile ? Piste : classement final seulement (voir la discussion d'octobre 2026).

### Classement seul et accueil selon l'heure (version 0.17.0)
- **Plus d'objectif chiffré** (`goalMultiple` reste dans la config du moteur mais n'est plus affiché) : on gagne en finissant premier au patrimoine. En-tête : « 2e / 4 » (clic = classement). `jeu/src/podium.ts` : classement vertical (couronne, médailles, barre, flèches ▲▼ vs le trimestre précédent, glissement animé des lignes quand l'ordre change, montants qui comptent). Utilisé par le bilan annuel (fenêtre chaque 1er janvier, `openRanking(true)`), l'onglet Classement, l'écran de fin (verdict par rang : Champion du quartier / Médaille d'argent / Sur le podium / Le quartier vous a résisté) et la fiche de sauvegarde de l'accueil. Mémoire des rangs : `rankMem` (par session).
- **Accueil** (`homeScene.ts`) : le ciel suit l'heure locale (`?heure=22` pour forcer) : dégradé selon 10 repères horaires, soleil de 6 h 30 à 20 h (orange près de l'horizon) puis lune, étoiles, nuages teintés, fenêtres qui s'allument au crépuscule puis en pleine nuit (classes `w0..w3`, `data-dark` 0/1/2), mise à jour chaque minute. Grues en treillis (mât, flèche, haubans, contre-flèche, cabine, chariot, charge) sur trois plans (deux au fond, deux devant) plantées sur le toit d'immeubles précis.

### Pastille de notification animée = « moteur » des notifs (version 0.17.2)
- `jeu/src/notifyPill.ts` : `pillHTML({ id, icon, label, title, placement })` + `mountPill(root, { …, onClick })` → `{ setUnread(bool | nombre), announce(texte?, ms), collapse(), dispose() }`. Icône ronde avec point rouge qui pulse (nombre > 1 : compteur) ; `announce` la déroule en pilule avec son texte pendant `ms` (7 s par défaut) puis la replie en gardant le point jusqu'à lecture. CSS : `.npill` (+ `.npill-corner` pour le coin haut droit), figée si `prefers-reduced-motion`.
- Premier usage : nouveautés de l'accueil (`hasNewNotes` / `markNotesSeen`, clé `urbasim-notes-seen-v1`). À réutiliser pour les notifications en jeu (offre reçue, appel d'offres, aléa, fin de chantier) : une pastille par type, ou une seule avec compteur.

### Verdict par terrain (version 0.17.4)
- `verdictCard` (main.ts) : carte en haut du panneau Terrain (`lastVerdict`, placeholder `<!--VERDICT-->`) : « Rentable / Limite / Déficitaire » (marge < 0 %, < 8 %, ≥ 8 % ; « À corriger » si le projet est refusé), jauge rouge-orange-vert de −15 % à +25 % avec le curseur de la marge actuelle et la fourchette si les prix de vente varient de ±5 % (`salesPremium`), hausse de prix nécessaire pour l'équilibre quand c'est déficitaire (marge quasi linéaire en prix), étape suivante, bouton « Lancer l'opération » pour un terrain acheté. Recalculé à chaque rendu avec le marché du moment (`currentMarket`). Pour la simulation d'un assemblage, la carte reste dans le bloc « Projet sur l'ensemble ».
- À étudier : prendre en compte les facteurs qui aident (ZAC, équipements, programmes) dans la fourchette, pas seulement ±5 % de prix.

### Fil du trimestre (version 0.17.4)
- Onglet **Trimestre** (premier onglet, ouvert par défaut et après chaque trimestre quand rien n'est sélectionné) : `quarterPlan()` / `renderQuarter()` (main.ts). Bandeau d'état (orange « il vous reste N choses » / vert « vous avez fait le tour : vous pouvez passer » / gris en attente), alertes « À ne pas rater » (`watchList`), liste « Pendant ce trimestre vous pouvez… » (terrains à lancer = à faire car portage, appels d'offres = à faire seulement au dernier trimestre, terrains en vente et offres en cours, opérations en cours, « rien en cours » sinon), « Quand vous passez au trimestre suivant… » (offres départagées, opérations qui avancent, portage, concurrents, marché) et bouton de fin. Pastille de compteur sur l'onglet ; le bouton « Fin du trimestre » de l'en-tête pulse (`#end.ready`) quand il n'y a plus rien à faire.
- Idées : afficher aussi les terrains vendus par les concurrents, les échéances de la ZAC, un rappel si la trésorerie dort.

### Marge attendue en direct (version 0.17.5)
- `expectedMargin(state, run)` (`moteur/src/game/sales.ts`, testé) : marge du lancement − surcoûts + (prix du lot aujourd'hui − prix au lancement) × lots restants ; le curseur « Prix de vente » d'une opération (carte d'opération) met à jour la marge et son pourcentage à chaque déplacement (`data-margin`, `data-margin-rate`). Ne compte pas les intérêts supplémentaires d'une vente plus lente.
- Règle de version : une nouvelle version (0.17.x) à chaque ajout visible, pas de modification d'une version déjà publiée.

### Carte et filtres réorganisés (version 0.17.6)
- Nouvelle vue **Terrains** (par défaut) : pas de bâti coloré, terrains libres en gris discret, seuls les propriétaires et statuts (en vente, à assembler, communal…) ressortent. Les anciennes vues restent : Hauteur, Zonage, Lieu, Prix.
- Barre d'outils en haut à droite (`mapTools`, `VIEWS`) : un sélecteur segmenté pour la vue, et un bouton « Filtres » (point bleu quand un filtre est actif) qui déplie : terrains libres (tous / en vente / à ma portée / à assembler), équipements, sélection multiple ; se ferme au clic ailleurs ou Échap. Légende repliée par défaut (« Légende ▸ »), propre à la vue choisie.
- Idées : palette plus sobre pour les hauteurs et le zonage ; infos au survol seulement ; légende réduite aux seuls éléments visibles.

### Panneau de droite remis en ordre (version 0.17.7)
- Onglet Terrain d'un terrain libre : en-tête et chiffres clés → **verdict** (avec le prix de terrain maximal pour la marge visée et ce qu'on compte payer) → **Acquérir ce terrain** (offre / achat) → **Projet** (niveaux, attique, type, indicateurs) → repliés : Options, Répartition des logements, Détail du bilan, **Analyse du terrain** (règles en pastilles, « meilleur projet », voisines à assembler ; ouverte d'office pour un terrain « à assembler »), Règles d'urbanisme, Situation. Avant, l'analyse et les pastilles précédaient l'achat.
- À faire : alléger le texte des encadrés bleus (« Pas en vente »), regrouper les trois indicateurs sous le verdict, curseur plutôt que menus pour les niveaux.

### Notifications en jeu (version 0.17.8)
- Moteur `notifyPill.ts` réutilisé : `renderPills()` (main.ts) affiche en bas à droite de la carte une pastille par type de notification non lue (`PILL_KINDS`) ; elle se déroule à l'arrivée (texte tronqué à 46 caractères), se replie en icône + compteur, un clic ouvre le panneau filtré et la retire. `resetNotifications()` au début de chaque partie ; pas d'annonce au chargement d'une sauvegarde (`pillsReady`).
