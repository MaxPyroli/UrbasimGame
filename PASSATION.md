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
- À faire ensuite : valeur selon le lieu (gares, centre), PLU de jeu par zone, appels d'offres, programmes (TVA 5,5 %,
  ZAC), multijoueur pair-à-pair ; côté interface : critères avancés (retraits, mix de typologies), vue 3D, mobile.

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

## 6. Pour démarrer la nouvelle session
Donnez-lui ce fichier et dites par exemple : « Reprends le moteur de `./moteur`, crée la structure du jeu, et
commence par le bilan du promoteur (module pur, testé), à brancher sur `computeProject`. » Vérifiez que la session a
bien accès au nouveau dépôt.
