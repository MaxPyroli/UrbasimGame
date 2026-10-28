import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import {
  DEFAULT_ASSUMPTIONS,
  DEFAULT_CRITERIA,
  promoterCriteria,
  LocalProjection,
  QUALITY_COST,
  QUALITY_PREMIUM,
  computeBilan,
  computeProject,
  intersection,
  type Criteria,
  type FootprintShape,
  type Parcel,
  type HousingType,
  type Typology,
  mixFit,
  typologyPriceFactor,
  type ParkingStrategy,
  type Placement,
} from '../../moteur/src/engine';
import {
  ISSUE_MESSAGE,
  housingTypesFor,
  DIFFICULTIES,
  campaignConfig,
  bidProblem,
  isRelevant,
  watchList,
  type GameEvent,
  type Watch,
  committedCash,
  committedTenderCash,
  isListed,
  openTenders,
  scoreBid,
  tenderBidOf,
  tenderWorth,
  programmeParams,
  LAUNCH_GRACE,
  EQUIPMENT_BUILD_ROUNDS,
  type Zac,
  MAX_SOCIAL_SHARE,
  type Quality,
  type Tender,
  minOfferPrice,
  offerOf,
  offersOn,
  prospectFee,
  type Difficulty,
  PALETTE,
  botIdentities,
  monogram,
  randomIdentity,
  sanitizeName,
  sanitizeSlogan,
  type Identity,
  ZONE_RULES,
  criteriaFor,
  ruleOf,
  plotIssue,
  MAX_PRICE_POLICY,
  MIN_PRICE_POLICY,
  applyAction,
  createGame,
  currentMarket,
  currentParams,
  LOCATION_RULES,
  districtToSeeds,
  marketOf,
  expectedSales,
  lotsLeft,
  lotPrice,
  expectedMargin,
  marketDemand,
  soldShare,
  unitsOnOffer,
  locationParts,
  mergeParcels,
  netWorth,
  playBots,
  ranking,
  type Action,
  type District,
  type GameState,
  type Plot,
  type ProjectRun,
} from '../../moteur/src/game';
import { pointInRing } from '../../moteur/src/game/district';
import { CHANGELOG } from './changelog';
import { mountCommuneSearch } from './communeSearch';
import { applySky, currentHour, homeScene } from './homeScene';
import { mountPill, pillHTML, type Pill } from './notifyPill';
import { mountPodium, type PodiumRow } from './podium';
import { deleteCustomMap, listCustomMaps, type CustomMap } from './customMaps';
import logoSvg from './assets/logo.svg?raw';
import { DISTRICTS, DEFAULT_DISTRICT, chooseDistrict, chosenDistrictId, deleteMap, downloadMap, downloadedMaps, listMaps, loadDistrict, type MapEntry } from './districts';

// Carte choisie sur l'écran d'accueil (changer de carte recharge la page) ; ses données sont chargées à la demande.
const districtId = chosenDistrictId();
let district: District;
try {
  // Première ouverture de cette carte : téléchargement (avec progression), puis elle reste sur l'appareil.
  const bootEl = document.getElementById('boot');
  district = await loadDistrict(districtId, (done) => {
    if (bootEl) bootEl.innerHTML = `<b>Téléchargement de la carte…</b><div class="dl-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(done * 100)}"><i style="width:${Math.round(done * 100)}%"></i></div><span class="muted">${Math.round(done * 100)} % · une seule fois, la carte reste ensuite sur cet appareil</span>`;
  });
} catch (e) {
  const boot = document.getElementById('boot');
  if (boot) boot.innerHTML = `<b>Impossible de charger la carte.</b><br>${e instanceof Error ? e.message : ''}<br><button id="boot-retry" type="button">Réessayer</button>${districtId !== DEFAULT_DISTRICT ? ' <button id="boot-default" type="button">Revenir à Montreuil</button>' : ''}`;
  document.getElementById('boot-retry')?.addEventListener('click', () => location.reload());
  document.getElementById('boot-default')?.addEventListener('click', () => (chooseDistrict(DEFAULT_DISTRICT), location.reload()));
  throw e;
}
const ME = 'moi';
/** Une sauvegarde par carte (celle de Montreuil garde son nom d'origine). */
const SAVE_KEY = districtId === DEFAULT_DISTRICT ? 'urbasim-save-v5' : `urbasim-save-v5-${districtId}`;
const FALLBACK_COLORS: Record<string, string> = { moi: PALETTE[0], prudent: PALETTE[1], equilibre: PALETTE[2], agressif: PALETTE[3] };
const PROFILE_LABEL: Record<string, string> = { prudent: 'prudent', equilibre: 'équilibré', agressif: 'agressif' };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const eur = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(2).replace('.', ',')} M€` : `${Math.round(n / 1000).toLocaleString('fr-FR')} k€`);
const eurFull = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;
const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')} %`;
const TUTO_KEY = 'urbasim-tuto-v1';
/** Version bêta (« 0.9 »), numéro de build (nombre de mises à jour publiées) et date de construction. */
const VERSION = __APP_VERSION__.replace(/\.0$/, '');
const BUILD = __APP_BUILD__;
const BUILD_KEY = 'urbasim-build-v1';
/** Dernière note de version lue : l'icône des nouveautés s'anime tant que la dernière version du journal n'a pas été ouverte. */
const NOTES_KEY = 'urbasim-notes-seen-v1';
const latestNotes = () => CHANGELOG[0]?.version ?? '';
function hasNewNotes(): boolean {
  try {
    const seen = localStorage.getItem(NOTES_KEY);
    if (seen === null) {
      // Joueur déjà venu avant l'arrivée de cette icône : on lui signale la nouveauté ; première visite : rien à signaler.
      if (localStorage.getItem(BUILD_KEY) !== null) return true;
      localStorage.setItem(NOTES_KEY, latestNotes());
      return false;
    }
    return seen !== latestNotes();
  } catch {
    return false;
  }
}
function markNotesSeen() {
  try {
    localStorage.setItem(NOTES_KEY, latestNotes());
  } catch {
    /* stockage indisponible */
  }
  newsPill?.setUnread(false);
  newsPill?.collapse();
  document.getElementById('ver')?.classList.remove('new');
}

// ---------------------------------------------------------------- état

/** Terrains de la carte, calculés une fois ; leurs parcelles ne sont pas enregistrées dans la sauvegarde (rechargées depuis la carte). */
const seeds = districtToSeeds(district);
const seedParcels = new Map(seeds.map((s) => [s.id, s.parcel]));
/** Parcelles dont la forme est restée celle de la carte (identité d'objet) : elles se retirent de la sauvegarde. */
const pristine = new Map<string, Parcel>(seedParcels);

function newGame(identity: Identity, difficulty: Difficulty = 'normal', seed = Date.now() % 100000): GameState {
  const bots = botIdentities(seed, identity);
  const bot = (id: 'prudent' | 'equilibre' | 'agressif', i: number) => ({ id, name: bots[i].name, bot: true as const, profile: id, color: bots[i].color, slogan: bots[i].slogan });
  return createGame({
    players: [{ id: ME, name: identity.name, color: identity.color, slogan: identity.slogan }, bot('prudent', 0), bot('equilibre', 1), bot('agressif', 2)],
    plots: seeds,
    config: { market: marketOf(district), ...campaignConfig(difficulty) },
    seed,
  });
}

/** Partie sauvegardée, ou null (première visite ou sauvegarde périmée). */
function load(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as GameState;
      if (Array.isArray(s?.plots)) {
        // Parcelles absentes de la sauvegarde : on les reprend de la carte (sinon la sauvegarde est inutilisable).
        for (const p of s.plots) {
          if (p.parcel) continue;
          const seed = seedParcels.get(p.id);
          if (!seed) return null;
          p.parcel = seed;
        }
      }
      if (s?.players?.some((p) => p.id === ME) && Array.isArray(s.plots) && typeof s.demandShock === 'number' && s.config?.salesDemand > 0 && s.plots.every((p) => Array.isArray(p.zones)) && Array.isArray(s.offers) && Array.isArray(s.tenders) && Array.isArray(s.zacs) && s.players.every((p) => typeof p.debt === 'number')) return s;
    }
  } catch {
    /* sauvegarde absente ou illisible : nouvelle partie */
  }
  return null;
}

let pendingStart: GameEvent[] = [];
function showStartPopups() {
  const list = pendingStart;
  pendingStart = [];
  if (list.length) showPopups(list);
}
const saved = load();
/** Vrai dès qu'une partie existe (sauvegardée ou lancée pendant cette session) : l'écran d'accueil propose alors de la reprendre. */
let gameStarted = saved !== null;
/** Sans sauvegarde, une partie provisoire s'affiche derrière la fenêtre de création de société. */
let state: GameState = saved ?? newGame(randomIdentity(Date.now() % 100000), 'normal', 1);
const colorOf = (id: string) => state.players.find((p) => p.id === id)?.color ?? FALLBACK_COLORS[id] ?? '#888';
const shortName = (n: string) => (n.length > 16 ? `${n.slice(0, 15)}…` : n);
let selected = new Set<string>();
let autoBestKey = '';
let multi = false;
/** Coche la case « sélection multiple » de la barre de la carte pour qu'elle reflète l'état. */
function syncMultiBox() {
  const box = document.getElementById('multi') as HTMLInputElement | null;
  if (box) box.checked = multi;
}
let tab: 'trimestre' | 'terrain' | 'marche' | 'commune' | 'operations' | 'journal' | 'classement' = 'trimestre';
let view: 'terrains' | 'hauteur' | 'prix' | 'lieu' | 'zonage' = 'terrains';
/** Terrains libres mis en avant sur la carte : tous, seulement ceux à ma portée, ou ceux à assembler. */
let plotFilter: 'tous' | 'vente' | 'abordables' | 'assembler' = 'tous';
/** Prix saisis pour les offres (par terrain), conservés pendant la navigation. */
const bidDraft: Record<string, number> = {};
/** Propositions en préparation pour les appels d'offres de la commune. */
const tenderDraft: Record<string, { price: number; share: number; quality: Quality; delivery: number }> = {};
/** Appels d'offres dont j'ai déjà été prévenu que le dernier trimestre approche. */
const warnedTenders = new Set<string>();
/** Nombre d'entrées du journal déjà vues dans les notifications (le reste est « nouveau »). */
const SEEN_KEY = 'urbasim-seen-v1';
let seenLog = Math.max(0, Math.round(+(localStorage_get(SEEN_KEY) ?? 0)) || 0);
type NotifFilter = 'tout' | 'alea' | 'commune' | 'operation' | 'terrain';
let notifFilter: NotifFilter = 'tout';
/** Pastilles de notification affichées (par type) ; `pillsReady` passe à vrai une fois l'écran prêt : avant, les nouveautés déjà là sont montrées sans animation. */
const livePills = new Map<string, { pill: Pill; count: number }>();
let pillsReady = false;
let form: { levels: number; attic: boolean; parking: ParkingStrategy; depth: number; placement: Placement; shape: FootprintShape; second: boolean; secondLevels: number | null; mix: Record<Typology, number> | null; housing: HousingType } = { levels: 3, attic: false, parking: 'auto', depth: 12, placement: 'auto', shape: 'adapte', second: true, secondLevels: null, mix: null, housing: 'collectif' };

function save() {
  try {
    // Les parcelles inchangées (des milliers sur une commune entière) ne sont pas enregistrées : la carte les fournit au chargement.
    const slim = { ...state, plots: state.plots.map((p) => (pristine.get(p.id) === p.parcel ? { ...p, parcel: undefined } : p)) };
    localStorage.setItem(SAVE_KEY, JSON.stringify(slim));
  } catch {
    /* stockage plein ou refusé : on joue quand même */
  }
}

function toast(msg: string, error = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = `show${error ? ' err' : ''}`;
  setTimeout(() => (t.className = ''), 3500);
}

function act(a: Action): boolean {
  const r = applyAction(state, a);
  if (!r.ok) {
    toast(r.error, true);
    return false;
  }
  state = r.state;
  save();
  return true;
}

const me = () => state.players.find((p) => p.id === ME)!;
const plotIndexCache = new WeakMap<Plot[], Map<string, Plot>>();
/** Parcelle par identifiant (index mémorisé par état : des milliers de parcelles sur une commune entière). */
const plotById = (id: string) => {
  let idx = plotIndexCache.get(state.plots);
  if (!idx) plotIndexCache.set(state.plots, (idx = new Map(state.plots.map((p) => [p.id, p]))));
  return idx.get(id);
};
const quarterLabel = (round: number) => `T${(round % 4) + 1} ${2027 + Math.floor(round / 4)}`;
const criteria = (): Criteria => ({ ...promoterCriteria(state.config.market), ...(form.mix ? { mix: form.mix } : {}), levels: form.levels, attic: form.attic, parkingStrategy: form.parking, maxDepth: form.depth, placement: form.placement, footprintShape: form.shape, secondBuilding: form.second, secondLevels: form.secondLevels, housing: form.housing });

/** Passe un trimestre sans rien afficher ; retourne les nouvelles du journal qui concernent le joueur. */
function advanceOne(): { mine: string[]; phases: string } {
  const before = state.log.length;
  const phasesBefore = myPhases();
  if (!me().ready && !act({ type: 'ready', player: ME })) return { mine: [], phases: phasesBefore };
  state = playBots(state);
  save();
  const mine = state.log.slice(before).filter((e) => e.player === ME || (!e.player && e.popup)).map((e) => e.text);
  return { mine, phases: phasesBefore };
}

const myPhases = () => state.projects.filter((p) => p.owner === ME).map((p) => `${p.id}:${p.phase}`).join(',');

function afterAdvance(message: string, before = state.log.length) {
  selected = new Set([...selected].filter((id) => plotById(id)));
  if (state.over) tab = 'classement';
  else {
    toast(message);
    if (selected.size === 0) tab = 'trimestre'; // nouveau trimestre : on repart de la liste de ce qu'on peut faire
  }
  renderAll();
  if (state.over) return openEndScreen();
  // Les aléas et verdicts importants s'affichent dans une fenêtre, un par un.
  const popups = state.log.slice(before).filter((e) => e.popup && isRelevant(e, ME) && (e.player === ME || !e.player));
  if (popups.length) showPopups(popups);
  else if (state.round > 0 && state.round % 4 === 0) openRanking(true); // chaque 1er janvier : bilan de l'année
}

/** Les concurrents calculent leur tour (parfois plusieurs secondes la première fois) : on l'indique avant de bloquer la page. */
function busy(work: () => void) {
  const end = document.getElementById('end');
  if (end) {
    end.textContent = 'Les concurrents jouent…';
    end.setAttribute('disabled', '');
  }
  document.body.classList.add('busy');
  // Deux images pour que le navigateur affiche l'indication avant le calcul.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      try {
        work();
      } finally {
        document.body.classList.remove('busy');
      }
    }),
  );
}

function endTurn() {
  if (state.over) return;
  busy(() => {
    const before = state.log.length;
    const { mine } = advanceOne();
    afterAdvance(`${quarterLabel(state.round)}${mine.length ? ` — ${mine.length} nouvelle${mine.length > 1 ? 's' : ''} pour vous` : ''}`, before);
  });
}

/** Avance jusqu'à ce qu'il se passe quelque chose pour vous (étape d'une opération, aléa), au plus 8 trimestres. */
function fastForward() {
  if (state.over) return;
  busy(runFastForward);
}
function runFastForward() {
  const hasStake = state.projects.some((p) => p.owner === ME);
  const limit = hasStake ? 8 : 4;
  const before = state.log.length;
  let n = 0;
  let why = '';
  const seenTenders = new Set(state.tenders.map((t) => t.id));
  while (!state.over && n < limit) {
    const { mine, phases } = advanceOne();
    n++;
    const fresh = openTenders(state).find((t) => !seenTenders.has(t.id));
    const lastCall = openTenders(state).find((t) => t.closesAt - 1 === state.round && !tenderBidOf(t, ME) && !warnedTenders.has(t.id));
    if (fresh) {
      why = `la commune lance l’appel d’offres ${fresh.id} (${fresh.spec.programme.label})`;
      break;
    }
    if (lastCall) {
      warnedTenders.add(lastCall.id);
      why = `dernier trimestre pour répondre à l’appel d’offres ${lastCall.id}`;
      break;
    }
    if (mine.length) {
      why = mine[mine.length - 1];
      break;
    }
    if (myPhases() !== phases) {
      why = 'une de vos opérations passe à l’étape suivante';
      break;
    }
  }
  afterAdvance(`${n} trimestre${n > 1 ? 's' : ''} → ${quarterLabel(state.round)}${why ? ` : ${why}` : ''}`, before);
}

// ---------------------------------------------------------------- carte

// Carte d'une commune entière : le bâti, le zonage et les voies téléchargés sur le rectangle englobant débordent sur les
// communes voisines ; on ne montre que ce qui est dans le contour de la commune (sans contour : tout).
const outline = district.outline;
const inCommune = (lon: number, lat: number) => !outline || outline.some((r) => pointInRing(lon, lat, r));
/** Une ligne coupée au contour : les tronçons dont les sommets sont dans la commune. */
function clipLine(line: [number, number][]): [number, number][][] {
  if (!outline) return [line];
  const runs: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (const q of line) {
    if (inCommune(q[0], q[1])) cur.push(q);
    else if (cur.length) (runs.push(cur), (cur = []));
  }
  if (cur.length) runs.push(cur);
  return runs.filter((r) => r.length >= 2);
}
/** Un polygone (zonage) découpé au contour de la commune. */
function clipRing(ring: [number, number][]): [number, number][][] {
  if (!outline) return [ring];
  try {
    return intersection([[ring]], outline.map((r) => [r])).map((poly) => poly[0] as [number, number][]);
  } catch {
    return [ring];
  }
}

const map = L.map('map', { zoomControl: true, preferCanvas: true, attributionControl: false });
// Attribution discrète : une seule ligne courte, le détail des sources est dans « Crédits et données ».
L.control.attribution({ prefix: false }).addTo(map);
/** Sans fond de plan (page hébergée où les images externes sont bloquées) : on dessine les voies du quartier. */
const NO_TILES = import.meta.env.VITE_NO_TILES === '1';
if (!NO_TILES) {
  // Fond de plan OpenStreetMap, adouci par un filtre CSS (voir `.basemap` : désaturé, et inversé en thème sombre) pour que
  // parcelles et bâtiments ressortent.
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 19, className: 'basemap', attribution: '© contributeurs OpenStreetMap' }).addTo(map);
} else {
  map.createPane('routes');
  map.getPane('routes')!.style.zIndex = '300';
  map.getPane('routes')!.style.pointerEvents = 'none';
  const widths = [0, 8, 7, 5, 3.5, 2.5, 1.5];
  // Rendu SVG pour les voies : leur couleur vient de la feuille de style (thème clair ou sombre).
  const roadRenderer = L.svg({ pane: 'routes' });
  for (const r of [...(district.roads ?? [])].sort((a, b) => b.importance - a.importance)) {
    for (const part of clipLine(r.line)) L.polyline(part.map(([lon, lat]) => [lat, lon] as [number, number]), { pane: 'routes', renderer: roadRenderer, interactive: false, className: 'road', weight: widths[r.importance] ?? 2, lineCap: 'round' }).addTo(map);
  }
}
const layers = new Map<string, L.Polygon>();
let overlay: L.LayerGroup = L.layerGroup().addTo(map);

function fitDistrict() {
  const pts = district.parcels.flatMap((p) => p.ring.map((q) => [q.lat, q.lon] as [number, number]));
  map.fitBounds(L.latLngBounds(pts), { padding: [10, 10] });
}

function ownerColor(p: Plot): string | null {
  if (p.projectId) {
    const run = state.projects.find((r) => r.id === p.projectId);
    return run ? colorOf(run.owner) : '#888';
  }
  return p.owner ? colorOf(p.owner) : null;
}

/** Coût d'acquisition d'un terrain libre (prix affiché et frais de notaire). */
const buyCost = (p: Plot) => (state.config.landMarket === 'auction' ? minOfferPrice(p) : p.askingPrice) * (1 + state.config.bilanParams.acquisitionFeeRate);
const affordable = (p: Plot) => buyCost(p) <= me().cash;

function plotStyle(p: Plot): L.PathOptions {
  const sel = selected.has(p.id);
  if (p.zacRole === 'equipement') return { color: sel ? '#000' : '#4a6f9c', weight: sel ? 3 : 1.5, fillColor: '#8fb2dc', fillOpacity: 0.4, dashArray: '2 3' };
  if (p.municipal && !p.owner) return { color: sel ? '#000' : '#0f8b8d', weight: sel ? 3 : 2.5, fillColor: '#7fd1d3', fillOpacity: 0.55, dashArray: '6 3' };
  const col = ownerColor(p);
  const ppm = p.askingPrice / Math.max(1, areaOf(p));
  // Terrains libres : plus le prix au m² est élevé, plus la teinte est foncée (échelle = 10e–90e centile des terrains libres).
  const [lo, hi] = ppmRange;
  const t = Math.min(1, Math.max(0, (ppm - lo) / Math.max(1, hi - lo)));
  const free = view === 'terrains' ? '#cfc7b2' : `hsl(${40 - 30 * t} 80% ${78 - 28 * t}%)`;
  const lieu = view === 'lieu';
  const freePlot = !p.owner;
  const waste = p.issue === 'delaisse';
  const small = !!p.issue && !waste;
  // Terrains libres hors de portée (trop chers pour moi) ou écartés par le filtre : estompés.
  const zoneBlocked = p.issue === 'zone' || waste;
  const listed = freePlot && isListed(p);
  const dim = freePlot && (plotFilter === 'abordables' ? !affordable(p) : plotFilter === 'assembler' ? !small : plotFilter === 'vente' ? !listed : false);
  const faded = freePlot && !affordable(p) && !small;
  const base: L.PathOptions = {
    color: sel ? '#000' : listed ? '#c98200' : zoneBlocked && freePlot ? '#777' : small && freePlot ? '#7b3fa0' : col ?? (view === 'hauteur' ? '#2b6cb0' : '#7a6b4f'),
    weight: sel ? 3 : p.projectId ? 2.5 : listed ? 2.5 : small ? 1.2 : view === 'hauteur' ? 1.2 : 1,
    opacity: small && freePlot ? 0.75 : 1,
    fillColor: col ?? (listed && view !== 'prix' && view !== 'lieu' ? '#f6d27a' : zoneBlocked ? (waste ? '#d9d3c7' : '#bdbdbd') : small ? '#cdb6e6' : lieu ? lieuColor(p.locationFactor) : free),
    // Vue « hauteur » : les parcelles libres restent transparentes pour laisser voir le bâti.
    fillOpacity: col ? (p.projectId ? 0.16 : view === 'hauteur' || view === 'zonage' ? 0.35 : 0.55) : listed ? 0.45 : zoneBlocked ? 0.35 : small ? 0.5 : view === 'hauteur' || view === 'zonage' ? 0 : lieu ? 0.8 : view === 'terrains' ? 0.2 : 0.45,
    dashArray: p.projectId ? '4 3' : small ? '2 4' : waste && freePlot ? '1 4' : undefined,
  };
  if (dim) return { ...base, opacity: 0.2, fillOpacity: (base.fillOpacity ?? 0) * 0.2 };
  if (faded) return { ...base, opacity: 0.55, fillOpacity: (base.fillOpacity ?? 0) * 0.55, dashArray: '1 5' };
  return base;
}

/** Classes de hauteur du bâti existant (m) : borne haute, couleur, libellé en niveaux. */
const HEIGHT_CLASSES: { max: number; color: string; label: string }[] = [
  { max: 6, color: '#fde9a6', label: 'jusqu’à 6 m · RDC à R+1' },
  { max: 10, color: '#f9b657', label: '6 à 10 m · R+2 à R+3' },
  { max: 16, color: '#ee7230', label: '10 à 16 m · R+3 à R+5' },
  { max: 25, color: '#c0302f', label: '16 à 25 m · R+5 à R+8' },
  { max: Infinity, color: '#5d1a4a', label: 'plus de 25 m · R+8 et plus' },
];
const heightColor = (h: number) => (HEIGHT_CLASSES.find((c) => h <= c.max) ?? HEIGHT_CLASSES[HEIGHT_CLASSES.length - 1]).color;

/** Valeur du lieu : bleu = en dessous du quartier médian, beige = médian, orange à brun = au-dessus. */
const LIEU_RANGE: [number, number] = [0.95, 1.09];
function lieuColor(f: number): string {
  if (f < 1) {
    const t = Math.min(1, (1 - f) / (1 - LIEU_RANGE[0]));
    return `hsl(209 ${35 + 30 * t}% ${88 - 22 * t}%)`;
  }
  const t = Math.min(1, (f - 1) / (LIEU_RANGE[1] - 1));
  return `hsl(${32 - 20 * t} ${70 + 15 * t}% ${86 - 38 * t}%)`;
}
const POI_COLORS: Record<string, string> = { metro: '#0b5fa5', gare: '#0b5fa5', tram: '#2f9e8f', mairie: '#8e24aa', ecole: '#d98e04', superieur: '#d98e04', parc: '#2e8b57', sante: '#d62839' };
/** Pictogrammes des équipements (SVG blanc sur pastille de couleur). */
const POI_GLYPH: Record<string, string> = {
  metro: '<text x="12" y="16.5" text-anchor="middle" font-size="13" font-weight="800" fill="#fff">M</text>',
  gare: '<text x="12" y="16.5" text-anchor="middle" font-size="13" font-weight="800" fill="#fff">G</text>',
  tram: '<text x="12" y="16.5" text-anchor="middle" font-size="13" font-weight="800" fill="#fff">T</text>',
  mairie: '<path d="M12 5 4.5 9.5h15L12 5Zm-6.5 6h2v6h-2v-6Zm4.5 0h2v6h-2v-6Zm4.5 0h2v6h-2v-6ZM4.5 18h15v1.8h-15V18Z" fill="#fff"/>',
  ecole: '<path d="m12 5-8 4 8 4 6.2-3.1V15h1.8V9l-8-4Zm-4.5 8.2v2.6c0 1.2 2 2.2 4.5 2.2s4.5-1 4.5-2.2v-2.6L12 15l-4.5-1.8Z" fill="#fff"/>',
  superieur: '<path d="m12 5-8 4 8 4 6.2-3.1V15h1.8V9l-8-4Zm-4.5 8.2v2.6c0 1.2 2 2.2 4.5 2.2s4.5-1 4.5-2.2v-2.6L12 15l-4.5-1.8Z" fill="#fff"/>',
  parc: '<path d="M12 4.5a4.4 4.4 0 0 0-4.3 5.3A3.6 3.6 0 0 0 8.4 17H11v2.5h2V17h2.6a3.6 3.6 0 0 0 .7-7.2A4.4 4.4 0 0 0 12 4.5Z" fill="#fff"/>',
  sante: '<path d="M10.2 5h3.6v5.2H19v3.6h-5.2V19h-3.6v-5.2H5v-3.6h5.2V5Z" fill="#fff"/>',
};
/** Équipements majeurs visibles dès un zoom moyen ; les autres (écoles, parcs…) seulement de près. */
const MAJOR_POI = new Set(['metro', 'gare', 'tram', 'mairie', 'sante']);
function poiIcon(kind: string, big: boolean): L.DivIcon {
  const s = big ? 26 : 20;
  return L.divIcon({
    className: 'poi',
    iconSize: [s, s],
    iconAnchor: [s / 2, s / 2],
    html: `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="${POI_COLORS[kind] ?? '#555'}" stroke="#fff" stroke-width="1.6"/>${POI_GLYPH[kind] ?? ''}</svg>`,
  });
}
const poiLayer = L.layerGroup();
const poiMarkers = district.pois.map((poi) => {
  const marker = L.marker([poi.lat, poi.lon], { icon: poiIcon(poi.kind, MAJOR_POI.has(poi.kind)), keyboard: false, zIndexOffset: MAJOR_POI.has(poi.kind) ? 500 : 0 }).bindTooltip(`${esc(LOCATION_RULES[poi.kind].label)} : ${esc(poi.name)}`, { direction: 'top', offset: [0, -8] });
  return { poi, marker };
});
let showPois = true;
/** Les équipements apparaissent selon le zoom : majeurs d'abord, tous de près. */
function syncPois() {
  const z = map.getZoom();
  for (const { poi, marker } of poiMarkers) {
    const visible = showPois && (view === 'lieu' || z >= (MAJOR_POI.has(poi.kind) ? 14 : 16));
    if (visible && !poiLayer.hasLayer(marker)) poiLayer.addLayer(marker);
    else if (!visible && poiLayer.hasLayer(marker)) poiLayer.removeLayer(marker);
  }
}
poiLayer.addTo(map);
map.on('zoomend', syncPois);

map.createPane('zones');
map.getPane('zones')!.style.zIndex = '330';
map.getPane('zones')!.style.pointerEvents = 'none';
const zonesLayer = L.layerGroup();
// Les grandes zones d'abord : un secteur plus petit recouvrant une zone reste visible par-dessus.
const zoneSize = (z: { rings: [number, number][][] }) => z.rings.reduce((t, r) => t + Math.abs(r.reduce((a, q, i) => a + (r[(i + 1) % r.length][0] - q[0]) * (r[(i + 1) % r.length][1] + q[1]), 0)), 0);
for (const z of [...(district.zones ?? [])].sort((a, b) => zoneSize(b) - zoneSize(a))) {
  for (const ring of z.rings.flatMap(clipRing)) {
    L.polygon(ring.map(([lon, lat]) => [lat, lon] as [number, number]), { pane: 'zones', interactive: false, stroke: true, color: ZONE_RULES[z.family].color, weight: 1, opacity: 0.8, fillColor: ZONE_RULES[z.family].color, fillOpacity: 0.38 })
      .bindTooltip(`${esc(z.code)} · ${esc(ZONE_RULES[z.family].label)}`, { sticky: true })
      .addTo(zonesLayer);
  }
}

map.createPane('bati');
map.getPane('bati')!.style.zIndex = '350';
map.getPane('bati')!.style.pointerEvents = 'none';
const buildingsLayer = L.layerGroup();
/** Bâti d'origine, avec son centre : il disparaît de la carte quand une opération le démolit. Créé à la première utilisation (des dizaines de milliers de bâtiments sur une commune entière). */
const existingBuildings: { layer: L.Polygon; cx: number; cy: number; hidden: boolean }[] = [];
let existingBuilt = false;
function ensureExistingBuildings() {
  if (existingBuilt) return;
  existingBuilt = true;
  for (const b of district.buildings) {
    if (outline && !inCommune(b.ring.reduce((s, q) => s + q[0], 0) / b.ring.length, b.ring.reduce((s, q) => s + q[1], 0) / b.ring.length)) continue;
    const layer = L.polygon(b.ring.map(([lon, lat]) => [lat, lon] as [number, number]), {
      pane: 'bati',
      interactive: false,
      stroke: true,
      color: '#3b2a1a',
      weight: 0.5,
      opacity: 0.6,
      fillColor: heightColor(b.height),
      fillOpacity: b.estimated ? 0.7 : 0.9,
    });
    existingBuildings.push({ layer, cx: b.ring.reduce((t, q) => t + q[0], 0) / b.ring.length, cy: b.ring.reduce((t, q) => t + q[1], 0) / b.ring.length, hidden: false });
  }
  hiddenKey = '\u0000';
}

// Bâtiments des promoteurs : opérations en cours et livrées, dessinés à l'emplacement réel de leur emprise.
map.createPane('bati2');
map.getPane('bati2')!.style.zIndex = '360';
map.getPane('bati2')!.style.pointerEvents = 'none';
const builtLayer = L.layerGroup().addTo(map);
/** ZAC : périmètre en pointillés et pastilles des équipements publics (prévus, en travaux, livrés). */
const zacLayer = L.layerGroup().addTo(map);
const EQUIPMENT_STATUS = { prevu: 'prévu', chantier: 'en travaux', livre: 'livré' } as const;
function hull(points: [number, number][]): [number, number][] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (list: [number, number][]) => {
    const h: [number, number][] = [];
    for (const p of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  return [...build(pts), ...build(pts.reverse())];
}
function drawZacs() {
  zacLayer.clearLayers();
  for (const z of state.zacs) {
    const plots = [...z.lots, ...z.equipment.map((e) => e.plot)].map((id) => plotById(id)).filter((p): p is Plot => !!p);
    // Un lot attribué puis assemblé change d'identifiant : on garde au moins ce qui reste visible.
    const pts = plots.flatMap((p) => p.parcel.ring.map((q) => [q.lat, q.lon] as [number, number]));
    if (pts.length >= 3) {
      L.polygon(hull(pts), { interactive: false, color: '#0f8b8d', weight: 2, dashArray: '10 6', fillColor: '#0f8b8d', fillOpacity: 0.05, lineJoin: 'round' })
        .bindTooltip(`ZAC ${esc(z.name)} · ${z.launched}/${z.lots.length} lots lancés`, { sticky: true })
        .addTo(zacLayer);
    }
    for (const e of z.equipment) {
      const p = plotById(e.plot);
      if (!p) continue;
      const lat = p.parcel.ring.reduce((t, q) => t + q.lat, 0) / p.parcel.ring.length;
      const lon = p.parcel.ring.reduce((t, q) => t + q.lon, 0) / p.parcel.ring.length;
      const icon = poiIcon(e.kind === 'creche' ? 'ecole' : e.kind, true);
      icon.options.className = `poi zac-eq ${e.status}`;
      L.marker([lat, lon], { icon, keyboard: false, zIndexOffset: 700 })
        .bindTooltip(`${esc(e.label)} de la ZAC ${esc(z.name)} · ${EQUIPMENT_STATUS[e.status]}${e.status === 'chantier' && e.deliverAt !== undefined ? ` (livraison dans ${Math.max(0, e.deliverAt - state.round)} trim.)` : ''}`, { direction: 'top', offset: [0, -10] })
        .addTo(zacLayer);
    }
  }
}
/** Rendu SVG des bâtiments des promoteurs : on y glisse des motifs de hachures (un par couleur de promoteur). */
const builtRenderer = L.svg({ pane: 'bati2' });
builtRenderer.addTo(map);
function hatchFill(color: string): string {
  const svg = (builtRenderer as unknown as { _container?: SVGSVGElement })._container;
  if (!svg) return color;
  const id = `hatch-${color.replace(/[^a-z0-9]/gi, '')}`;
  if (!svg.querySelector(`#${id}`)) {
    let defs = svg.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      svg.prepend(defs);
    }
    const pat = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
    pat.setAttribute('id', id);
    pat.setAttribute('patternUnits', 'userSpaceOnUse');
    pat.setAttribute('width', '7');
    pat.setAttribute('height', '7');
    pat.setAttribute('patternTransform', 'rotate(45)');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '0');
    line.setAttribute('y1', '0');
    line.setAttribute('x2', '0');
    line.setAttribute('y2', '7');
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '3');
    pat.appendChild(line);
    defs.appendChild(pat);
  }
  return `url(#${id})`;
}
const footprintCache = new Map<string, [number, number][][] | null>();
let hiddenKey = '';

/** Emprise d'un projet sur la carte ([lat, lon]), mémorisée : le calcul géométrique est coûteux. */
function footprintOf(p: Plot, criteria: Criteria, key: string): [number, number][][] | null {
  let rings = footprintCache.get(key);
  if (rings === undefined) {
    const project = computeProject(p.parcel, criteria);
    if (project.footprint) {
      const proj = new LocalProjection(project.origin.lon, project.origin.lat);
      const geo = (r: [number, number][]) => r.map((v) => proj.toLonLat(v)).map((q) => [q.lat, q.lon] as [number, number]);
      rings = [geo(project.footprint), ...(project.rearFootprint ? [geo(project.rearFootprint)] : []), ...project.extraFootprints.map(geo)];
    } else rings = null;
    footprintCache.set(key, rings);
  }
  return rings;
}

const PHASE_STYLE: Record<string, { opacity: number; dash?: string }> = {
  permis: { opacity: 0.22, dash: '3 3' },
  preventes: { opacity: 0.35, dash: '3 3' },
  chantier: { opacity: 0.3 },
  livraison: { opacity: 0.88 },
};

/** Les bâtiments des joueurs remplacent le bâti d'origine des terrains qu'ils développent. */
function drawBuildings() {
  const developed = state.plots.filter((p) => p.projectId || p.built?.length);
  if (existingBuilt) ensureHidden(developed);
  drawDeveloped(developed);
}

function ensureHidden(developed: Plot[]) {
  // Bâti d'origine démoli : son centre tombe dans un terrain où une opération est lancée ou livrée.
  const key = developed.map((p) => `${p.id}:${p.projectId ?? 'b'}`).join('|');
  if (key !== hiddenKey) {
    hiddenKey = key;
    const rings = developed.map((p) => p.parcel.ring.map((q) => [q.lon, q.lat] as [number, number]));
    for (const b of existingBuildings) {
      const gone = rings.some((r) => pointInRing(b.cx, b.cy, r));
      if (gone && !b.hidden) buildingsLayer.removeLayer(b.layer);
      else if (!gone && b.hidden) buildingsLayer.addLayer(b.layer);
      b.hidden = gone;
    }
  }
}

function drawDeveloped(developed: Plot[]) {
  builtLayer.clearLayers();
  const add = (ring: [number, number][], owner: string, height: number, phase: string) => {
    const st = PHASE_STYLE[phase];
    const col = colorOf(owner);
    L.polygon(ring, {
      pane: 'bati2',
      renderer: builtRenderer,
      interactive: false,
      color: col,
      weight: phase === 'livraison' ? 2 : 2.5,
      opacity: 1,
      dashArray: st.dash,
      fillColor: view === 'hauteur' ? heightColor(height) : col,
      fillOpacity: st.opacity,
    }).addTo(builtLayer);
    // En chantier : hachures de la couleur du promoteur par-dessus.
    if (phase === 'chantier') L.polygon(ring, { pane: 'bati2', renderer: builtRenderer, interactive: false, stroke: false, className: 'chantier-hatch', fillColor: hatchFill(col), fillOpacity: 0.95 }).addTo(builtLayer);
  };
  for (const p of developed) {
    const run = p.projectId ? state.projects.find((r) => r.id === p.projectId) : undefined;
    if (run) {
      for (const ring of footprintOf(p, run.criteria, `${p.id}|${run.id}`) ?? []) add(ring, run.owner, run.height, run.phase);
    } else {
      for (const b of p.built ?? []) {
        for (const ring of footprintOf(p, b.criteria, `${p.id}|${b.runId}`) ?? []) add(ring, b.owner, b.height, 'livraison');
      }
    }
  }
}

const mapLegend = new L.Control({ position: 'bottomleft' });
mapLegend.onAdd = () => L.DomUtil.create('div', 'map-legend');
let legendOpen = false;
function updateMapLegend() {
  const el = mapLegend.getContainer();
  if (!el) return;
  if (view === 'hauteur') {
    el.innerHTML = `<b>Hauteur du bâti existant</b>${HEIGHT_CLASSES.map((c) => `<div><i class="swatch" style="background:${c.color}"></i>${c.label}</div>`).join('')}`;
  } else if (view === 'zonage') {
    el.innerHTML = `<b>Règles d’urbanisme (PLU simplifié)</b>${(['renouvellement', 'centre', 'mixte', 'pavillonnaire', 'preservation', 'activites', 'equipement'] as const)
      .map((f) => {
        const r = ZONE_RULES[f];
        return `<div><i class="swatch" style="background:${r.color}"></i>${esc(r.label)} · ${r.buildable ? `R+${r.maxLevels}${r.use === 'bureaux' ? ' bureaux' : ''}` : 'inconstructible'}</div>`;
      })
      .join('')}`;
  } else if (view === 'lieu') {
    const ramp = [0.95, 0.98, 1, 1.03, 1.06, 1.09].map((f) => `<i class="swatch" style="background:${lieuColor(f)};width:18px"></i>`).join('');
    const kinds = ['metro', 'tram', 'mairie', 'ecole', 'parc', 'sante'].map((k) => `<span><i class="swatch" style="background:${POI_COLORS[k]}"></i>${k === 'ecole' ? 'école' : k === 'sante' ? 'hôpital' : k === 'parc' ? 'espace public' : k === 'mairie' ? 'mairie' : k === 'tram' ? 'tramway' : 'métro'}</span>`).join(' ');
    el.innerHTML = `<b>Valeur du lieu (prix de vente)</b><div>${ramp}</div><div class="muted">moins cher ← quartier médian → plus cher</div><div style="margin-top:3px">${kinds}</div>`;
  } else if (view === 'prix') {
    el.innerHTML = `<b>Prix des terrains libres</b><div>plus foncé = plus cher au m²</div>`;
  } else {
    el.innerHTML = '<b>Légende</b>';
  }
  // Repères communs à toutes les vues : propriétaires et symboles.
  const owners = [`<span><i class="swatch" style="background:${colorOf(ME)}"></i>vous</span>`, ...state.players.filter((p) => p.bot).map((p) => `<span><i class="swatch" style="background:${colorOf(p.id)}"></i>${esc(shortName(p.name))}</span>`)].join(' ');
  el.innerHTML += `<div class="legend-common">${owners}<br><span><i class="swatch" style="background:#f6d27a;border:2px solid #c98200"></i>en vente</span> <span><i class="swatch" style="background:#cdb6e6;border:1px dashed #7b3fa0"></i>à assembler</span> <span><i class="swatch" style="background:#7fd1d3;border:1px dashed #0f8b8d"></i>terrain communal</span> <span><i class="swatch" style="background:#d9d3c7;border:1px dotted #8a8478"></i>délaissé</span> <span><i class="swatch" style="background:#fff;border:2.5px solid #1f6feb"></i>bâtiment construit (contour = promoteur ; hachuré = en chantier ; pointillé = en préparation)</span> <span>pastilles : équipements (survol = nom)</span></div>`;
  // Repliable (fermée par défaut sur petit écran) : le titre devient la ligne cliquable.
  const title = el.querySelector('b');
  const heading = title ? title.outerHTML : '<b>Légende</b>';
  if (title) title.remove();
  el.innerHTML = `<details class="lg" ${legendOpen ? 'open' : ''}><summary>${heading}</summary>${el.innerHTML}</details>`;
  el.querySelector('details')!.ontoggle = (e) => (legendOpen = (e.target as HTMLDetailsElement).open);
  L.DomEvent.disableClickPropagation(el);
}

/** Barre d'outils de la carte : une vue à choisir d'un clic, et un bouton « Filtres » qui déplie le reste. */
const VIEWS = [['terrains', 'Terrains'], ['hauteur', 'Hauteur'], ['zonage', 'Zonage'], ['lieu', 'Lieu'], ['prix', 'Prix']] as const;
const FILTERS_FREE = [['tous', 'Tous'], ['vente', 'En vente'], ['abordables', 'À ma portée'], ['assembler', 'À assembler']] as const;
const mapTools = new L.Control({ position: 'topright' });
function syncToolbar() {
  const el = mapTools.getContainer();
  if (!el) return;
  el.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.view === view)));
  el.querySelectorAll<HTMLButtonElement>('[data-pf]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.pf === plotFilter)));
  const dot = el.querySelector<HTMLElement>('.mt-dot');
  if (dot) dot.hidden = plotFilter === 'tous' && showPois && !multi;
}
mapTools.onAdd = () => {
  const el = L.DomUtil.create('div', 'maptools2');
  el.innerHTML = `<div class="mt-seg" role="radiogroup" aria-label="Vue de la carte">${VIEWS.map(([v, l]) => `<button type="button" role="radio" data-view="${v}" aria-checked="${v === view}">${l}</button>`).join('')}</div>
    <div class="mt-filter"><button type="button" id="mt-fbtn" class="mt-fbtn" aria-expanded="false" aria-controls="mt-pop">Filtres<i class="mt-dot" hidden></i></button>
      <div class="mt-pop" id="mt-pop" hidden>
        <div class="mt-title">Terrains libres</div>
        <div class="mt-seg sm" role="radiogroup" aria-label="Terrains libres">${FILTERS_FREE.map(([v, l]) => `<button type="button" role="radio" data-pf="${v}" aria-checked="${v === plotFilter}">${l}</button>`).join('')}</div>
        <label title="Stations, écoles, parcs, hôpital, mairie"><input type="checkbox" id="pois" ${showPois ? 'checked' : ''}/> Équipements</label>
        <label title="Ou Maj+clic sur la carte"><input type="checkbox" id="multi" ${multi ? 'checked' : ''}/> Sélection multiple</label>
      </div></div>`;
  L.DomEvent.disableClickPropagation(el);
  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  el.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => (b.onclick = () => ((view = b.dataset.view as typeof view), syncToolbar(), applyView(), renderAll())));
  el.querySelectorAll<HTMLButtonElement>('[data-pf]').forEach((b) => (b.onclick = () => ((plotFilter = b.dataset.pf as typeof plotFilter), syncToolbar(), renderAll())));
  const pop = q<HTMLElement>('#mt-pop');
  const btn = q<HTMLButtonElement>('#mt-fbtn');
  const toggle = (open: boolean) => ((pop.hidden = !open), btn.setAttribute('aria-expanded', String(open)));
  btn.onclick = () => toggle(pop.hidden);
  document.addEventListener('click', (e) => !el.contains(e.target as Node) && toggle(false));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && toggle(false));
  q<HTMLInputElement>('#pois').onchange = (e) => ((showPois = (e.target as HTMLInputElement).checked), syncToolbar(), syncPois());
  q<HTMLInputElement>('#multi').onchange = (e) => ((multi = (e.target as HTMLInputElement).checked), syncToolbar());
  return el;
};

function applyView() {
  if (view === 'hauteur') {
    ensureExistingBuildings();
    drawBuildings();
    for (const b of existingBuildings) if (!b.hidden) buildingsLayer.addLayer(b.layer);
    buildingsLayer.addTo(map);
  }
  else buildingsLayer.remove();
  syncPois();
  if (view === 'zonage') zonesLayer.addTo(map);
  else zonesLayer.remove();
  updateMapLegend();
}

const areaCache = new WeakMap<object, number>();
function areaOf(p: Plot): number {
  let a = areaCache.get(p.parcel);
  if (a === undefined) {
    const proj = new LocalProjection(p.parcel.ring[0].lon, p.parcel.ring[0].lat);
    const r = p.parcel.ring.map((q) => proj.toLocal(q));
    a = Math.abs(r.reduce((s, v, i) => s + v[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * v[1], 0) / 2);
    areaCache.set(p.parcel, a);
  }
  return a;
}

let ppmRange: [number, number] = [0, 1];
function computeRange() {
  const v = state.plots.filter((p) => !p.owner).map((p) => p.askingPrice / Math.max(1, areaOf(p))).sort((a, b) => a - b);
  ppmRange = v.length ? [v[Math.floor(v.length * 0.1)], v[Math.floor(v.length * 0.9)]] : [0, 1];
}

/** Ce qui se construit ou a été construit sur un terrain, pour l'infobulle. */
function buildingNote(p: Plot): string {
  if (!p.owner && (p.speculation ?? 1) > 1.02) return `<br>↑ prix en hausse +${Math.round(((p.speculation ?? 1) - 1) * 100)} % (propriétaire spéculateur)`;
  const nameOf = (id: string) => esc(state.players.find((x) => x.id === id)?.name ?? id);
  const run = p.projectId ? state.projects.find((r) => r.id === p.projectId) : undefined;
  if (run) return `<br><b>${esc(run.id)}</b> · ${nameOf(run.owner)} · ${PHASE_LABEL[run.phase].toLowerCase()} · ${Math.round(run.height)} m, ${Math.round(run.sdp)} m²`;
  const b = p.built?.[p.built.length - 1];
  return b ? `<br>Livré par ${nameOf(b.owner)} · ${Math.round(b.height)} m, ${Math.round(b.sdp)} m²` : '';
}

const styleSig = new WeakMap<L.Polygon, string>();
function plotTooltip(id: string): string {
  const p = plotById(id);
  if (!p) return '';
  return `${esc(p.label ?? p.id)}${p.zones.length ? ` · ${esc(ruleOf(p)!.label)}` : ''}<br>${eur(p.askingPrice)} · situation ×${p.locationFactor.toFixed(2).replace('.', ',')}${p.existingHeight ? ` · bâti ${Math.round(p.existingHeight)} m` : ''}${p.owner ? ` · ${esc(state.players.find((x) => x.id === p.owner)?.name ?? '')}` : p.municipal ? ' · terrain communal (appel d’offres)' : ''}${buildingNote(p)}`;
}

function drawPlots() {
  computeRange();
  drawBuildings();
  drawZacs();
  const ids = new Set(state.plots.map((p) => p.id));
  for (const [id, layer] of layers) if (!ids.has(id)) (layer.remove(), layers.delete(id));
  for (const p of state.plots) {
    let layer = layers.get(p.id);
    if (!layer) {
      layer = L.polygon(p.parcel.ring.map((q) => [q.lat, q.lon] as [number, number]), {}).addTo(map);
      const id = p.id;
      layer.on('click', (e: L.LeafletMouseEvent) => {
        const add = multi || e.originalEvent.shiftKey || e.originalEvent.ctrlKey || e.originalEvent.metaKey;
        if (add) selected.has(id) ? selected.delete(id) : selected.add(id);
        else selected = new Set([id]);
        tab = 'terrain';
        renderAll();
      });
      // Infobulle construite à l'affichage (et non à chaque redessin) : des milliers de parcelles sur une commune entière.
      layer.bindTooltip(() => plotTooltip(id), { sticky: true });
      layers.set(p.id, layer);
    }
    const style = plotStyle(p);
    const sig = JSON.stringify(style);
    if (styleSig.get(layer) !== sig) {
      layer.setStyle(style);
      styleSig.set(layer, sig);
    }
  }
}

function drawOverlay(project: ReturnType<typeof computeProject> | null) {
  overlay.clearLayers();
  if (!project || !project.footprint) return;
  const proj = new LocalProjection(project.origin.lon, project.origin.lat);
  const ring = project.footprint.map((v) => proj.toLonLat(v)).map((q) => [q.lat, q.lon] as [number, number]);
  L.polygon(ring, { color: '#d9480f', weight: 2, fillColor: '#f08c00', fillOpacity: 0.75, interactive: false }).addTo(overlay);
  if (project.rearFootprint) {
    const rear = project.rearFootprint.map((v) => proj.toLonLat(v)).map((q) => [q.lat, q.lon] as [number, number]);
    L.polygon(rear, { color: '#d9480f', weight: 2, dashArray: '5 3', fillColor: '#f6b04d', fillOpacity: 0.7, interactive: false }).addTo(overlay);
  }
  for (const extra of project.extraFootprints) {
    L.polygon(extra.map((v) => proj.toLonLat(v)).map((q) => [q.lat, q.lon] as [number, number]), { color: '#d9480f', weight: 2, dashArray: '5 3', fillColor: '#f6b04d', fillOpacity: 0.7, interactive: false }).addTo(overlay);
  }
  if (project.parkingAccess) {
    /* l'accès du parking est détaillé dans le moteur ; la carte ne montre que l'emprise du bâtiment */
  }
}

// ---------------------------------------------------------------- fenêtres : société et mode d'emploi

let modalDismissable = true;
function openModal(html: string, mount: (root: HTMLElement) => void, dismissable = true) {
  const m = $('modal');
  modalDismissable = dismissable;
  m.innerHTML = `<div class="sheet">${html}</div>`;
  m.hidden = false;
  mount(m);
  // Focus sans défilement : sinon une fenêtre longue s'ouvre en bas, sur son bouton « Fermer ».
  const first = m.querySelector<HTMLElement>('input, button.primary');
  first?.focus({ preventScroll: true });
  m.querySelector<HTMLElement>('.sheet')?.scrollTo(0, 0);
}
function closeModal() {
  $('modal').hidden = true;
  $('modal').innerHTML = '';
}
const closeMenu = () => document.querySelector('.menu')?.removeAttribute('open');
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('modal').hidden && modalDismissable) closeModal();
});
$('modal').addEventListener('mousedown', (e) => {
  if (e.target === $('modal') && modalDismissable) closeModal();
});

const mono = (name: string, color: string, small = false) => `<span class="mono${small ? ' sm' : ''}" style="background:${color}">${esc(monogram(name))}</span>`;

/** Création de la société (nouvelle partie) ou modification de son identité en cours de partie. */
function openIdentity(mode: 'new' | 'edit') {
  const current: Identity =
    mode === 'edit' ? { name: me().name, slogan: me().slogan ?? '', color: me().color ?? PALETTE[0] } : randomIdentity(Date.now() % 100000);
  let color = current.color;
  // Un seul mode de jeu pour l'instant (d'autres modes viendront plus tard).
  const difficulty: Difficulty = 'normal';
  const dismissable = mode === 'edit' || !$('home').hidden || saved !== null || !!localStorage_get(SAVE_KEY);
  openModal(
    `<h2 class="mh">${mode === 'edit' ? 'Ma société' : 'Votre société de promotion'}</h2>
     <p class="muted">${mode === 'edit' ? 'Le nom et la couleur apparaissent sur la carte et dans le classement.' : 'Choisissez un nom et une couleur : ils apparaissent sur la carte et dans le classement. Vous pouvez tout changer plus tard.'}</p>
     <div class="preview"><span id="pv-mono"></span><div><b id="pv-name"></b><div id="pv-slogan" class="muted"></div></div></div>
     <label class="f col">Nom de la société<input id="co-name" maxlength="28" autocomplete="off" value="${esc(current.name)}"></label>
     <label class="f col">Slogan (facultatif)<input id="co-slogan" maxlength="60" autocomplete="off" value="${esc(current.slogan)}"></label>

     <div class="f col"><span>Couleur</span><div class="swatches" role="radiogroup" aria-label="Couleur">${PALETTE.map((c) => `<button type="button" class="sw" role="radio" data-color="${c}" aria-checked="${c === color}" style="background:${c}" title="${c}"></button>`).join('')}</div></div>
     <div class="row" style="margin-top:14px"><button id="co-random" type="button" title="Un nom de société parodique tiré au hasard">Au hasard</button><span class="spacer"></span>${dismissable ? '<button id="co-cancel" type="button">Annuler</button>' : ''}<button id="co-go" type="button" class="primary">${mode === 'edit' ? 'Enregistrer' : 'Commencer'}</button></div>`,
    (root) => {
      const q = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
      const name = q<HTMLInputElement>('co-name');
      const slogan = q<HTMLInputElement>('co-slogan');
      const preview = () => {
        const n = sanitizeName(name.value, 'Ma Promotion');
        q('pv-mono').innerHTML = mono(n, color);
        q('pv-name').textContent = n;
        q('pv-slogan').textContent = sanitizeSlogan(slogan.value);
        root.querySelectorAll<HTMLElement>('.sw').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.color === color)));
      };
      name.oninput = slogan.oninput = preview;
      root.querySelectorAll<HTMLButtonElement>('.sw').forEach((b) => (b.onclick = () => ((color = b.dataset.color!), preview())));
      let k = 0;
      q('co-random').onclick = () => {
        const r = randomIdentity((Date.now() + 977 * ++k) % 1000003);
        name.value = r.name;
        slogan.value = r.slogan;
        color = r.color;
        preview();
      };
      const cancel = root.querySelector<HTMLButtonElement>('#co-cancel');
      if (cancel) cancel.onclick = closeModal;
      const go = () => {
        const id: Identity = { name: sanitizeName(name.value), slogan: sanitizeSlogan(slogan.value), color };
        if (mode === 'edit') {
          state = { ...state, players: state.players.map((p) => (p.id === ME ? { ...p, name: id.name, slogan: id.slogan, color: id.color } : p)) };
          save();
          closeModal();
          renderAll();
          return;
        }
        state = newGame(id, difficulty);
        resetNotifications();
        gameStarted = true;
        selected.clear();
        tab = 'trimestre';
        save();
        closeModal();
        hideHome();
        renderAll();
        // Annonces du départ (ouverture d'une ZAC…) : montrées après le mode d'emploi la première fois.
        pendingStart = state.log.filter((e) => e.popup && isRelevant(e, ME) && (e.player === ME || !e.player));
        if (!localStorage_get(TUTO_KEY)) openTutorial();
        else showStartPopups();
      };
      q('co-go').onclick = go;
      name.onkeydown = (e) => e.key === 'Enter' && go();
      preview();
    },
    dismissable,
  );
}

function localStorage_get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const TUTORIAL: { title: string; body: string }[] = [
  {
    title: 'Devenez le promoteur du quartier',
    body: `<p>Vous achetez des terrains, vous y construisez des immeubles et vous vendez les logements. Vous jouez <b>40 trimestres</b> (10 ans) contre trois concurrents dirigés par l’ordinateur.</p>
      <p>La partie se gagne au <b>patrimoine</b> : votre trésorerie, vos terrains et l’argent engagé dans vos chantiers.</p>
      <p class="muted">La carte est un vrai quartier de Montreuil : parcelles du cadastre, bâtiments existants et zonage d’urbanisme réels. Les prix et les coûts sont des ordres de grandeur.</p>`,
  },
  {
    title: 'Remporter un terrain',
    body: `<p>Cliquez sur une parcelle : vous voyez son <b>prix</b>, sa <b>zone</b> d’urbanisme et le bâti existant (à démolir avant de construire). On n’achète pas au prix affiché : on <b>fait une offre</b>.</p>
      <p><b>Terrains en vente</b> (contour doré, onglet « Marché ») : les offres restent ouvertes deux trimestres, sous pli fermé. <b>Le plus offrant l’emporte</b> et les autres sont remboursés.</p>
      <p><b>Autres terrains</b> : vous pouvez prospecter le propriétaire. Il répond à la fin du trimestre, n’accepte que s’il est satisfait du prix, et les frais de prospection sont perdus. Si deux promoteurs se positionnent, le plus offrant gagne.</p>
      <p>Sélectionnez plusieurs terrains pour déposer <b>des offres groupées</b>. Méfiez-vous des terrains dont le <b>prix grimpe</b> plus vite que le marché : leur propriétaire <b>spécule</b>, ne les mettra pas en vente et refusera une offre ordinaire.</p>
      <p>Le promoteur occupe le terrain au mieux : quand le PLU le permet et qu’il y a la place, le projet comprend <b>plusieurs bâtiments</b> (un sur rue, d’autres au fond ou à côté, séparés par un recul et desservis par une allée ou un porche). Vous pouvez décocher « plusieurs bâtiments si possible » pour n’en garder qu’un.</p>
      <p>Dans <b>« Répartition des logements »</b>, choisissez la part de T1 à T5. Le panneau montre ce que la commune achète vraiment (ventes réelles) : un programme trop éloigné de la demande se vend plus lentement, et les petits logements se vendent plus cher au m².</p>
      <p class="muted">Votre offre bloque l’argent (prix et frais de notaire) jusqu’au verdict. Les concurrents enchérissent aussi.</p>`,
  },
  {
    title: 'Les appels d’offres de la commune',
    body: `<p>La commune garde quelques terrains (en <b>turquoise</b> sur la carte) et les cède par <b>appel d’offres</b>, dans l’onglet <b>Commune</b>. Elle choisit le <b>meilleur projet</b>, pas le plus offrant.</p>
      <p>Chaque appel annonce un <b>cahier des charges</b> (logements sociaux, hauteur, commerces, qualité, délai) et la <b>pondération</b> des critères : à vous de doser prix, mixité sociale, qualité et délai. Votre note s’affiche en direct.</p>
      <p>En échange, le <b>cadre de l’opération</b> apporte des avantages : en <b>ZAC</b>, terrain à prix réduit, pas de taxe d’aménagement et un étage de plus ; en <b>PUP</b>, permis instruit en 3 mois et taxe réduite ; en <b>quartier prioritaire</b>, TVA à 5,5 % donc des logements plus chers.</p>
      <p>Certains terrains forment une <b>ZAC</b> : un quartier de plusieurs lots, attribués l’un après l’autre, avec des <b>équipements publics</b> (école, square) financés par une participation au m² de plancher. Livrés, ils font monter le prix des logements de la ZAC : les premiers lancent, les suivants en profitent.</p>
      <p class="muted">Vos engagements sont contractuels : lancez à temps (sinon la commune reprend le terrain et garde 10 %) et livrez dans le délai promis (sinon pénalités).</p>`,
  },
  {
    title: 'Les règles d’urbanisme',
    body: `<p>Chaque zone fixe des limites : <b>hauteur maximale</b> (R+x : rez-de-chaussée plus x étages), part du terrain qu’on peut bâtir (<b>emprise</b>), part qui reste en <b>pleine terre</b>, retraits et usage (logements ou bureaux).</p>
      <p>En centre-ville on construit haut (R+6) ; en zone de préservation, petit (R+2) ; en zone naturelle ou d’équipement, pas du tout. Un terrain plus constructible coûte plus cher.</p>
      <p class="muted">Menu « Carte » sur la carte → « Règles d’urbanisme » pour voir les zones.</p>`,
  },
  {
    title: 'Assembler des parcelles',
    body: `<p>Les parcelles <b>violettes en pointillés</b> sont trop petites ou enclavées pour être construites seules. Achetez-en plusieurs <b>qui se touchent</b>, sélectionnez-les avec <b>Maj+clic</b> (ou « sélection multiple »), puis cliquez sur <b>Assembler</b>.</p>
      <p>Le panneau vous dit en direct si l’assemblage est possible et, sinon, pourquoi. <b>Avant d’acheter</b>, la fiche simule le projet de l’ensemble (marge, fonds propres) sans rien engager. Un grand terrain permet un immeuble plus gros, donc de meilleures marges.</p>
      <p class="muted">Les parcelles grisées sont des <b>délaissés</b> : même assemblées, elles n’apportent presque rien.</p>`,
  },
  {
    title: 'Lancer un projet',
    body: `<p>Choisissez le nombre de niveaux ; <b>« Meilleur projet »</b> teste les options autorisées et prend la plus rentable. Trois chiffres comptent :</p>
      <ul><li><b>Marge</b> : ce que vous gagnez une fois tout vendu.</li><li><b>Fonds propres</b> : l’argent à sortir de votre poche.</li><li><b>Durée</b> en trimestres.</li></ul>
      <p>Dans « Options », choisissez l’<b>implantation</b> : le long de la rue ou en retrait au fond du terrain (en centre-ville dense, le PLU impose l’alignement sur la rue), et la forme du bâtiment. Sous le nom du terrain, les <b>règles applicables</b> et le <b>meilleur projet</b> sont résumés d’un coup d’œil.</p>
      <p class="muted">Petit projet = frais fixes (études, permis, raccordements, chantier) qui pèsent lourd : mieux vaut assembler.</p>`,
  },
  {
    title: 'Vendre les logements, financer le chantier',
    body: `<p>Dès le lancement, les logements se <b>vendent sur plan</b> au fil des trimestres, selon la demande du quartier (indiquée en haut). Les concurrents se partagent les mêmes acheteurs.</p>
      <p>Quand <b>60 % des logements</b> sont vendus (les « préventes »), la <b>banque débloque le crédit</b> et le chantier démarre. Les acquéreurs paient ensuite au fur et à mesure.</p>
      <p>Réglez le <b>prix de vente</b> de chaque opération : une remise vend plus vite, une prime ralentit. Les invendus coûtent des intérêts.</p>`,
  },
  {
    title: 'Faire passer le temps',
    body: `<p><b>Fin du trimestre</b> fait jouer les concurrents et passe au suivant. <b>▶▶</b> avance jusqu’à la prochaine étape d’une de vos opérations, ou jusqu’à un imprévu.</p>
      <p>Des aléas surviennent : recours de voisins, sol pollué, fouilles, hausse des taux, retournement du marché. Le <b>Journal</b> les raconte ; le <b>Classement</b> montre où vous en êtes.</p>`,
  },
  {
    title: 'Dettes, faillite et objectif',
    body: `<p>Votre société a des <b>frais de structure</b> chaque trimestre : ne rien faire coûte de l’argent. Si la trésorerie manque, les charges deviennent un <b>découvert</b> qui porte intérêt ; la banque ne finance plus rien tant qu’il n’est pas remboursé.</p>
      <p>Si votre <b>patrimoine devient négatif</b>, c’est la <b>faillite</b> : la banque saisit vos terrains et arrête vos chantiers, la partie est perdue.</p>
      <p>Chaque difficulté fixe un <b>objectif</b> : finir à un multiple de votre mise de départ (suivi en haut de l’écran). Facile ×1,4, normal ×1,7, difficile ×2,2.</p>`,
  },
  {
    title: 'Lexique',
    body: `<dl class="lex">
      <dt>R+x</dt><dd>Rez-de-chaussée plus x étages.</dd>
      <dt>SDP / SHAB</dt><dd>Surface de plancher construite / surface habitable vendue.</dd>
      <dt>Emprise</dt><dd>Part du terrain occupée par le bâtiment.</dd>
      <dt>Pleine terre</dt><dd>Part du terrain laissée en sol naturel, non bâti.</dd>
      <dt>Préventes</dt><dd>Logements vendus sur plan, avant la construction.</dd>
      <dt>Fonds propres</dt><dd>Argent que vous mettez vous-même ; la banque prête le reste.</dd>
      <dt>Charge foncière</dt><dd>Ce que le projet peut payer pour le terrain.</dd>
    </dl>`,
  },
];

function openTutorial(step = 0) {
  const last = TUTORIAL.length - 1;
  const t = TUTORIAL[step];
  openModal(
    `<div class="muted" style="font-size:12px">${step + 1} / ${TUTORIAL.length}</div>
     <h2 class="mh">${t.title}</h2>
     <div class="tuto">${t.body}</div>
     <div class="dots">${TUTORIAL.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</div>
     <div class="row" style="margin-top:14px"><button id="tu-skip" type="button">${step === last ? 'Fermer' : 'Passer'}</button><span class="spacer"></span>${step > 0 ? '<button id="tu-prev" type="button">Précédent</button>' : ''}<button id="tu-next" type="button" class="primary">${step === last ? 'C’est parti' : 'Suivant'}</button></div>`,
    (root) => {
      const done = () => {
        try {
          localStorage.setItem(TUTO_KEY, '1');
        } catch {
          /* stockage indisponible : le mode d'emploi se proposera de nouveau */
        }
        closeModal();
        showStartPopups();
      };
      root.querySelector<HTMLButtonElement>('#tu-skip')!.onclick = done;
      root.querySelector<HTMLButtonElement>('#tu-next')!.onclick = () => (step === last ? done() : openTutorial(step + 1));
      const prev = root.querySelector<HTMLButtonElement>('#tu-prev');
      if (prev) prev.onclick = () => openTutorial(step - 1);
    },
  );
}

/** Liste « premiers pas » : se coche toute seule d'après ce qui est arrivé dans la partie. */
function firstSteps(): string {
  const did = (re: RegExp) => state.log.some((e) => e.player === ME && re.test(e.text));
  const steps: [boolean, string][] = [
    [did(/remporte|achète/), 'Remporter un terrain (offre ou prospection)'],
    [did(/lance/), 'Lancer une opération'],
    [state.round > 0, 'Terminer un trimestre'],
    [did(/solde|livre/), 'Boucler une opération et encaisser le résultat'],
  ];
  if (steps.every(([ok]) => ok)) return '';
  return `<div class="notice" style="--nc:var(--accent);margin-top:14px"><b>Premiers pas</b><ol class="steps">${steps.map(([ok, t]) => `<li class="${ok ? 'ok' : ''}">${ok ? '✓ ' : ''}${t}</li>`).join('')}</ol><button id="howto2" type="button">Voir le mode d’emploi</button></div>`;
}


/** Écran de fin de partie : verdict, classement, bilan des opérations, rejouer. */
function openEndScreen() {
  const r = currentRanking();
  const mine = r.findIndex((x) => x.player === ME);
  const best = r[0];
  const verdict = me().bankrupt ? 'Faillite' : ['Champion du quartier', 'Médaille d’argent', 'Sur le podium', 'Le quartier vous a résisté'][Math.min(mine, 3)];
  const headline = me().bankrupt
    ? 'Votre patrimoine est devenu négatif : la banque a saisi vos terrains et arrêté vos chantiers.'
    : mine === 0
      ? `Vous êtes le promoteur n°1 du quartier${r[1] ? `, ${eur(best.netWorth - r[1].netWorth)} devant ${esc(r[1].name)}` : ''}.`
      : `${esc(best.name)} remporte la partie. Vous terminez ${mine + 1}e sur ${r.length}, à ${eur(best.netWorth - r[mine].netWorth)} du premier.`;
  const st = me().stats;
  const open = state.projects.filter((p) => p.owner === ME).length;
  const stat = (k: string, v: string) => `<div class="fact"><small>${k}</small><b>${v}</b></div>`;
  openModal(
    `<div class="muted" style="font-size:12px">Fin de partie · trimestre ${state.round}/${state.config.rounds}</div>
     <h2 class="mh">${verdict}</h2>
     <p>${headline}</p>
     <div id="en-podium"></div>
     <p class="muted" style="font-size:12px">Patrimoine = trésorerie + terrains + fonds propres engagés, moins les dettes. Départ : ${eurFull(state.config.startCash)}.</p>
     <h2 class="mh" style="font-size:15px;margin-top:14px">Votre décennie</h2>
     <div class="facts">
       ${stat('Opérations soldées', String(st?.closed ?? 0))}
       ${stat('Lots vendus', String(st?.lots ?? 0))}
       ${stat('Résultat des opérations', st ? eur(st.netTotal) : '—')}
       ${stat('Meilleure opération', st ? eur(st.bestNet) : '—')}
     </div>
     ${open ? `<p class="muted" style="font-size:12px">${open} opération${open > 1 ? 's' : ''} non soldée${open > 1 ? 's' : ''} : valorisée${open > 1 ? 's' : ''} au prix de revient.</p>` : ''}
     <div class="row" style="margin-top:14px"><button id="en-map" type="button">Voir la carte</button><span class="spacer"></span><button id="en-other" type="button">Changer de société</button><button id="en-again" type="button" class="primary">Rejouer</button></div>`,
    (root) => {
      mountPodium(root.querySelector<HTMLElement>('#en-podium')!, podiumRows(r), podiumOptions(true));
      root.querySelector<HTMLButtonElement>('#en-map')!.onclick = closeModal;
      root.querySelector<HTMLButtonElement>('#en-other')!.onclick = () => (closeModal(), openIdentity('new'));
      root.querySelector<HTMLButtonElement>('#en-again')!.onclick = () => {
        state = newGame({ name: me().name, slogan: me().slogan ?? '', color: me().color ?? PALETTE[0] });
        resetNotifications();
        gameStarted = true;
        selected.clear();
        tab = 'trimestre';
        save();
        closeModal();
        renderAll();
        toast('Nouvelle partie : mêmes couleurs, nouveaux concurrents');
      };
    },
  );
}

// ---------------------------------------------------------------- installation (PWA)

/** Événement du navigateur qui permet de proposer l'installation (Chrome, Edge, Android). */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let installPrompt: InstallPrompt | null = null;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Peut-on proposer d'installer le jeu ? (pas déjà installé, pas dans la version hébergée sans fichiers) */
const canInstall = () => !NO_TILES && !isStandalone() && (installPrompt !== null || isIos());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e as InstallPrompt;
  if (!$('home').hidden) showHome();
  renderTop();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  toast('Urbasim est installé : retrouvez-le parmi vos applications');
  if (!$('home').hidden) showHome();
  renderTop();
});

/** Installe le jeu ; sur iPhone et iPad, il faut passer par le menu Partager de Safari. */
async function installApp() {
  if (installPrompt) {
    const p = installPrompt;
    installPrompt = null;
    await p.prompt();
    const choice = await p.userChoice;
    if (choice.outcome === 'dismissed') toast('Installation annulée : vous pourrez la relancer depuis l’accueil');
    renderTop();
    if (!$('home').hidden) showHome();
    return;
  }
  openModal(
    `<h2 class="mh">Installer Urbasim</h2>
     <div class="tuto"><p>Sur iPhone et iPad : touchez <b>Partager</b> (le carré avec une flèche) dans Safari, puis <b>« Sur l’écran d’accueil »</b>.</p>
     <p class="muted">Le jeu s’ouvrira alors en plein écran, comme une application, et restera utilisable même sans réseau (la carte seulement dans les zones déjà vues).</p></div>
     <div class="row" style="margin-top:12px"><span class="spacer"></span><button id="in-ok" type="button" class="primary">Compris</button></div>`,
    (root) => (root.querySelector<HTMLButtonElement>('#in-ok')!.onclick = closeModal),
  );
}

// Service worker : jeu utilisable hors ligne et installable. Pas dans la page unique hébergée (sans fichiers annexes).
if ('serviceWorker' in navigator && import.meta.env.PROD && !NO_TILES) {
  // Le chargement de la carte (await ci-dessus) peut finir après l'événement « load » : on enregistre alors tout de suite.
  const registerSW = () =>
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* service worker indisponible (navigation privée, http) : le jeu fonctionne quand même */
    });
  if (document.readyState === 'complete') void registerSW();
  else window.addEventListener('load', () => void registerSW());
}

// ---------------------------------------------------------------- écran d'accueil

function hideHome() {
  const h = $('home');
  h.hidden = true;
  h.innerHTML = '';
}

/** Écran d'accueil : reprendre la partie, en commencer une nouvelle, lire le mode d'emploi. */
const fmtMB = (bytes: number) => `${(bytes / 1048576).toFixed(bytes < 1.5e7 ? 1 : 0).replace('.', ',')} Mo`;

/** Page des cartes : on choisit une ville, on la télécharge une fois (progression), puis on y joue, même hors ligne. */
const NEW_KEY = 'urbasim-start-new';
/** Joue sur une carte : si c'est déjà la carte chargée, on passe à la création de la société ; sinon on la charge, puis on y enchaîne. */
function playOn(id: string) {
  if (id === districtId) {
    closeModal();
    openIdentity('new');
    return;
  }
  chooseDistrict(id);
  try {
    sessionStorage.setItem(NEW_KEY, '1');
  } catch {
    /* stockage indisponible : l'écran d'accueil s'ouvrira simplement sur la nouvelle carte */
  }
  location.reload();
}

/** Première étape d'une nouvelle partie : où jouer ? Villes préparées d'avance, ou n'importe quelle commune de France (bêta). */
function openPlaceChooser() {
  openModal(
    `<h2 class="mh">Où voulez-vous jouer ?</h2>
     <div class="place-choice">
       <button type="button" class="place-card" id="pc-predef"><span class="big-ico" aria-hidden="true">🏙️</span><h3>Villes prédéfinies</h3><p>${DISTRICTS.length} villes choisies pour leurs contrastes (centre dense, banlieue, littoral, campagne…). Prêtes à jouer, données vérifiées.</p></button>
       <button type="button" class="place-card" id="pc-custom"><span class="big-ico" aria-hidden="true">🔎</span><h3>Ville de votre choix <span class="beta-badge">bêta</span></h3><p>N’importe quelle commune de France, préparée à la demande (1 à 4 minutes, une seule fois). Plus expérimental.</p></button>
     </div>
     <div class="row"><button id="pc-here" type="button" class="primary">Jouer à ${esc(DISTRICTS.find((d) => d.id === districtId)?.title ?? district.name)} →</button><span class="spacer"></span><button id="pc-close" type="button">Annuler</button></div>`,
    (root) => {
      root.querySelector<HTMLButtonElement>('#pc-predef')!.onclick = () => void openMaps('predefined');
      root.querySelector<HTMLButtonElement>('#pc-custom')!.onclick = () => void openMaps('custom');
      root.querySelector<HTMLButtonElement>('#pc-here')!.onclick = () => (closeModal(), openIdentity('new'));
      root.querySelector<HTMLButtonElement>('#pc-close')!.onclick = closeModal;
    },
  );
}

/** Liste des villes (prédéfinies : téléchargées une fois, puis jouables hors ligne) ou recherche d'une commune (bêta). */
async function openMaps(view: 'predefined' | 'custom' = 'predefined') {
  const custom = view === 'custom';
  openModal(
    `<h2 class="mh">${custom ? 'Ville de votre choix <span class="beta-badge">bêta</span>' : 'Villes prédéfinies'}</h2>
     <p class="muted" style="margin-top:0">${custom ? 'Cherchez une commune : elle est préparée une seule fois (téléchargement des données publiques puis calcul), puis reste sur votre appareil.' : 'Chaque ville se télécharge une fois, puis reste sur votre appareil (jeu possible hors ligne). Chaque carte a sa propre partie enregistrée.'}</p>
     ${custom ? '<div id="maps-search" style="margin-bottom:8px"></div>' : ''}
     <div id="maps-mine" class="maps" style="margin-bottom:8px"></div>
     ${custom ? '' : '<div id="maps-body" class="maps"><p class="muted">Chargement de la liste…</p></div>'}
     <div class="row" style="margin-top:12px"><button id="mp-back" type="button">← Où jouer ?</button><span class="spacer"></span><button id="mp-close" type="button">Fermer</button></div>`,
    (root) => {
      root.querySelector<HTMLButtonElement>('#mp-close')!.onclick = closeModal;
      root.querySelector<HTMLButtonElement>('#mp-back')!.onclick = openPlaceChooser;
    },
  );
  const search = document.getElementById('maps-search');
  const mine = document.getElementById('maps-mine');
  let customs: CustomMap[] = [];
  const renderMine = async () => {
    if (!mine) return;
    customs = await listCustomMaps();
    mine.innerHTML = customs.length
      ? `<h3 style="margin:10px 0 4px">Mes cartes</h3>` +
        customs
          .map((m) => {
            const current = m.id === districtId;
            return `<div class="mapcard2${current ? ' on' : ''}"><div class="place-head"><b>${esc(m.name)}</b><i>${esc(m.createdAt)}</i></div><div class="place-facts">${[`${m.parcels.toLocaleString('fr-FR')} parcelles`, m.pricePerM2 ? `appartements ${m.pricePerM2.toLocaleString('fr-FR')} €/m²` : 'marché par défaut', m.zones > 0 ? 'PLU numérisé' : 'sans PLU numérisé', fmtMB(m.bytes)].join(' · ')}</div><div class="row">${current ? '<span class="pill" style="--pc:#3f80ca">Carte actuelle</span>' : ''}<button type="button" class="primary" data-cplay="${m.id}">Jouer ici</button><button type="button" data-cdel="${m.id}">Supprimer</button></div></div>`;
          })
          .join('')
      : '';
    mine.querySelectorAll<HTMLButtonElement>('[data-cplay]').forEach((b) => (b.onclick = () => playOn(b.dataset.cplay!)));
    mine.querySelectorAll<HTMLButtonElement>('[data-cdel]').forEach((b) => (b.onclick = async () => (await deleteCustomMap(b.dataset.cdel!), renderMine())));
  };
  if (search) mountCommuneSearch(search, () => void renderMine()); // carte libre : recherche et préparation de n'importe quelle commune
  if (custom) {
    void renderMine();
    return;
  }
  const body = document.getElementById('maps-body')!;
  let maps: MapEntry[] = [];
  try {
    maps = await listMaps();
  } catch (e) {
    body.innerHTML = `<p class="bad">Liste des cartes indisponible (${esc(e instanceof Error ? e.message : 'réseau')}).</p>`;
    return;
  }
  let have = await downloadedMaps(maps);
  const progress = new Map<string, number>();
  const render = () => {
    body.innerHTML = DISTRICTS.map((d) => {
      const m = maps.find((x) => x.id === d.id);
      const current = d.id === districtId;
      const facts = m
        ? [
            `${m.parcels.toLocaleString('fr-FR')} parcelles`,
            m.pricePerM2 ? `appartements ${m.pricePerM2.toLocaleString('fr-FR')} €/m² (${m.sales!.toLocaleString('fr-FR')} ventes)` : 'pas de ventes d’appartements : marché par défaut',
            m.zones > 0 ? 'PLU numérisé' : 'sans PLU numérisé : règles par défaut',
            fmtMB(m.bytes),
          ].join(' · ')
        : 'Non disponible dans cette version : voir le site publié';
      const p = progress.get(d.id);
      const action = current
        ? '<span class="pill" style="--pc:#3f80ca">Carte actuelle</span><button type="button" class="primary" data-play="' + d.id + '">Jouer ici</button>'
        : !m
          ? ''
          : p !== undefined
            ? `<div class="dl-bar" role="progressbar" aria-valuenow="${Math.round(p * 100)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.round(p * 100)}%"></i></div><span class="muted">Téléchargement ${Math.round(p * 100)} %</span>`
            : have.has(d.id)
              ? `<button type="button" class="primary" data-play="${d.id}">Jouer ici</button><button type="button" data-del="${d.id}" title="Libère la place sur l’appareil (la partie enregistrée est conservée)">Supprimer</button><span class="muted">✓ téléchargée</span>`
              : `<button type="button" class="primary" data-dl="${d.id}">Télécharger · ${fmtMB(m.bytes)}</button>`;
      return `<div class="mapcard2${current ? ' on' : ''}"><div class="place-head"><b>${esc(d.title)}</b><i>${esc(d.tag)}</i></div><div class="place-blurb">${esc(d.blurb)}</div><div class="place-facts">${esc(facts)}</div><div class="row" style="margin-top:8px;align-items:center">${action}</div></div>`;
    }).join('');
    body.querySelectorAll<HTMLButtonElement>('[data-play]').forEach((b) => {
      b.onclick = () => ((b.textContent = 'Chargement…'), playOn(b.dataset.play!));
    });
    body.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => {
      b.onclick = async () => {
        const m = maps.find((x) => x.id === b.dataset.del);
        if (m) await deleteMap(m);
        have = await downloadedMaps(maps);
        render();
      };
    });
    body.querySelectorAll<HTMLButtonElement>('[data-dl]').forEach((b) => {
      b.onclick = async () => {
        const m = maps.find((x) => x.id === b.dataset.dl)!;
        progress.set(m.id, 0);
        render();
        try {
          await downloadMap(m, (done) => {
            progress.set(m.id, done);
            const bar = body.querySelector<HTMLElement>(`.mapcard2:nth-child(${DISTRICTS.findIndex((d) => d.id === m.id) + 1}) .dl-bar i`);
            if (bar) bar.style.width = `${Math.round(done * 100)}%`;
          });
        } catch (e) {
          toast(`Téléchargement impossible : ${e instanceof Error ? e.message : 'réseau'}`, true);
        }
        progress.delete(m.id);
        have = await downloadedMaps(maps);
        render();
      };
    });
  };
  render();
}

let skyTimer = 0;
let newsPill: Pill | null = null;
const NEWS_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h11a2 2 0 0 1 2 2v13a1 1 0 0 0 1 1H7a2 2 0 0 1-2-2z"/><path d="M18 9h2a1 1 0 0 1 1 1v8a2 2 0 0 1-2 2"/><path d="M8.5 8.5h6M8.5 12h6M8.5 15.5h3.5"/></svg>';
function showHome() {
  closeNotif();
  const h = $('home');
  const resume = gameStarted && me();
  const worth = resume ? netWorth(state, ME) : 0;
  const diff = DIFFICULTIES[state.config.difficulty ?? 'normal'];
  const saveCard = resume
    ? `<div class="home-save">
        <div class="home-save-head"><span class="mono" style="background:${colorOf(ME)}">${esc(monogram(me().name))}</span><div><b>${esc(me().name)}</b><div class="muted">${state.over ? 'Partie terminée' : `${quarterLabel(state.round)} · trimestre ${state.round}/${state.config.rounds}`}${state.config.difficulty && state.config.difficulty !== 'normal' ? ` · ${esc(diff.label)}` : ''}</div></div></div>
        <div class="home-stats"><div><small>Patrimoine</small><b>${eur(worth)}</b></div><div><small>Classement</small><b>${ordinal(ranking(state).findIndex((x) => x.player === ME))} / ${state.players.length}</b></div><div><small>Opérations</small><b>${state.projects.filter((p) => p.owner === ME).length}</b></div></div>
        ${pbar(state.round, state.config.rounds, `${state.config.rounds - state.round} trimestres restants`)}
      </div>`
    : '';
  const placeName = DISTRICTS.find((d) => d.id === districtId)?.title ?? district.name;
  const isNew = hasNewNotes();
  h.innerHTML = `<div class="home-scene">${homeScene()}</div>
    ${pillHTML({ id: 'hm-news', icon: NEWS_ICON, label: 'Nouvelle version disponible !', title: isNew ? 'Nouvelle version disponible : voir les nouveautés' : 'Nouveautés', placement: 'corner' })}
    <div class="home-inner">
      <div class="home-brand"><div class="home-logo" aria-hidden="true">${logoSvg}</div><h1>Urbasim <span class="beta-badge" title="Version ${esc(VERSION)}">bêta</span></h1><p class="home-tag">Le Monopoly de l’immobilier réel.<br>Achetez de vrais terrains, construisez, vendez, et battez vos concurrents promoteurs.</p></div>
      ${saveCard}
      <div class="home-actions">
        ${resume ? `<button id="hm-continue" class="primary big home-cta">${state.over ? 'Voir les résultats' : 'Continuer la partie'}</button>` : ''}
        <button id="hm-new" class="${resume ? '' : 'primary '}big home-cta">${resume ? 'Nouvelle partie' : 'Jouer'}</button>
        <button id="hm-howto" class="big">Mode d’emploi</button>
        ${canInstall() ? '<button id="hm-install" class="big install">📲 Installer l’application</button>' : ''}
      </div>
      <div class="home-place"><div><small>Lieu de la partie</small><b>${esc(placeName)}</b></div><button id="hm-maps" type="button">Changer de lieu</button></div>
      <div class="home-foot">Version bêta : le jeu évolue vite, les prix et règles d’urbanisme sont des ordres de grandeur. Votre partie est enregistrée dans ce navigateur.<br>Bêta ${esc(VERSION)} · build ${esc(BUILD)} · <a href="#" id="hm-version">Nouveautés</a> · <a href="#" id="hm-credits">Crédits et données</a><br>© 2026 Paname Dev · Codé par Claude · sans pub, sans pistage · <a href="mailto:contact@panamedev.fr">contact@panamedev.fr</a></div>
    </div>`;
  h.hidden = false;
  // Le ciel suit l'heure de la journée ; on le remet à jour chaque minute tant que l'accueil est visible.
  applySky(h, currentHour());
  window.clearInterval(skyTimer);
  skyTimer = window.setInterval(() => (h.hidden ? window.clearInterval(skyTimer) : applySky(h, currentHour())), 60_000);
  newsPill?.dispose();
  newsPill = mountPill(h, { id: 'hm-news', icon: NEWS_ICON, label: 'Nouvelle version disponible !', title: 'Nouveautés', placement: 'corner', onClick: openVersion });
  newsPill.setUnread(isNew);
  if (isNew) newsPill.announce(); // l'icône se déroule pour annoncer la nouveauté, puis se replie en gardant son point
  const q = (id: string) => h.querySelector<HTMLButtonElement>(`#${id}`);
  const cont = q('hm-continue');
  if (cont)
    cont.onclick = () => {
      hideHome();
      if (state.over) openEndScreen();
      else if (!localStorage_get(TUTO_KEY) && state.round === 0 && !state.log.length) openTutorial();
    };
  q('hm-new')!.onclick = () => openPlaceChooser();
  q('hm-howto')!.onclick = () => openTutorial();
  h.querySelector<HTMLAnchorElement>('#hm-credits')!.onclick = (e) => (e.preventDefault(), openCredits());
  h.querySelector<HTMLAnchorElement>('#hm-version')!.onclick = (e) => (e.preventDefault(), openVersion());
  const inst = q('hm-install');
  if (inst) inst.onclick = installApp;
  q('hm-maps')!.onclick = () => openPlaceChooser();
  (cont ?? q('hm-new'))!.focus();
}

// ---------------------------------------------------------------- panneaux

// ---------------------------------------------------------------- classement

/** Classement au début du trimestre en cours et du précédent (pour les flèches ▲▼ et faire glisser les lignes). */
const rankMem: { round: number; start: Record<string, { pos: number; worth: number }>; prev: Record<string, { pos: number; worth: number }> | null } = { round: -1, start: {}, prev: null };

/** Classement actuel ; mémorise celui du début de chaque trimestre. */
function currentRanking() {
  const r = ranking(state);
  if (rankMem.round !== state.round) {
    rankMem.prev = rankMem.round >= 0 ? rankMem.start : null;
    rankMem.start = Object.fromEntries(r.map((x, i) => [x.player, { pos: i, worth: x.netWorth }]));
    rankMem.round = state.round;
  }
  return r;
}

const podiumRows = (r = currentRanking()): PodiumRow[] =>
  r.map((x) => ({ id: x.player, name: x.name, color: colorOf(x.player), monogram: monogram(x.name), worth: x.netWorth, me: x.player === ME, ...(x.player === ME ? {} : { tag: PROFILE_LABEL[x.player] ?? '' }), bankrupt: !!state.players.find((p) => p.id === x.player)?.bankrupt }));

const podiumOptions = (animate: boolean) => ({
  format: (n: number) => eur(n),
  reduceMotion: reducedMotion || !animate,
  ...(animate && rankMem.prev ? { prevPos: Object.fromEntries(Object.entries(rankMem.prev).map(([k, v]) => [k, v.pos])), prevWorth: Object.fromEntries(Object.entries(rankMem.prev).map(([k, v]) => [k, v.worth])) } : {}),
});

/** Phrase sous le classement : l'avance du premier ou le retard sur lui (« à égalité » sous 1 000 €). */
function rankGapText(r: { name: string; netWorth: number }[], k: number): string {
  const diff = k === 0 ? r[0].netWorth - (r[1]?.netWorth ?? 0) : r[0].netWorth - r[k].netWorth;
  if (diff < 1000) return k === 0 ? `Vous êtes à égalité avec ${esc(r[1]?.name ?? 'les autres')}.` : `Vous êtes à égalité avec ${esc(r[0].name)}.`;
  return k === 0 ? `Vous êtes en tête, avec ${eur(diff)} d’avance.` : `Il vous manque ${eur(diff)} pour passer devant ${esc(r[0].name)}.`;
}

const ordinal = (k: number) => (k === 0 ? '1<span class="sup">er</span>' : `${k + 1}<span class="sup">e</span>`);

/** Place du joueur dans l'en-tête : « 2e / 4 », un clic ouvre le classement. */
function rankStat(): string {
  const r = currentRanking();
  const k = r.findIndex((x) => x.player === ME);
  const leader = r[0];
  const gap = k === 0 ? `Vous menez de ${eur(r[0].netWorth - (r[1]?.netWorth ?? 0))} sur ${r[1]?.name ?? 'les autres'}` : `${eur(leader.netWorth - r[k].netWorth)} derrière ${leader.name}`;
  return `<div class="stat rank-stat" id="stat-rank" role="button" tabindex="0" title="${esc(gap)} · cliquez pour voir le classement"><small>Classement</small><b class="${k === 0 ? 'good' : ''}">${ordinal(k)} <span class="muted">/ ${r.length}</span></b></div>`;
}

/** Le classement des sociétés, à la verticale : bilan annuel (automatique) ou consultation à la demande. */
function openRanking(auto = false) {
  const r = currentRanking();
  const k = r.findIndex((x) => x.player === ME);
  const year = 2027 + Math.floor(state.round / 4);
  const gap = rankGapText(r, k);
  openModal(
    `<div class="muted" style="font-size:12px">${auto ? `Bilan de l’année ${year - 1}` : `${quarterLabel(state.round)} · trimestre ${state.round}/${state.config.rounds}`}</div>
     <h2 class="mh">Classement</h2>
     <div id="rk-podium"></div>
     <p class="rank-gap">${gap}</p>
     <p class="muted" style="font-size:12px;text-align:center;margin:4px 0 0">Patrimoine = trésorerie + terrains + fonds propres engagés, moins les dettes. Départ : ${eurFull(state.config.startCash)}.</p>
     <div class="row" style="margin-top:12px"><span class="spacer"></span><button id="rk-ok" type="button" class="primary">${auto ? 'Continuer' : 'Fermer'}</button></div>`,
    (root) => {
      mountPodium(root.querySelector<HTMLElement>('#rk-podium')!, podiumRows(r), podiumOptions(true));
      const ok = root.querySelector<HTMLButtonElement>('#rk-ok')!;
      ok.onclick = closeModal;
      ok.focus();
    },
  );
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const prevStat: Record<string, number> = {};

/** Fait défiler un montant de son ancienne à sa nouvelle valeur, avec un éclair vert (gain) ou rouge (perte). */
function tweenStat(key: string, el: HTMLElement | null, value: number) {
  const from = prevStat[key];
  prevStat[key] = value;
  if (!el || from === undefined || Math.round(from) === Math.round(value) || reducedMotion) return;
  el.classList.add(value > from ? 'flash-up' : 'flash-down');
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / 700);
    el.textContent = eur(from + (value - from) * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(step);
    else el.classList.remove('flash-up', 'flash-down');
  };
  requestAnimationFrame(step);
}

/** Petite pulsation d'un élément (changement de trimestre). */
function pulse(el: HTMLElement | null) {
  if (!el || reducedMotion) return;
  el.classList.remove('pulse');
  void el.offsetWidth;
  el.classList.add('pulse');
}

function renderTop() {
  const w = netWorth(state, ME);
  $('top').innerHTML = `
    <h1><span class="brand-logo" aria-hidden="true">${logoSvg}</span>Urbasim <button id="ver" class="ver${hasNewNotes() ? ' new' : ''}" type="button" title="Version et nouveautés">bêta ${esc(VERSION)} · #${esc(BUILD)}</button></h1>
    <div class="company" title="${esc(me().slogan ?? '')}"><span class="mono" style="background:${colorOf(ME)}">${esc(monogram(me().name))}</span><span class="cname">${esc(me().name)}</span></div>
    <div class="stats">
    <div class="stat" id="stat-round" title="Avancement de la partie"><small>Trimestre</small><b>${quarterLabel(state.round)} <span class="muted">${state.round}/${state.config.rounds}</span></b><span class="goalbar"><i style="width:${Math.min(100, (state.round / state.config.rounds) * 100)}%"></i></span></div>
    <div class="stat"><small>Trésorerie</small><b id="stat-cash">${eur(me().cash)}</b></div>
    <div class="stat" title="Trésorerie + terrains (au prix de reprise) + fonds propres engagés dans les opérations, moins les dettes"><small>Patrimoine</small><b id="stat-worth">${eur(w)}</b></div>
    ${rankStat()}
    ${me().bankrupt ? '<div class="stat"><small>Situation</small><b class="bad">FAILLITE</b></div>' : me().debt > 0 ? `<div class="stat" title="Charges impayées : elles portent intérêt et la banque ne finance plus rien tant qu'elles ne sont pas remboursées"><small>Découvert</small><b class="bad">−${eur(me().debt)}</b></div>` : ''}
    <div class="stat" title="Indice des prix de vente (100 = prix de départ) · taux du crédit promoteur · logements que les ménages achètent par trimestre dans le quartier, et logements en vente en ce moment (tous promoteurs)">
      <small>Marché</small><b><span class="${state.marketIndex >= 1 ? 'good' : 'bad'}">prix ${(state.marketIndex * 100).toFixed(0)}</span> · ${pct(state.interestRate)} · ${marketDemand(state).toFixed(0)}<span class="muted">/trim.</span> <span class="muted">(${unitsOnOffer(state)} en vente)</span></b>
    </div>
    </div>
    <span class="spacer"></span>
    <button id="end" class="primary${!state.over && !me().ready && quarterPlan().todo === 0 ? ' ready' : ''}" title="${state.over ? '' : quarterPlan().todo === 0 ? 'Vous avez fait le tour : vous pouvez passer au trimestre suivant.' : `Il reste ${quarterPlan().todo} chose${quarterPlan().todo > 1 ? 's' : ''} à voir avant de passer (facultatif).`}">${state.over ? 'Résultats' : me().ready ? 'En attente…' : 'Fin du trimestre ▶'}</button>
    <button id="ff" ${state.over ? 'disabled' : ''} title="Avance jusqu'à la prochaine étape d'une de vos opérations ou jusqu'à un aléa (8 trimestres au plus)">▶▶</button>
    <button id="bell" class="bell" title="Notifications et échéances" aria-label="Notifications">🔔${unreadCount() ? `<span class="badge hot">${unreadCount()}</span>` : urgentWatch() ? '<span class="badge hot">!</span>' : ''}</button>
    <details class="menu"><summary title="Menu">⋯</summary><div><div class="muted" style="margin-bottom:6px">${esc(district.name)}</div><div class="menulist"><button id="home-btn">Écran d’accueil</button>${canInstall() ? '<button id="install-btn">Installer l’application</button>' : ''}<button id="howto">Mode d’emploi</button><button id="version-btn">Version ${esc(VERSION)} · build ${esc(BUILD)}</button><button id="credits-btn">Crédits et données</button><button id="company">Ma société</button><button id="new">Nouvelle partie</button></div></div></details>`;
  tweenStat('cash', document.getElementById('stat-cash'), me().cash);
  tweenStat('worth', document.getElementById('stat-worth'), w);
  if (prevStat.round !== undefined && prevStat.round !== state.round) pulse(document.getElementById('stat-round'));
  prevStat.round = state.round;
  $('end').onclick = () => (state.over ? openEndScreen() : endTurn());
  $('ff').onclick = fastForward;
  $('bell').onclick = openNotif;
  $('ver').onclick = openVersion;
  const rs = document.getElementById('stat-rank');
  if (rs) {
    rs.onclick = () => openRanking();
    rs.onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openRanking());
  }
  $('home-btn').onclick = () => (closeMenu(), showHome());
  const ib = document.getElementById('install-btn');
  if (ib) ib.onclick = () => (closeMenu(), installApp());
  $('howto').onclick = () => (closeMenu(), openTutorial());
  $('credits-btn').onclick = () => (closeMenu(), openCredits());
  $('version-btn').onclick = () => (closeMenu(), openVersion());
  $('company').onclick = () => (closeMenu(), openIdentity('edit'));
  const nb = $('new');
  nb.onclick = () => {
    // Confirmation dans la page : les boîtes de dialogue du navigateur sont bloquées dans certains environnements.
    if (nb.dataset.armed !== '1') {
      nb.dataset.armed = '1';
      nb.textContent = 'Confirmer l’abandon ?';
      setTimeout(() => {
        nb.dataset.armed = '0';
        nb.textContent = 'Nouvelle partie';
      }, 4000);
      return;
    }
    closeMenu();
    openIdentity('new');
  };
}

// ---------------------------------------------------------------- fil du trimestre

interface QuarterTask {
  id: string;
  icon: string;
  title: string;
  detail: string;
  /** « todo » = à faire avant de passer, « info » = possible mais facultatif, « done » = rien à faire. */
  status: 'todo' | 'info' | 'done';
  action?: { label: string; go: () => void };
}

/** Ce que le joueur peut ou doit faire pendant ce trimestre, d'après l'état du jeu. */
function quarterPlan(): { tasks: QuarterTask[]; todo: number; urgent: ReturnType<typeof watchList>; offers: number; holds: number; ops: number } {
  const urgent = watchList(state, ME).filter((w) => w.tone === 'bad' || w.tone === 'warn');
  const offers = state.offers.filter((o) => o.player === ME);
  const holds = state.plots.filter((p) => p.owner === ME && !p.projectId);
  const ops = state.projects.filter((r) => r.owner === ME);
  const listed = state.plots.filter((p) => p.owner === null && isListed(p));
  const tenders = openTenders(state).filter((t) => !tenderBidOf(t, ME));
  const tasks: QuarterTask[] = [];
  if (holds.length)
    tasks.push({ id: 'launch', icon: '🏗️', title: `${holds.length} terrain${holds.length > 1 ? 's' : ''} à vous sans projet`, detail: `Chaque trimestre vous coûte du portage (${eur(holds.reduce((t, p) => t + p.paid * state.config.holdingCostRate, 0))}). Lancez l’opération, ou revendez.`, status: 'todo', action: { label: 'Lancer', go: () => gotoRef({ plot: holds[0].id }) } });
  if (tenders.length)
    tasks.push({ id: 'tender', icon: '📣', title: `${tenders.length} appel${tenders.length > 1 ? 's' : ''} d’offres de la commune`, detail: tenders.some((t) => t.closesAt - 1 === state.round) ? 'Dernier trimestre pour répondre à l’un d’eux : après, la commune attribue le terrain.' : 'La commune attribue des terrains à prix réduit contre des engagements : vous avez encore du temps.', status: tenders.some((t) => t.closesAt - 1 === state.round) ? 'todo' : 'info', action: { label: 'Voir', go: () => ((tab = 'commune'), renderAll()) } });
  if (state.config.landMarket === 'auction')
    tasks.push({
      id: 'market',
      icon: '🏷️',
      title: listed.length ? `${listed.length} terrain${listed.length > 1 ? 's' : ''} en vente ce trimestre` : 'Aucun terrain mis en vente ce trimestre',
      detail: offers.length ? `Vous avez ${offers.length} offre${offers.length > 1 ? 's' : ''} en cours : réponse à la fin du trimestre.` : listed.length ? 'Faites une offre : le plus offrant l’emporte à la fin du trimestre.' : 'Vous pouvez quand même prospecter un propriétaire directement sur la carte.',
      status: offers.length ? 'done' : 'info',
      ...(listed.length ? { action: { label: 'Voir', go: () => ((tab = 'marche'), renderAll()) } } : {}),
    });
  if (ops.length)
    tasks.push({ id: 'ops', icon: '🏢', title: `${ops.length} opération${ops.length > 1 ? 's' : ''} en cours`, detail: ops.map((r) => `${r.id} : ${PHASE_LABEL[r.phase].toLowerCase()}`).slice(0, 3).join(' · ') + (ops.length > 3 ? '…' : '') + '. Elles avancent toutes seules.', status: 'done', action: { label: 'Suivre', go: () => ((tab = 'operations'), renderAll()) } });
  if (!ops.length && !holds.length && !offers.length)
    tasks.push({ id: 'explore', icon: '🗺️', title: 'Rien en cours', detail: 'Cliquez sur un terrain de la carte : son verdict dit s’il est rentable. Sans achat, ce trimestre passera pour rien.', status: 'info' });
  const todo = tasks.filter((t) => t.status === 'todo').length + urgent.filter((w) => !/^(launch|delivery|presales)/.test(w.id)).length;
  return { tasks, todo, urgent, offers: offers.length, holds: holds.length, ops: ops.length };
}

/** Onglet « Trimestre » : ce qu'on peut faire pendant son tour, ce qui se passe quand on passe, et quand il est temps de passer. */
function renderQuarter(): string {
  drawOverlay(null);
  const q = quarterPlan();
  const left = state.config.rounds - state.round;
  const r = currentRanking();
  const k = r.findIndex((x) => x.player === ME);
  const status = me().ready
    ? { cls: 'wait', text: 'En attente des concurrents…' }
    : q.todo > 0
      ? { cls: 'todo', text: `Il vous reste ${q.todo} chose${q.todo > 1 ? 's' : ''} à voir avant de passer.` }
      : { cls: 'go', text: 'Vous avez fait le tour : vous pouvez passer au trimestre suivant.' };
  const ghost = [
    q.offers ? `vos ${q.offers} offre${q.offers > 1 ? 's' : ''} sont départagées` : '',
    q.ops ? `vos ${q.ops} opération${q.ops > 1 ? 's' : ''} avancent d’une étape` : '',
    q.holds ? `le portage de vos terrains vous est facturé` : '',
    'les concurrents jouent leur tour',
    'les prix et les taux du marché évoluent',
  ].filter(Boolean);
  const icon = { todo: '●', info: '○', done: '✓' };
  return `<div class="qhead"><h2>${quarterLabel(state.round)}</h2><span class="muted">trimestre ${state.round + 1}/${state.config.rounds} · ${left} restant${left > 1 ? 's' : ''} · vous êtes ${ordinal(k)}/${r.length}</span></div>
    <div class="qstatus ${status.cls}">${status.text}</div>
    ${q.urgent.length ? `<h3 class="qh">À ne pas rater</h3>${renderWatch(q.urgent)}` : ''}
    <h3 class="qh">Pendant ce trimestre vous pouvez…</h3>
    <ul class="qtasks">${q.tasks
      .map((t) => `<li class="qt ${t.status}"><span class="qi" aria-hidden="true">${t.icon}</span><div class="qb"><b>${t.title}</b><div class="muted">${t.detail}</div></div><span class="qs" title="${t.status === 'todo' ? 'À faire' : t.status === 'done' ? 'Rien à faire' : 'Facultatif'}">${icon[t.status]}</span>${t.action ? `<button type="button" data-qgo="${t.id}">${t.action.label}</button>` : ''}</li>`)
      .join('')}</ul>
    <h3 class="qh">Quand vous passez au trimestre suivant…</h3>
    <ul class="qnext">${ghost.map((g) => `<li>${g}</li>`).join('')}</ul>
    <div class="row"><button type="button" id="q-next" class="primary big" ${state.over || me().ready ? 'disabled' : ''}>Fin du trimestre ▶</button></div>
    <p class="muted" style="font-size:12px">Vous n’avez rien d’obligatoire à faire : le trimestre peut passer à tout moment. Les points « à faire » sont ceux qui vous coûtent de l’argent ou une occasion si vous les laissez.</p>`;
}

function tabs(): string {
  const nOps = state.projects.filter((p) => p.owner === ME).length;
  const nListed = state.plots.filter((p) => p.owner === null && isListed(p)).length;
  const t = (id: typeof tab, label: string) => `<button data-tab="${id}" class="${tab === id ? 'on' : ''}">${label}</button>`;
  const market = state.config.landMarket === 'auction' ? t('marche', `Marché${nListed ? ` <span class="badge">${nListed}</span>` : ''}`) : '';
  const nTenders = openTenders(state).length;
  const commune = state.config.communeTenders ? t('commune', `Commune${nTenders ? ` <span class="badge">${nTenders}</span>` : ''}`) : '';
  const nTodo = quarterPlan().todo;
  return `<div class="tabs">${t('trimestre', `Trimestre${nTodo ? ` <span class="badge">${nTodo}</span>` : ''}`)}${t('terrain', 'Terrain')}${market}${commune}${t('operations', `Opérations${nOps ? ` <span class="badge">${nOps}</span>` : ''}`)}${t('journal', 'Journal')}${t('classement', 'Classement')}</div>`;
}

let lastPaneKey = '';
function renderSide() {
  let body = '';
  if (tab === 'trimestre') body = renderQuarter();
  else if (tab === 'terrain') body = renderSelection();
  else if (tab === 'marche') body = renderMarche();
  else if (tab === 'commune') body = renderCommune();
  else if (tab === 'operations') body = renderOperations();
  else if (tab === 'journal') body = renderJournal();
  else body = renderRanking();
  const key = `${tab}|${[...selected].join(',')}|${state.round}`;
  const changed = key !== lastPaneKey;
  lastPaneKey = key;
  $('side').innerHTML = tabs() + `<div class="pane${changed ? ' enter' : ''}">${body}</div>`;
  $('side').querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => (b.onclick = () => ((tab = b.dataset.tab as typeof tab), renderAll())));
  bindSelection();
  $('side').querySelectorAll<HTMLButtonElement>('[data-qgo]').forEach((b) => (b.onclick = () => quarterPlan().tasks.find((t) => t.id === b.dataset.qgo)?.action?.go()));
  const qn = document.getElementById('q-next');
  if (qn) qn.onclick = () => endTurn();
  const tp = document.getElementById('tab-podium');
  if (tp) mountPodium(tp, podiumRows(), podiumOptions(changed));
  if (tab === 'commune') bindTenders();
  bindRefs($('side'));
}

/** Sections repliables : l'essentiel est visible, le détail se déplie. */
const fold = (title: string, body: string, open = false) => `<details class="fold" ${open ? 'open' : ''}><summary>${title}</summary><div class="foldbody">${body}</div></details>`;
const pill = (text: string, color: string) => `<span class="pill" style="--pc:${color}">${text}</span>`;
const shortLabel = (p: Plot) => (p.label ?? p.id).replace(' · Montreuil', '');

function renderSelection(): string {
  const ids = [...selected].filter((id) => plotById(id));
  if (ids.length === 0) {
    drawOverlay(null);
    return `<div class="empty"><b>Choisissez un terrain</b>
      <p class="muted">Cliquez sur une parcelle de la carte pour voir son prix, les règles d’urbanisme et ce qu’on peut y construire.</p>
      <p class="muted">Pour assembler plusieurs parcelles voisines : achetez-les, sélectionnez-les avec Maj+clic, puis « Assembler ».</p>
      <p class="muted">Les parcelles violettes en pointillés sont trop petites ou enclavées pour être construites seules.</p>${firstSteps()}</div>`;
  }
  const plots = ids.map((id) => plotById(id)!);
  if (plots.length > 1) return renderMulti(plots);
  return renderSingle(plots[0]);
}

/** Identifiant du terrain virtuel de la simulation (jamais présent dans la partie). */
const SIM_ID = 'simulation';
/** Terrain virtuel de la simulation en cours : l'assemblage des parcelles sélectionnées, achetées ou non. */
let simPlot: Plot | null = null;

/**
 * Terrain virtuel issu de l'assemblage de parcelles, pour simuler un projet avant d'acheter. Son prix est celui des parcelles
 * libres (prix affiché) plus ce que j'ai payé pour les miennes.
 */
function virtualPlot(plots: Plot[]): Plot | string {
  if (plots.some((p) => p.municipal || p.obligation)) return 'une parcelle communale ne s’assemble pas : elle se remporte par appel d’offres.';
  if (plots.some((p) => p.projectId)) return 'une opération est déjà en cours sur l’une de ces parcelles.';
  const m = mergeParcels(plots.map((p) => p.parcel));
  if (!m.ok) return m.error;
  const big = plots.slice().sort((a, b) => areaOf(b) - areaOf(a))[0];
  const rate = state.config.bilanParams.acquisitionFeeRate;
  const totalArea = plots.reduce((s, p) => s + areaOf(p), 0);
  const land = plots.reduce((s, p) => s + (p.owner === ME ? p.paid / (1 + rate) : p.owner ? p.askingPrice : offerOf(state, p.id, ME)?.price ?? bidFor(p)), 0);
  const v: Plot = {
    ...big,
    id: SIM_ID,
    label: `Simulation · ${plots.length} parcelles`,
    parts: undefined,
    listing: undefined,
    municipal: undefined,
    obligation: undefined,
    built: undefined,
    issue: undefined,
    parcel: m.parcel,
    owner: null,
    zones: [...new Set(plots.flatMap((p) => p.zones))],
    existingSdp: plots.reduce((s, p) => s + p.existingSdp, 0),
    existingHeight: Math.max(...plots.map((p) => p.existingHeight)),
    locationFactor: plots.reduce((s, p) => s + p.locationFactor * areaOf(p), 0) / totalArea,
    area: m.area,
    askingPrice: Math.round(land),
    basePrice: Math.round(land),
    paid: 0,
    projectId: null,
  };
  const issue = plotIssue(m.parcel, state.config, v.locationFactor, ruleOf(v));
  if (issue) v.issue = issue;
  areaCache.set(m.parcel, m.area);
  return v;
}

/** Parcelles voisines (qui touchent la sélection) qu'on pourrait ajouter pour un projet plus grand. */
function neighboursOf(plots: Plot[], max = 6): Plot[] {
  const ids = new Set(plots.map((p) => p.id));
  const mid = (p: Plot) => ({ lat: p.parcel.ring.reduce((t, q) => t + q.lat, 0) / p.parcel.ring.length, lon: p.parcel.ring.reduce((t, q) => t + q.lon, 0) / p.parcel.ring.length });
  const centres = plots.map(mid);
  const dist = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => Math.hypot((a.lon - b.lon) * 73000, (a.lat - b.lat) * 111000);
  return state.plots
    .filter((c) => !ids.has(c.id) && !c.municipal && !c.projectId && !c.obligation && c.issue !== 'zone' && (c.owner === null || c.owner === ME))
    .map((c) => ({ c, d: Math.min(...centres.map((m) => dist(m, mid(c)))) }))
    .filter(({ d }) => d < 110)
    .sort((a, b) => a.d - b.d)
    .slice(0, 24)
    .filter(({ c }) => plots.some((p) => mergeParcels([p.parcel, c.parcel]).ok))
    .slice(0, max)
    .map(({ c }) => c);
}

/** Ligne du plan d'acquisition : où en est chaque parcelle, ce qu'elle coûtera et ce qui peut bloquer. */
function planRow(p: Plot): { html: string; blocker: boolean } {
  const rate = state.config.bilanParams.acquisitionFeeRate;
  const other = p.owner && p.owner !== ME ? state.players.find((x) => x.id === p.owner)?.name : null;
  const rival = offersOn(state, p.id).filter((o) => o.player !== ME).length;
  const mineOffer = offerOf(state, p.id, ME);
  let status = '';
  let price = '';
  let blocker = false;
  if (p.municipal) {
    status = `<span class="bad">⚠ terrain communal</span> : il ne s’assemble pas, il se remporte par appel d’offres`;
    blocker = true;
  } else if (p.projectId || p.obligation) {
    status = '<span class="bad">⚠ opération ou engagement en cours</span>';
    blocker = true;
  } else if (p.owner === ME) {
    status = 'à vous';
    price = `<span class="muted">payé ${eur(p.paid / (1 + rate))}</span>`;
  } else if (other) {
    status = `<span class="bad">⚠ appartient à ${esc(other)}</span> : indisponible`;
    blocker = true;
  } else {
    const bid = mineOffer?.price ?? bidFor(p);
    const chance = acceptChance(p, bid);
    status = p.listing
      ? `en vente jusqu’à la fin de ${quarterLabel(p.listing.until - 1)} · départ ${eur(p.listing.minPrice)}`
      : `prospection : ${chance === null ? '' : chance >= 0.995 ? 'acceptation quasi certaine' : chance <= 0.005 ? '<span class="bad">refus quasi certain à ce prix</span>' : `chance d’acceptation ≈ ${Math.round(chance * 100)} %`}`;
    if (p.speculator && (p.speculation ?? 1) > 1.02) status += ' · <span class="warn">↑ spécule</span>';
    if (rival) status += ` · <b>${rival} concurrent${rival > 1 ? 's' : ''}</b> sur ce terrain`;
    if (mineOffer) status += ' · <b>votre offre est déposée</b>';
    price = `<b>${eur(bid)}</b>`;
  }
  const rm = `<button class="x" data-rm="${esc(p.id)}" title="Retirer de la sélection" aria-label="Retirer">✕</button>`;
  return {
    blocker,
    html: `<tr class="${blocker ? 'blocked' : ''}"><td><a href="#" data-goto="${esc(p.id)}">${esc(shortLabel(p).replace(/ · \d+ m²$/, ''))}</a> <span class="muted">${Math.round(areaOf(p))} m²${p.issue === 'delaisse' ? ' · délaissé' : ''}</span><div class="muted" style="font-size:12px">${status}</div></td><td class="num">${price}</td><td class="num">${rm}</td></tr>`,
  };
}

function renderMulti(plots: Plot[]): string {
  simPlot = null;
  drawOverlay(null);
  const rate = state.config.bilanParams.acquisitionFeeRate;
  const area = plots.reduce((s, p) => s + areaOf(p), 0);
  const mineP = plots.filter((p) => p.owner === ME);
  const freeP = plots.filter((p) => !p.owner && !p.municipal && p.issue !== 'zone' && !p.projectId);
  const busy = plots.filter((p) => p.projectId);
  const rows = plots.map(planRow);
  const blockers = rows.filter((r) => r.blocker).length;
  const sim = virtualPlot(plots);
  const auction = state.config.landMarket === 'auction';
  // Ce qu'il faudra bloquer : offres (notaire compris) et frais de prospection des terrains libres sans offre déposée.
  const toPlace = freeP.filter((p) => !offerOf(state, p.id, ME));
  const needs = toPlace.reduce((s, p) => s + Math.round(bidFor(p) * (1 + rate)) + (p.listing ? 0 : prospectFee(state, bidFor(p))), 0);
  const fees = toPlace.reduce((s, p) => s + (p.listing ? 0 : prospectFee(state, bidFor(p))), 0);
  const chances = toPlace.map((p) => acceptChance(p, bidFor(p))).filter((c): c is number => c !== null);
  const global = chances.reduce((t, c) => t * c, 1);
  const rounds = new Set(toPlace.map((p) => (p.listing ? p.listing.until : state.round + 1)));
  const hasBundle = plots.some((p) => offerOf(state, p.id, ME)?.bundle);
  const canBundle = auction && typeof sim !== 'string' && blockers === 0 && toPlace.length >= 1 && plots.length >= 2 && rounds.size <= 1 && needs <= me().cash && plots.every((p) => p.owner === ME || (!p.owner && !offerOf(state, p.id, ME)));
  const canMerge = typeof sim !== 'string' && blockers === 0 && plots.length === mineP.length;
  const geometry = typeof sim === 'string' ? `<div class="check bad">Assemblage impossible : ${esc(sim.replace(/\.$/, ''))}.</div>` : `<div class="check good">Elles s’assemblent en un terrain de ${Math.round(sim.area)} m²${sim.parcel.streetEdges.length ? '' : ' <b>sans accès à la rue</b> (ajoutez une parcelle qui donne sur la rue)'}.</div>`;
  let why = '';
  if (!canMerge && !canBundle) {
    if (blockers) why = '<div class="check bad">Retirez les parcelles bloquées (✕) ou choisissez-en d’autres : l’ensemble ne peut pas être acquis tel quel.</div>';
    else if (rounds.size > 1) why = '<div class="check warn">Ces terrains ne sont pas tranchés au même moment (échéances de mise en vente différentes) : l’offre « tout ou rien » n’est pas possible, déposez des offres séparées ou retirez-en un.</div>';
    else if (needs > me().cash) why = `<div class="check bad">Il vous manque ${eur(needs - me().cash)} pour financer toutes les offres.</div>`;
    else if (hasBundle) why = '<div class="check good">Offre groupée déposée : réponse à la fin du trimestre. Si vous remportez tout, les parcelles sont assemblées d’office.</div>';
  }
  const budget = typeof sim === 'string' || sim.issue ? null : bestBrief(sim, false);
  const plan = `<table class="plan">${rows.map((r) => r.html).join('')}
      <tr class="total"><td>Total à bloquer${fees ? ` <span class="muted">(dont ${eur(fees)} de frais de prospection, perdus si refus)</span>` : ''}</td><td class="num"><b>${eur(needs)}</b></td><td></td></tr></table>
    ${budget ? `<div class="muted" style="font-size:12px">Prix de terrain maximal de l’ensemble pour votre marge visée (${pct(state.config.bilanParams.targetMargin)}) : <b>${eur(budget.maxLand)}</b>, pour ${eur(typeof sim === 'string' ? 0 : sim.askingPrice)} prévus.${typeof sim !== 'string' && sim.askingPrice > budget.maxLand ? ' <span class="bad">Vous payez trop cher pour ce projet.</span>' : ''}</div>` : ''}`;
  const level = auction && toPlace.length
    ? `<div class="levelbar" role="radiogroup" aria-label="Niveau d’offre"><span class="muted">Niveau d’offre</span>
        <button type="button" data-level="standard" class="${offerLevel === 'standard' ? 'on' : ''}" title="Un peu au-dessus du prix affiché (+8 %) ou du prix de départ (+5 %)">Standard</button>
        <button type="button" data-level="sur" class="${offerLevel === 'sur' ? 'on' : ''}" title="Au-dessus de ce que n’importe quel propriétaire peut exiger : acceptation certaine, mais plus cher">Sûr</button></div>
      ${chances.length ? `<div class="muted" style="font-size:12px">Chance de remporter tous les terrains en prospection ≈ <b>${Math.round(global * 100)} %</b>${toPlace.some((p) => p.listing) ? ' (les mises en vente dépendent aussi des concurrents)' : ''}.</div>` : ''}`
    : '';
  const mineOffers = plots.map((p) => offerOf(state, p.id, ME)).filter((o): o is NonNullable<typeof o> => !!o);
  const actions = `<div class="row">
      ${canMerge ? '<button id="merge" class="primary">Assembler en un terrain</button>' : ''}
      ${canBundle ? `<button id="bundle" class="primary" title="Une offre par terrain, tranchées ensemble : si une seule échoue, rien n’est acheté et tout vous est rendu">Offre groupée « tout ou rien » · ${eur(needs)}</button>` : ''}
      ${auction && toPlace.length > 1 && !hasBundle ? `<button id="prospectAll" ${needs > me().cash ? 'disabled' : ''} title="Une offre indépendante sur chaque terrain : vous pouvez en gagner certains seulement">Offres séparées</button>` : ''}
      ${mineOffers.length ? `<button data-withdraw="${esc(mineOffers[0].plot)}">Retirer ${mineOffers[0].bundle ? 'l’offre groupée' : 'mon offre'}</button>` : ''}
      ${!auction && freeP.length && mineP.length + freeP.length === plots.length ? '<button id="buyAll" title="Achète toutes les parcelles libres de la sélection">Tout acheter</button>' : ''}
      <button id="clear">Annuler</button>
    </div>
    ${canBundle ? '<p class="muted" style="font-size:12px"><b>Tout ou rien</b> : si un propriétaire refuse ou si un concurrent vous devance sur une seule parcelle, aucune n’est achetée et vos sommes bloquées vous sont rendues (les frais de prospection restent perdus). Si vous remportez tout, les parcelles sont assemblées d’office.</p>' : ''}`;
  // Simulation du projet assemblé (sans rien acheter).
  let simHtml = '';
  if (typeof sim !== 'string') {
    simPlot = sim;
    const body = sim.issue ? `<div class="notice" style="--nc:#7b3fa0"><b>Encore trop juste</b> ${esc(ISSUE_MESSAGE[sim.issue])}</div>` : projectForm(sim, false);
    simHtml = `<h2>Projet sur l’ensemble</h2>
      <div class="muted" style="font-size:12px">Simulation sans rien acheter : terrain à ${eur(sim.askingPrice)} (vos offres prévues et ce que vous avez déjà payé), frais de notaire en plus pour les parcelles à acheter.</div>${body}`;
    if (sim.issue) drawOverlay(null);
  }
  // Voisines à ajouter.
  const neighbours = busy.length ? [] : neighboursOf(plots);
  const nb = neighbours.length
    ? `<h2>Voisines à ajouter</h2><ul class="neigh">${neighbours
        .map((c) => `<li><a href="#" data-goto="${esc(c.id)}">${esc(shortLabel(c).replace(/ · \d+ m²$/, ''))}</a> <span class="muted">${Math.round(areaOf(c))} m² · ${c.owner === ME ? 'à vous' : c.listing ? `en vente, départ ${eur(c.listing.minPrice)}` : `${eur(c.askingPrice)} affiché`}${c.issue === 'delaisse' ? ' · délaissé' : c.issue ? ' · à assembler' : ''}${c.speculator && (c.speculation ?? 1) > 1.02 ? ' · ↑ spécule' : ''}</span> <button class="add" data-add="${esc(c.id)}">+ Ajouter</button></li>`)
        .join('')}</ul>`
    : '';
  return `<div class="head"><b>${plots.length} parcelles</b> <span class="muted">· ${Math.round(area)} m²</span></div>
    ${plan}${level}${geometry}${why}${actions}${nb}${simHtml}
    <p class="muted" style="font-size:12px">Les parcelles doivent se toucher sur au moins 1,5 m. Assembler permet de construire plus gros, et de rendre constructibles des parcelles trop petites ou enclavées.</p>`;
}

function statusPill(p: Plot): string {
  if (p.projectId) return pill('opération en cours', colorOf(p.owner ?? ''));
  if (p.owner === ME) return pill(p.obligation ? 'à vous · engagements' : 'à vous', colorOf(ME));
  if (p.owner) return pill(esc(state.players.find((x) => x.id === p.owner)!.name), colorOf(p.owner));
  if (p.zacRole === 'equipement') return pill('équipement public', '#4a6f9c');
  if (p.zacRole === 'lot' && p.municipal) return pill('lot de ZAC', '#0f8b8d');
  if (p.municipal) return pill('terrain communal', '#0f8b8d');
  if (p.issue === 'zone') return pill('inconstructible', '#777');
  if (p.issue === 'delaisse') return pill('délaissé', '#8a8478');
  if (p.issue) return pill('à assembler', '#7b3fa0');
  return pill('libre', '#2b6cb0');
}

function renderSingle(p: Plot): string {
  const area = areaOf(p);
  const fee = p.askingPrice * state.config.bilanParams.acquisitionFeeRate;
  const mine = p.owner === ME;
  const run = p.projectId ? state.projects.find((r) => r.id === p.projectId) : null;
  const rule = ruleOf(p);
  const fact = (k: string, v: string) => `<div class="fact"><small>${k}</small><b>${v}</b></div>`;
  let html = `<div class="head"><b>${esc(shortLabel(p).replace(/ · \d+ m²$/, ''))}</b> ${statusPill(p)}</div>
    <div class="facts">
      ${fact('Surface', `${Math.round(area)} m²${p.parts ? ` <span class="muted">(${p.parts.length} parcelles)</span>` : ''}`)}
      ${p.obligation && p.owner === ME ? fact('Payé à la commune', `${eur(p.obligation.price)} <span class="muted">${Math.round(p.obligation.price / area)} €/m²</span>`) : fact(isListed(p) ? 'Prix de départ' : 'Prix affiché', `${eur(isListed(p) ? p.listing!.minPrice : p.askingPrice)} <span class="muted">${Math.round(p.askingPrice / area)} €/m²</span>`)}
      ${fact('Zone', rule ? pill(`${esc(rule.label)}${rule.buildable ? ` · R+${rule.maxLevels}` : ''}`, rule.color) : '—')}
      ${fact('Bâti existant', p.existingSdp ? `${p.existingSdp} m²${p.existingHeight ? ` · ${Math.round(p.existingHeight)} m` : ''}` : 'aucun')}
    </div><!--VERDICT-->`;

  // Règles, meilleur projet et voisines : l'analyse passe sous l'action (verdict, achat, projet), repliée sauf pour un terrain « à assembler ».
  const analysis = run ? '' : plotBrief(p, mine) + neighboursBlock(p);
  const analysisHtml = analysis ? fold('Analyse du terrain : règles, meilleur projet, voisines', analysis, !!p.issue && p.issue !== 'zone') : '';
  if (run) {
    drawOverlay(null);
    return html + `<h2>Opération ${esc(run.id)}</h2>` + operationCard(run.id) + details(p);
  }
  if (p.zacRole === 'equipement') {
    drawOverlay(null);
    const z = state.zacs.find((x) => x.id === p.zacId);
    const e = z?.equipment.find((x) => x.plot === p.id);
    if (z && e) {
      const left = e.deliverAt !== undefined ? Math.max(0, e.deliverAt - state.round) : null;
      return html + `<div class="notice" style="--nc:#4a6f9c"><b>${esc(e.label[0].toUpperCase() + e.label.slice(1))}</b> de la ZAC ${esc(z.name)} · <b>${EQUIPMENT_STATUS[e.status]}</b>
        <div class="muted" style="font-size:12px;margin-top:4px">Terrain public : il ne se vend pas. L’équipement est financé par les participations des lots de la ZAC (${z.participation} € par m² de plancher) et démarre quand assez de lots sont lancés. Une fois livré, les logements de la ZAC se vendent <b>${Math.round(e.premium * 100)} % plus cher</b>.</div>
        ${e.status === 'chantier' && left !== null ? pbar(EQUIPMENT_BUILD_ROUNDS - left, EQUIPMENT_BUILD_ROUNDS, `livraison dans ${left} trim.`) : ''}
        ${e.status === 'prevu' ? pbar(z.launched, z.lots.length, `${z.launched}/${z.lots.length} lots lancés`) : ''}</div>` + analysisHtml + details(p);
    }
  }
  if (p.municipal && !p.owner) {
    drawOverlay(null);
    const t = openTenders(state).find((x) => x.plotId === p.id);
    return html + `<div class="notice" style="--nc:#0f8b8d"><b>Terrain communal</b> La commune ne le vend pas au plus offrant : elle choisit le meilleur projet par appel d’offres.${t ? `<br>${esc(t.id)} est ouvert (${esc(t.spec.programme.label)}).` : '<br>Un nouvel appel d’offres sera lancé prochainement.'}</div>${t ? '<div class="row"><button id="toTender" class="primary">Voir l’appel d’offres</button></div>' : ''}` + analysisHtml + details(p);
  }
  const issueBox = p.issue === 'zone'
    ? `<div class="notice" style="--nc:#777"><b>Inconstructible</b> ${esc(ISSUE_MESSAGE.zone)}</div>`
    : p.issue === 'delaisse'
      ? `<div class="notice" style="--nc:#8a8478"><b>Délaissé</b> ${esc(ISSUE_MESSAGE.delaisse)}</div>`
      : p.issue
      ? `<div class="notice" style="--nc:#7b3fa0"><b>À assembler</b> ${esc(ISSUE_MESSAGE[p.issue])}<br><span class="muted">Sélectionnez les voisines (Maj+clic), achetez-les, puis « Assembler ».</span></div>`
      : '';
  if (!p.owner && state.config.landMarket === 'auction') {
    html += `<h3 class="sect">Acquérir ce terrain</h3>${issueBox}${auctionPanel(p)}`;
    if (p.issue) {
      drawOverlay(null);
      return html + analysisHtml + details(p);
    }
    { const form = projectForm(p, false, false); return html.replace('<!--VERDICT-->', lastVerdict) + form + analysisHtml + details(p); }
  }
  if (!p.owner) {
    const missing = buyCost(p) - me().cash;
    html += `<h3 class="sect">Acquérir ce terrain</h3>${issueBox}<div class="row"><button id="buy" class="primary" ${missing > 0 ? 'disabled' : ''}>Acheter · ${eur(buyCost(p))}</button></div>
      <div class="muted" style="font-size:12px">${missing > 0 ? `<span class="bad">Il vous manque ${eur(missing)}.</span> ` : ''}Frais de notaire compris (${eur(fee)}).</div>`;
    if (p.issue) {
      drawOverlay(null);
      return html + analysisHtml + details(p);
    }
    { const form = projectForm(p, false, false); return html.replace('<!--VERDICT-->', lastVerdict) + form + analysisHtml + details(p); }
  }
  if (!mine) {
    drawOverlay(null);
    return html + analysisHtml + details(p);
  }
  html += `${issueBox}${p.obligation ? obligationNotice(p) : `<div class="row"><button id="sell" class="danger" title="Revente à la banque : ${Math.round(state.config.plotSpread * 100)} % de moins que le prix affiché">Revendre · ${eur(p.askingPrice * (1 - state.config.plotSpread))}</button></div>`}`;
  if (p.issue) {
    drawOverlay(null);
    return html + analysisHtml + details(p);
  }
  { const form = projectForm(p, true, false); return html.replace('<!--VERDICT-->', lastVerdict) + form + analysisHtml + details(p); }
}

// ---------------------------------------------------------------- barres de progression, notifications, fenêtres d'alerte

/** Barre de progression ; `late` la passe au rouge, `warnAt` à l'orange quand elle est presque pleine. */
function pbar(value: number, max: number, label: string, opts: { late?: boolean; warnAt?: number; mark?: number } = {}): string {
  const frac = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const cls = opts.late ? 'late' : opts.warnAt !== undefined && frac >= opts.warnAt ? 'warn' : '';
  return `<div class="pbar-row"><div class="pbar ${cls}"><i style="width:${Math.round(frac * 100)}%"></i>${opts.mark !== undefined ? `<b style="left:${Math.round(opts.mark * 100)}%"></b>` : ''}</div><span class="pbar-label ${cls}">${esc(label)}</span></div>`;
}

/** Les quatre étapes d'une opération sur une frise proportionnelle à leur durée. */
function phaseTimeline(r: ProjectRun): string {
  const need = Math.max(1, Math.ceil(r.lots * state.config.presaleThreshold));
  const order = ['permis', 'preventes', 'chantier', 'livraison'] as const;
  const at = order.indexOf(r.phase);
  const steps: { label: string; weight: number; frac: number }[] = [
    { label: 'Permis', weight: r.permitRounds, frac: r.phase === 'permis' ? r.phaseElapsed / r.permitRounds : 1 },
    { label: 'Préventes', weight: 1.2, frac: at > 1 ? 1 : at === 1 ? Math.min(1, r.lotsSold / need) : 0 },
    { label: 'Chantier', weight: r.buildRounds, frac: at > 2 ? 1 : at === 2 ? r.phaseElapsed / r.buildRounds : 0 },
    { label: 'Ventes', weight: Math.max(1, r.sellRounds), frac: at === 3 ? soldShare(r) : 0 },
  ];
  return `<div class="timeline">${steps.map((s, i) => `<div class="tl ${i < at ? 'done' : i === at ? 'now' : ''}" style="flex:${s.weight}"><div class="tlbar"><i style="width:${Math.round(Math.min(1, s.frac) * 100)}%"></i></div><small>${s.label}</small></div>`).join('')}</div>`;
}

/** Délai de livraison promis à la commune : trimestres écoulés depuis le lancement sur trimestres promis. */
function deliveryBar(r: { terms?: { delivery: number }; roundsRun: number; phase: string }): string {
  const promised = r.terms!.delivery;
  if (r.phase === 'livraison') return `<div class="muted" style="font-size:12px">Livré en ${r.roundsRun} trim. pour ${promised} promis à la commune</div>`;
  const late = r.roundsRun >= promised;
  return `<div style="font-size:12px;margin-top:4px">Délai promis à la commune</div>${pbar(Math.min(r.roundsRun, promised), promised, late ? `dépassé (trim. ${r.roundsRun}/${promised})` : `trim. ${r.roundsRun}/${promised}`, { late, warnAt: 0.8 })}`;
}

const TONE_COLOR: Record<string, string> = { good: 'var(--good)', bad: 'var(--bad)', warn: 'var(--warn)', info: 'var(--accent)' };

/** Un point de vigilance (échéance, appel d'offres, préventes…) avec sa barre. */
function watchItem(w: Watch): string {
  const ref = w.ref ? ` data-ref-plot="${esc(w.ref.plot ?? '')}" data-ref-tender="${esc(w.ref.tender ?? '')}"` : '';
  return `<div class="watch" style="--wc:${TONE_COLOR[w.tone]}"><div class="wtitle">${esc(w.title)}</div>${w.detail ? `<div class="muted" style="font-size:12px">${esc(w.detail)}</div>` : ''}${w.progress ? pbar(w.progress.value, w.progress.max, w.progress.label, { late: w.progress.late || w.tone === 'bad', warnAt: w.tone === 'warn' ? 0 : undefined }) : ''}${w.ref ? `<a href="#" class="wgo"${ref}>Voir</a>` : ''}</div>`;
}

const renderWatch = (items: Watch[]) => items.map(watchItem).join('');

function bindRefs(root: HTMLElement) {
  root.querySelectorAll<HTMLAnchorElement>('.wgo').forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      gotoRef({ plot: a.dataset.refPlot || undefined, tender: a.dataset.refTender || undefined });
    };
  });
}

/** Va voir ce qu'un événement ou un point de vigilance concerne. */
function gotoRef(ref: { plot?: string; tender?: string; project?: string }) {
  closeNotif();
  closeModal();
  const plot = ref.plot ? plotById(ref.plot) : undefined;
  if (ref.tender) tab = 'commune';
  else if (plot) {
    selected = new Set([plot.id]);
    tab = 'terrain';
    map.panTo([plot.parcel.ring[0].lat, plot.parcel.ring[0].lon]);
  } else if (ref.project) tab = 'operations';
  renderAll();
}

const relevant = (e: GameEvent) => isRelevant(e, ME);
/** Événements nouveaux pour moi (hors ceux déjà montrés par une fenêtre). */
const unreadCount = () => state.log.slice(Math.min(seenLog, state.log.length)).filter((e) => relevant(e) && !e.popup).length;
const urgentWatch = () => watchList(state, ME).some((w) => w.tone === 'bad');

// ---------------------------------------------------------------- pastilles de notification en jeu

/** Nouvelle partie : rien n'est lu, et les pastilles de l'ancienne partie disparaissent. */
function resetNotifications() {
  seenLog = 0;
  try {
    localStorage.setItem(SEEN_KEY, '0');
  } catch {
    /* stockage indisponible */
  }
  for (const live of livePills.values()) (live.pill.dispose(), live.pill.el.remove());
  livePills.clear();
}

/** Une pastille par type d'événement non lu : elle se déroule à l'arrivée d'une nouveauté, puis se replie en gardant son point (ou son compteur). */
const PILL_KINDS: Record<string, { icon: string; title: string; filter: NotifFilter }> = {
  terrain: { icon: '🏷️', title: 'Terrains', filter: 'terrain' },
  commune: { icon: '📣', title: 'Commune', filter: 'commune' },
  operation: { icon: '🏢', title: 'Opérations', filter: 'operation' },
  alea: { icon: '⚡', title: 'Aléas', filter: 'alea' },
};
const pillStack = new L.Control({ position: 'bottomright' });
pillStack.onAdd = () => {
  const el = L.DomUtil.create('div', 'npills');
  L.DomEvent.disableClickPropagation(el);
  return el;
};

/** Met les pastilles à jour d'après les événements non lus (appelé à chaque rendu) : crée, compte, annonce les nouveautés, retire celles qui ont été lues. */
function renderPills() {
  const host = pillStack.getContainer();
  if (!host) return;
  const groups = new Map<string, GameEvent[]>();
  for (const e of state.log.slice(Math.min(seenLog, state.log.length))) {
    if (!relevant(e) || e.popup) continue;
    const kind = e.kind === 'finance' || !e.kind ? 'operation' : e.kind;
    if (PILL_KINDS[kind]) (groups.get(kind) ?? groups.set(kind, []).get(kind)!).push(e);
  }
  type PillItem = { icon: string; title: string; label: string; count: number; go: () => void };
  const items = new Map<string, PillItem>();
  const clip = (t: string) => (t.length > 46 ? `${t.slice(0, 44)}…` : t);
  for (const [kind, events] of groups) {
    const conf = PILL_KINDS[kind];
    items.set(kind, { icon: conf.icon, title: conf.title, label: `${events.length > 1 ? `${events.length} nouveautés · ` : ''}${clip(events[events.length - 1].text)}`, count: events.length, go: () => ((notifFilter = conf.filter), openNotif()) });
  }
  // Alertes du trimestre (découvert, délais qui approchent…) : une pastille par alerte tant qu'elle dure.
  if (!state.over)
    for (const w of watchList(state, ME))
      if (w.tone === 'bad' || w.tone === 'warn')
        items.set(`w:${w.id}`, { icon: w.tone === 'bad' ? '🚨' : '⏳', title: 'Alerte du trimestre', label: clip(w.title), count: 1, go: () => ((tab = 'trimestre'), renderAll()) });
  for (const [key, live] of livePills) {
    if (!items.has(key)) {
      live.pill.dispose();
      live.pill.el.remove();
      livePills.delete(key);
    }
  }
  for (const [key, it] of items) {
    let live = livePills.get(key);
    if (!live) {
      const id = `np-${key.replace(/[^\w-]/g, '_')}`;
      host.insertAdjacentHTML('beforeend', pillHTML({ id, icon: `<span class="emo">${it.icon}</span>`, label: it.label, title: `${it.title} : voir` }));
      const pill = mountPill(host, { id, icon: '', label: it.label, title: it.title, onClick: it.go });
      live = { pill, count: pillsReady ? 0 : it.count };
      livePills.set(key, live);
    }
    live.pill.setUnread(it.count);
    if (it.count > live.count) live.pill.announce(it.label, 6500);
    live.count = it.count;
  }
}

const KIND_LABEL: Record<string, string> = { alea: 'Aléa', commune: 'Commune', operation: 'Opération', terrain: 'Terrain', finance: 'Finances' };
const FILTERS: [NotifFilter, string][] = [['tout', 'Tout'], ['alea', 'Aléas'], ['commune', 'Commune'], ['operation', 'Opérations'], ['terrain', 'Terrains']];

function closeNotif() {
  const n = $('notif');
  n.hidden = true;
  n.innerHTML = '';
}

function openNotif() {
  const previouslySeen = seenLog;
  seenLog = state.log.length;
  try {
    localStorage.setItem(SEEN_KEY, String(seenLog));
  } catch {
    /* stockage indisponible */
  }
  renderTop();
  renderPills();
  const render = () => {
    const n = $('notif');
    const watches = watchList(state, ME);
    const items = state.log
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => relevant(e) && (notifFilter === 'tout' || e.kind === notifFilter || (notifFilter === 'operation' && e.kind === 'finance')))
      .slice(-60)
      .reverse();
    n.innerHTML = `<div class="notif-back"></div><aside class="notif-panel" role="dialog" aria-label="Notifications">
      <div class="notif-head"><b>Notifications</b><button id="notif-close" aria-label="Fermer">✕</button></div>
      <div class="notif-body">
        <h3>À surveiller${watches.length ? ` (${watches.length})` : ''}</h3>
        ${renderWatch(watches) || '<p class="muted">Rien d’urgent : aucune échéance en cours.</p>'}
        <h3>Historique</h3>
        <div class="chips">${FILTERS.map(([k, l]) => `<button data-nf="${k}" class="chipbtn ${notifFilter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <ul class="nlist">${items
          .map(({ e, i }) => {
            const fresh = i >= previouslySeen;
            const go = e.ref ? ` data-ref-plot="${esc(e.ref.plot ?? '')}" data-ref-tender="${esc(e.ref.tender ?? '')}" data-ref-project="${esc(e.ref.project ?? '')}"` : '';
            return `<li class="${fresh ? 'fresh' : ''}" style="--wc:${TONE_COLOR[e.tone ?? 'info']}"><div class="nmeta"><span class="kind">${esc(KIND_LABEL[e.kind ?? ''] ?? 'Info')}</span> <span class="muted">${quarterLabel(e.round)}</span>${fresh ? ' <span class="new">nouveau</span>' : ''}</div><div>${esc(e.text)}</div>${e.ref && (e.ref.plot || e.ref.tender) ? `<a href="#" class="ngo"${go}>Voir</a>` : ''}</li>`;
          })
          .join('') || '<li class="muted">Rien pour le moment.</li>'}</ul>
      </div></aside>`;
    n.hidden = false;
    n.querySelector<HTMLElement>('.notif-back')!.onclick = closeNotif;
    n.querySelector<HTMLButtonElement>('#notif-close')!.onclick = closeNotif;
    n.querySelectorAll<HTMLButtonElement>('[data-nf]').forEach((b) => (b.onclick = () => ((notifFilter = b.dataset.nf as NotifFilter), render())));
    bindRefs(n);
    n.querySelectorAll<HTMLAnchorElement>('.ngo').forEach((a) => {
      a.onclick = (ev) => {
        ev.preventDefault();
        gotoRef({ plot: a.dataset.refPlot || undefined, tender: a.dataset.refTender || undefined, project: a.dataset.refProject || undefined });
      };
    });
  };
  render();
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('notif').hidden) closeNotif();
});

/** Explication pédagogique de chaque aléa ou verdict : ce que c'est, ce que ça change, quoi faire. */
const ALERT_INFO: Record<string, { icon: string; title: string; why: string; tip?: string }> = {
  'marche-baisse': { icon: '📉', title: 'Retournement du marché', why: 'Les acheteurs se font rares : les prix de vente baissent et la demande se refroidit pour quelques trimestres.', tip: 'Baissez le prix de vos lots invendus pour continuer à vendre, ou patientez en sachant que les intérêts courent.' },
  'marche-hausse': { icon: '📈', title: 'Regain du marché', why: 'Les acheteurs reviennent : les prix de vente montent et les lots partent plus vite.', tip: 'C’est le moment de vendre sans remise, et d’acheter des terrains avant qu’ils ne renchérissent.' },
  recours: { icon: '⚖️', title: 'Recours de voisins', why: 'Des riverains contestent le permis de construire devant le tribunal administratif : l’instruction est suspendue.', tip: 'Un trimestre de retard et des frais financiers. Sur un engagement de délai envers la commune, ce retard peut coûter des pénalités.' },
  pollution: { icon: '☣️', title: 'Sol pollué', why: 'Des terres polluées sont découvertes au terrassement : il faut les évacuer et les traiter.', tip: 'Le surcoût est retranché du solde de l’opération à la livraison.' },
  fouilles: { icon: '🏺', title: 'Fouilles archéologiques', why: 'Le sous-sol contient des vestiges : le chantier s’arrête le temps des fouilles préventives.', tip: 'Deux trimestres de retard. Un projet sans sous-sol n’est pas concerné.' },
  'taux-hausse': { icon: '🏦', title: 'Les taux montent', why: 'Le crédit promoteur coûte plus cher : vos opérations non vendues et votre découvert vous coûtent davantage.', tip: 'Vendez vite les lots en cours, et évitez de lancer sans fonds propres suffisants.' },
  'taux-baisse': { icon: '🏦', title: 'Les taux baissent', why: 'Le crédit promoteur devient moins cher : les opérations en cours coûtent moins en intérêts.' },
  'zac-ouverte': { icon: '🏙️', title: 'Une ZAC démarre', why: 'La commune aménage un quartier : plusieurs lots seront attribués l’un après l’autre, et des équipements publics (école, square…) seront construits grâce aux participations des promoteurs.', tip: 'Les lots d’une ZAC sont vendus à prix réduit, avec un étage de plus que le PLU. Les premiers lancés financent les équipements dont profiteront les derniers.' },
  'zac-equipement': { icon: '🏫', title: 'Équipement public livré', why: 'Un équipement de la ZAC est livré : le quartier devient plus attractif, les logements de la ZAC se vendent plus cher.', tip: 'Si vous avez des lots invendus dans la ZAC, c’est le moment de remonter vos prix.' },
  'groupe-remporte': { icon: '🧩', title: 'Offre groupée remportée', why: 'Vous avez remporté toutes les parcelles de votre offre « tout ou rien » : elles sont assemblées d’office en un seul terrain.', tip: 'Ouvrez le terrain assemblé et lancez votre projet : « Meilleur projet » calcule la version la plus rentable.' },
  'groupe-perdu': { icon: '🧩', title: 'Offre groupée annulée', why: 'Un propriétaire a refusé ou un concurrent vous a devancé sur au moins une parcelle : comme l’offre était « tout ou rien », aucune parcelle n’est achetée et vos sommes bloquées vous sont rendues.', tip: 'Les frais de prospection restent perdus. Passez au niveau d’offre « Sûr » pour viser une acceptation certaine, ou retirez la parcelle problématique.' },
  'ao-gagne': { icon: '🏆', title: 'Appel d’offres remporté', why: 'La commune vous cède le terrain : vos engagements (logements sociaux, qualité, délai) sont désormais contractuels.', tip: 'Lancez l’opération avant l’échéance, sinon la commune reprend le terrain et garde 10 % du prix.' },
  'ao-perdu': { icon: '📋', title: 'Appel d’offres perdu', why: 'Un autre promoteur a obtenu une meilleure note. Votre somme bloquée vous est rendue.', tip: 'Regardez la pondération annoncée : un critère lourd (mixité, délai…) peut valoir plus qu’un meilleur prix.' },
  'ao-reprise': { icon: '⏰', title: 'Terrain repris par la commune', why: 'Vous n’avez pas lancé l’opération dans le délai accordé : la commune reprend son terrain et garde une pénalité.' },
  'retard-livraison': { icon: '⏱️', title: 'Livraison en retard', why: 'Vous avez livré après le délai promis à la commune : des pénalités sont déduites de votre résultat.', tip: 'Promettre un délai court améliore la note à l’appel d’offres mais ne pardonne aucun retard.' },
  solde: { icon: '🏁', title: 'Opération soldée', why: 'Tous les lots sont vendus et le crédit est remboursé : le résultat net est encaissé.' },
  'terrain-remporte': { icon: '🔑', title: 'Terrain remporté', why: 'Votre offre l’emporte : le terrain est à vous, prix et frais de notaire payés.', tip: 'Étudiez le « Meilleur projet » puis lancez l’opération : un terrain qui dort coûte du portage.' },
  faillite: { icon: '💥', title: 'Faillite', why: 'Votre patrimoine est négatif : la banque saisit vos terrains et arrête vos chantiers.' },
};

/** Fenêtre d'alerte pour les aléas et verdicts importants, un par un. */
function showPopups(list: GameEvent[], i = 0) {
  const e = list[i];
  const info = ALERT_INFO[e.code ?? ''] ?? { icon: 'ℹ️', title: KIND_LABEL[e.kind ?? ''] ?? 'Information', why: '' };
  const last = i === list.length - 1;
  const canGo = !!(e.ref && (e.ref.plot || e.ref.tender) && (e.ref.tender || (e.ref.plot && plotById(e.ref.plot))));
  openModal(
    `<div class="alert" style="--wc:${TONE_COLOR[e.tone ?? 'info']}">
      ${list.length > 1 ? `<div class="muted" style="font-size:12px">${i + 1} / ${list.length} · ${quarterLabel(e.round)}</div>` : `<div class="muted" style="font-size:12px">${quarterLabel(e.round)}</div>`}
      <div class="alert-icon" aria-hidden="true">${info.icon}</div>
      <h2 class="mh">${esc(info.title)}</h2>
      <p class="alert-text">${esc(e.text)}</p>
      ${info.why ? `<p class="muted">${esc(info.why)}</p>` : ''}
      ${info.tip ? `<div class="notice" style="--nc:var(--wc)"><b>À savoir</b> ${esc(info.tip)}</div>` : ''}
      <div class="row" style="margin-top:12px">${canGo ? '<button id="al-go" type="button">Voir</button>' : ''}<span class="spacer"></span><button id="al-next" type="button" class="primary">${last ? 'Compris' : 'Suivant'}</button></div>
    </div>`,
    (root) => {
      root.querySelector<HTMLButtonElement>('#al-next')!.onclick = () => (last ? closeModal() : showPopups(list, i + 1));
      const go = root.querySelector<HTMLButtonElement>('#al-go');
      if (go) go.onclick = () => gotoRef(e.ref!);
    },
  );
}

const QUALITY_LABEL = ['standard', 'performant', 'exemplaire'];
const qualityHint = (q: number) => (q === 0 ? 'aucun surcoût' : `travaux +${Math.round((QUALITY_COST[q] - 1) * 100)} %, prix de vente +${Math.round((QUALITY_PREMIUM[q] - 1) * 100)} %`);
const programmePill = (t: Pick<Tender['spec'], 'programme'>['programme']) => pill(esc(t.label), '#0f8b8d');

/** Engagements pris auprès de la commune pour un terrain que je possède. */
function obligationNotice(p: Plot): string {
  const o = p.obligation!;
  const left = o.launchBy - state.round;
  return `<div class="notice" style="--nc:#0f8b8d"><b>Engagements envers la commune</b> ${programmePill(o.programme)}
    <div style="margin-top:4px">${[
      `<span class="chip"><b>${Math.round(o.socialShare * 100)} %</b> de logements sociaux</span>`,
      `<span class="chip">qualité <b>${QUALITY_LABEL[o.quality]}</b></span>`,
      `<span class="chip">livraison en <b>${o.delivery} trim.</b> après le lancement</span>`,
      `<span class="chip">hauteur max <b>R+${o.maxLevels}</b></span>`,
      o.groundCommerce ? '<span class="chip">commerces en rez-de-chaussée</span>' : '',
    ].join('')}</div>
    <div class="muted" style="font-size:12px;margin-top:4px">${esc(o.programme.summary)}</div>
    <div style="font-size:12px;margin-top:6px">Délai pour lancer l’opération</div>${pbar(LAUNCH_GRACE - Math.max(0, left), LAUNCH_GRACE, left > 0 ? `encore ${left} trim.` : 'dépassé', { late: left <= 1, warnAt: 0.6 })}
    <div style="margin-top:4px">${left > 0 ? `À lancer avant la fin de <b>${quarterLabel(o.launchBy - 1)}</b> (encore ${left} trimestre${left > 1 ? 's' : ''})` : '<b class="bad">Délai dépassé</b>'}, sinon la commune reprend le terrain et garde 10 % du prix. Livrer en retard coûte des pénalités. Ce terrain ne peut ni se revendre ni s’assembler tant que l’opération n’est pas lancée.</div></div>`;
}

function tenderDraftOf(t: Tender) {
  return (tenderDraft[t.id] ??= (() => {
    const b = tenderBidOf(t, ME);
    return b
      ? { price: b.price, share: b.socialShare, quality: b.quality, delivery: b.delivery }
      : { price: Math.round((t.spec.minPrice * 1.1) / 1000) * 1000, share: Math.min(MAX_SOCIAL_SHARE, t.spec.minSocialShare + 0.05), quality: t.spec.minQuality, delivery: t.spec.maxDelivery };
  })());
}

/** Note de ma proposition en préparation, et ce qu'elle laisse comme marge : mis à jour en direct. */
function tenderPreview(t: Tender): string {
  const d = tenderDraftOf(t);
  const bid = { price: d.price, socialShare: d.share, quality: d.quality, delivery: d.delivery };
  const problem = bidProblem(t.spec, bid);
  const plot = plotById(t.plotId)!;
  const sc = scoreBid(t.spec, bid);
  const w = t.spec.weights;
  const line = (label: string, weight: number, v: number) =>
    `<tr><td>${label} <span class="muted">${Math.round(weight * 100)} %</span></td><td style="width:45%"><div class="meter"><i style="width:${Math.round(v * 100)}%"></i></div></td><td class="num">${Math.round(v * weight * 100)}</td></tr>`;
  const worth = tenderWorth(state, plot, t.spec, d.share, d.quality, 0);
  const target = tenderWorth(state, plot, t.spec, d.share, d.quality, state.config.bilanParams.targetMargin);
  const mine = tenderBidOf(t, ME);
  const need = Math.round(d.price * (1 + state.config.bilanParams.acquisitionFeeRate)) - (mine?.reserved ?? 0);
  const missing = need - me().cash;
  const verdict = worth.value <= 0
    ? '<div class="check bad">Avec ces engagements, aucun projet n’est rentable sur ce terrain.</div>'
    : d.price > worth.value
      ? `<div class="check bad">À ce prix, même le meilleur projet (R+${worth.levels}) perd de l’argent : le terrain ne peut pas valoir plus de ${eur(worth.value)} avec ces engagements.</div>`
      : d.price > target.value
        ? `<div class="check warn">Marge faible : pour ${pct(state.config.bilanParams.targetMargin)} de marge, le terrain ne devrait pas dépasser ${eur(target.value)} (meilleur projet R+${target.levels}${target.attic ? ' + attique' : ''}).</div>`
        : `<div class="check good">Le meilleur projet (R+${worth.levels}${worth.attic ? ' + attique' : ''}) reste rentable : jusqu’à ${eur(target.value)} pour ${pct(state.config.bilanParams.targetMargin)} de marge.</div>`;
  return `<table class="score">${line('Prix', w.price, sc.price)}${line('Mixité sociale', w.social, sc.social)}${line('Qualité', w.quality, sc.quality)}${line('Délai', w.delay, sc.delay)}
    <tr class="total"><td colspan="2">Votre note</td><td class="num"><b>${Math.round(sc.total * 100)}</b> / 100</td></tr></table>
    ${problem ? `<div class="check bad">${esc(problem)}</div>` : verdict}
    ${missing > 0 ? `<div class="check bad">Il vous manque ${eur(missing)} (la somme est bloquée jusqu’au verdict, notaire compris).</div>` : `<div class="muted" style="font-size:12px">Bloque ${eur(Math.round(d.price * (1 + state.config.bilanParams.acquisitionFeeRate)))} notaire compris jusqu’au verdict.</div>`}`;
}

function tenderCard(t: Tender): string {
  const plot = plotById(t.plotId)!;
  const s = t.spec;
  const d = tenderDraftOf(t);
  const mine = tenderBidOf(t, ME);
  const left = t.closesAt - state.round;
  const qOpts = [0, 1, 2].filter((q) => q >= s.minQuality).map((q) => `<option value="${q}" ${d.quality === q ? 'selected' : ''}>${QUALITY_LABEL[q]} (${qualityHint(q)})</option>`).join('');
  const dOpts = Array.from({ length: s.maxDelivery - s.minDelivery + 1 }, (_, i) => s.minDelivery + i).map((n) => `<option value="${n}" ${d.delivery === n ? 'selected' : ''}>${n} trimestres</option>`).join('');
  const w = s.weights;
  return `<div class="card tender" data-tender="${esc(t.id)}">
    <div><b>${esc(t.id)}</b> · <a href="#" data-goto="${esc(plot.id)}">${esc(shortLabel(plot).replace(/ · \d+ m²$/, ''))}</a> <span class="muted">${Math.round(areaOf(plot))} m²</span> ${programmePill(s.programme)}${mine ? ' ' + pill('vous avez répondu', colorOf(ME)) : ''}</div>
    <div class="muted" style="font-size:12px;margin:4px 0">${esc(s.programme.summary)}</div>
    <div>${[
      `<span class="chip">sociaux ≥ <b>${Math.round(s.minSocialShare * 100)} %</b></span>`,
      `<span class="chip">hauteur <b>R+${s.maxLevels}</b> max</span>`,
      s.groundCommerce ? '<span class="chip">commerces en rez-de-chaussée</span>' : '',
      s.minQuality ? '<span class="chip">qualité <b>performante</b> minimum</span>' : '',
      `<span class="chip">livraison <b>${s.minDelivery}–${s.maxDelivery}</b> trim.</span>`,
      `<span class="chip">prix de cession ≥ <b>${eur(s.minPrice)}</b></span>`,
    ].join('')}</div>
    <div class="muted" style="font-size:12px;margin-top:4px">Critères de choix : prix <b>${Math.round(w.price * 100)} %</b> · mixité sociale <b>${Math.round(w.social * 100)} %</b> · qualité <b>${Math.round(w.quality * 100)} %</b> · délai <b>${Math.round(w.delay * 100)} %</b>. Les autres propositions restent secrètes (${t.bids.length} déposée${t.bids.length > 1 ? 's' : ''}).</div>
    ${pbar(state.round - t.opensAt, t.closesAt - t.opensAt, `${left} trimestre${left > 1 ? 's' : ''} pour répondre`, { warnAt: 0.6 })}
    <div class="muted" style="font-size:12px">Dernier trimestre pour répondre : <b>${quarterLabel(t.closesAt - 1)}</b>. Le lauréat dispose ensuite de ${LAUNCH_GRACE} trimestres pour lancer.</div>
    <label class="f col">Prix du terrain<input type="number" data-t="price" step="1000" min="${s.minPrice}" value="${d.price}"></label>
    <label class="f col">Logements sociaux <span><input type="range" data-t="share" min="${Math.round(s.minSocialShare * 100)}" max="${Math.round(MAX_SOCIAL_SHARE * 100)}" step="1" value="${Math.round(d.share * 100)}"> <b data-t="sharev">${Math.round(d.share * 100)} %</b> <span class="muted">(vendus à un bailleur à prix réduit)</span></span></label>
    <label class="f col">Qualité<select data-t="quality">${qOpts}</select></label>
    <label class="f col">Délai de livraison promis<select data-t="delivery">${dOpts}</select></label>
    <div data-tpreview="${esc(t.id)}">${tenderPreview(t)}</div>
    <div class="row"><button class="primary" data-tbid="${esc(t.id)}">${mine ? 'Modifier ma proposition' : 'Déposer ma proposition'}</button>${mine ? `<button data-twithdraw="${esc(t.id)}">Retirer</button>` : ''}</div>
  </div>`;
}

/** Onglet « Commune » : appels d'offres ouverts, mes engagements, résultats passés. */
/** Fiche d'une ZAC : lots (à venir, ouverts, attribués, lancés), équipements publics et leur avancement. */
function zacCard(z: Zac): string {
  const lotRow = (id: string, k: number) => {
    const p = plotById(id);
    const tender = openTenders(state).find((t) => t.plotId === id);
    let status: string;
    if (!p) status = 'attribué, assemblé';
    else if (tender) status = `<b>appel d’offres ${esc(tender.id)} ouvert</b> · réponse avant la fin de ${quarterLabel(tender.closesAt - 1)}`;
    else if (p.projectId) status = `opération lancée par ${esc(state.players.find((x) => x.id === p.owner)?.name ?? '')}`;
    else if (p.owner) status = `attribué à ${esc(state.players.find((x) => x.id === p.owner)?.name ?? '')}${p.obligation ? ', à lancer' : ', livré'}`;
    else status = k < z.opened ? 'à relancer' : 'à venir';
    return `<li>${p ? `<a href="#" data-goto="${esc(id)}">Lot ${k + 1}</a>` : `Lot ${k + 1}`} <span class="muted">${p ? Math.round(areaOf(p)) + ' m² · ' : ''}${status}</span></li>`;
  };
  const eqRow = (e: Zac['equipment'][number]) => {
    const left = e.deliverAt !== undefined ? Math.max(0, e.deliverAt - state.round) : null;
    return `<li><a href="#" data-goto="${esc(e.plot)}">${esc(e.label[0].toUpperCase() + e.label.slice(1))}</a> <span class="pill" style="--pc:${e.status === 'livre' ? 'var(--good)' : e.status === 'chantier' ? 'var(--warn)' : '#8a8478'}">${EQUIPMENT_STATUS[e.status]}</span> <span class="muted">+${Math.round(e.premium * 100)} % sur les ventes${e.status === 'chantier' && left !== null ? ` · livraison dans ${left} trim.` : ''}</span>${e.status === 'chantier' && left !== null ? pbar(EQUIPMENT_BUILD_ROUNDS - left, EQUIPMENT_BUILD_ROUNDS, `${EQUIPMENT_BUILD_ROUNDS - left}/${EQUIPMENT_BUILD_ROUNDS} trim.`) : ''}</li>`;
  };
  const delivered = z.equipment.filter((e) => e.status === 'livre').reduce((t, e) => t + e.premium, 0);
  return `<div class="card zac"><div><b>ZAC ${esc(z.name)}</b> ${pill(`${z.lots.length} lots`, '#0f8b8d')}</div>
    <div class="muted" style="font-size:12px;margin:4px 0">Quartier aménagé par la commune : les lots sont attribués l’un après l’autre. Chaque lot lancé verse <b>${z.participation} € par m² de plancher</b> pour financer les équipements publics ; une fois livrés, ils valorisent les logements de la ZAC${delivered ? ` (déjà +${Math.round(delivered * 100)} %)` : ''}.</div>
    ${pbar(z.launched, z.lots.length, `${z.launched}/${z.lots.length} lots lancés`)}
    <ul class="zaclist">${z.lots.map(lotRow).join('')}</ul>
    <div style="font-size:12px;margin-top:6px"><b>Équipements publics</b></div>
    <ul class="zaclist">${z.equipment.map(eqRow).join('')}</ul></div>`;
}

function renderCommune(): string {
  drawOverlay(null);
  const open = openTenders(state);
  const done = state.tenders.filter((t) => t.status !== 'open').slice(-6).reverse();
  const committed = committedTenderCash(state, ME);
  const commitments = watchList(state, ME).filter((w) => /^(launch|delivery):/.test(w.id));
  const resultRow = (t: Tender) => {
    const p = plotById(t.plotId);
    const who = t.status === 'awarded' ? `attribué à <b>${esc(state.players.find((x) => x.id === t.winner)?.name ?? '?')}</b>` : 'infructueux';
    return `<li>${esc(t.id)} · ${esc(p ? shortLabel(p).replace(/ · \d+ m²$/, '') : t.plotId)} <span class="muted">${esc(t.spec.programme.label)}</span> : ${who}</li>`;
  };
  return `${state.zacs.length ? `<h2>ZAC (${state.zacs.length})</h2>${state.zacs.map(zacCard).join('')}` : ''}<h2>Appels d’offres de la commune (${open.length})</h2>
    <p class="muted" style="font-size:12px">La commune cède ses terrains au <b>meilleur projet</b>, pas au plus offrant : chaque proposition (prix, logements sociaux, qualité, délai) est notée selon des critères annoncés. En échange du cahier des charges, le cadre de l’opération (ZAC, PUP, quartier prioritaire) apporte des avantages.</p>
    ${open.map(tenderCard).join('') || '<p class="muted">Aucun appel d’offres ouvert pour le moment : la commune en lance régulièrement.</p>'}
    ${committed ? `<p class="muted" style="font-size:12px">${eur(committed)} sont bloqués sur votre trésorerie tant que les appels d’offres sont ouverts.</p>` : ''}
    ${commitments.length ? `<h2>Mes engagements envers la commune</h2>${renderWatch(commitments)}` : ''}
    ${done.length ? `<h2>Résultats</h2><ul class="log">${done.map(resultRow).join('')}</ul>` : ''}`;
}

function bindTenders() {
  $('side').querySelectorAll<HTMLElement>('[data-tender]').forEach((card) => {
    const t = state.tenders.find((x) => x.id === card.dataset.tender);
    if (!t) return;
    const d = tenderDraftOf(t);
    const q = <E extends HTMLElement>(k: string) => card.querySelector<E>(`[data-t="${k}"]`)!;
    const refresh = () => (card.querySelector<HTMLElement>('[data-tpreview]')!.innerHTML = tenderPreview(t));
    q<HTMLInputElement>('price').oninput = (e) => ((d.price = Math.max(0, Math.round(+(e.target as HTMLInputElement).value || 0))), refresh());
    q<HTMLInputElement>('share').oninput = (e) => {
      d.share = +(e.target as HTMLInputElement).value / 100;
      q('sharev').textContent = `${Math.round(d.share * 100)} %`;
      refresh();
    };
    q<HTMLSelectElement>('quality').onchange = (e) => ((d.quality = +(e.target as HTMLSelectElement).value as Quality), refresh());
    q<HTMLSelectElement>('delivery').onchange = (e) => ((d.delivery = +(e.target as HTMLSelectElement).value), refresh());
    card.querySelector<HTMLButtonElement>('[data-tbid]')!.onclick = () => {
      if (act({ type: 'tenderBid', player: ME, tender: t.id, price: d.price, socialShare: d.share, quality: d.quality, delivery: d.delivery })) {
        toast('Proposition déposée : verdict à la clôture de l’appel d’offres');
        renderAll();
      }
    };
    const wd = card.querySelector<HTMLButtonElement>('[data-twithdraw]');
    if (wd)
      wd.onclick = () => {
        if (act({ type: 'tenderWithdraw', player: ME, tender: t.id })) {
          delete tenderDraft[t.id];
          toast('Proposition retirée, somme débloquée');
          renderAll();
        }
      };
  });
}

/** Offre sur un terrain libre (mode enchères) : mise en vente ouverte ou prospection du propriétaire. */
function auctionPanel(p: Plot): string {
  const listed = isListed(p);
  const mine = offerOf(state, p.id, ME);
  const n = offersOn(state, p.id).length;
  const min = minOfferPrice(p);
  const rate = state.config.bilanParams.acquisitionFeeRate;
  const draft = bidDraft[p.id] ?? mine?.price ?? Math.round((listed ? min * 1.05 : p.askingPrice * 1.08) / 1000) * 1000;
  const fee = !listed && !mine ? prospectFee(state, draft) : 0;
  const reserved = Math.round(draft * (1 + rate));
  const need = reserved - (mine?.reserved ?? 0) + fee;
  const missing = need - me().cash;
  const left = p.listing ? p.listing.until - state.round : 0;
  const head = listed
    ? `<div class="notice" style="--nc:#c98200"><b>En vente</b> · offres ouvertes jusqu’à ${quarterLabel(p.listing!.until - 1)} (encore ${left} trimestre${left > 1 ? 's' : ''}) · ${n} offre${n > 1 ? 's' : ''} déposée${n > 1 ? 's' : ''}<div class="muted" style="font-size:12px">Offres sous pli fermé : le plus offrant l’emporte.</div></div>`
    : `${(p.speculation ?? 1) > 1.02 ? `<div class="notice" style="--nc:var(--warn)"><b>↑ Prix en hausse (+${Math.round(((p.speculation ?? 1) - 1) * 100)} %)</b> Son prix grimpe plus vite que le marché : ce propriétaire spécule. Il ne mettra pas son terrain en vente et exigera plus que le prix affiché.</div>` : ''}<div class="notice" style="--nc:var(--accent)"><b>Pas en vente</b> · vous pouvez prospecter le propriétaire : réponse à la fin du trimestre, frais de prospection non remboursés. ${n ? `${n} offre${n > 1 ? 's' : ''} déjà déposée${n > 1 ? 's' : ''} ce trimestre.` : ''}<div class="muted" style="font-size:12px">Il n’accepte que s’il est satisfait du prix ; si deux promoteurs prospectent, le plus offrant l’emporte.</div></div>`;
  return `${head}
    <label class="f col">${mine ? 'Votre offre' : listed ? 'Votre offre' : 'Prix proposé'}<input type="number" id="bid" step="1000" min="${min}" value="${draft}"></label>
    <div class="muted" style="font-size:12px">Minimum ${eur(min)} · bloque ${eur(reserved)} notaire compris${fee ? ` · frais de prospection ${eur(fee)}` : ''}${mine ? ` · déjà bloqué ${eur(mine.reserved)}` : ''}</div>
    ${missing > 0 ? `<div class="check bad">Il vous manque ${eur(missing)}.</div>` : ''}
    <div class="row"><button id="offer" class="primary" ${missing > 0 ? 'disabled' : ''}>${mine ? 'Modifier mon offre' : listed ? 'Déposer l’offre' : 'Prospecter'} · ${eur(draft)}</button>${mine ? '<button id="withdraw">Retirer</button>' : ''}</div>`;
}

/** Détails repliés : règles d'urbanisme et situation. */
function details(p: Plot): string {
  const rule = ruleOf(p);
  return (rule ? fold(`Règles d’urbanisme · ${esc(rule.label)}`, zoneCard(p)) : '') + fold(`Situation · prix de vente ×${p.locationFactor.toFixed(2).replace('.', ',')}`, locationDetail(p));
}

/** Prix de terrain pris pour le bilan d'un terrain pas encore acquis : l'offre en préparation, sinon le prix affiché. */
/** Offre proposée par défaut : un peu au-dessus du prix de départ ou du prix affiché. */
/** Niveau des offres proposées par défaut : « standard » (un peu au-dessus du prix) ou « sûr » (au-dessus de ce que n'importe quel propriétaire exige). */
let offerLevel: 'standard' | 'sur' = 'standard';

/** Offre proposée par défaut pour un terrain libre, selon le niveau d'offre choisi. */
function bidFor(p: Plot): number {
  const spec = p.speculator ? 1.2 : 1;
  const price = p.listing
    ? p.listing.minPrice * (offerLevel === 'sur' ? 1.2 : 1.05)
    : p.askingPrice * (offerLevel === 'sur' ? (1 + state.config.reserveSpread) * spec * 1.01 : 1.08);
  return Math.round(price / 1000) * 1000;
}

/**
 * Chance qu'un propriétaire non vendeur accepte ce prix : son seuil se situe entre le prix affiché et `reserveSpread` de plus
 * (jusqu'à 20 % de plus pour un spéculateur). Pour une mise en vente, tout dépend des concurrents (null).
 */
function acceptChance(p: Plot, price: number): number | null {
  if (p.listing) return null;
  const spread = state.config.reserveSpread;
  const spec = p.speculator ? 1.2 : 1;
  const x = price / (p.askingPrice * spec) - 1;
  return spread <= 0 ? (x >= 0 ? 1 : 0) : Math.min(1, Math.max(0, x / spread));
}

const defaultBid = (p: Plot) => bidDraft[p.id] ?? offerOf(state, p.id, ME)?.price ?? bidFor(p);

function landDraft(p: Plot): number {
  if (p.id === SIM_ID) return simPlot?.askingPrice ?? p.askingPrice;
  if (state.config.landMarket !== 'auction') return p.askingPrice;
  return bidDraft[p.id] ?? offerOf(state, p.id, ME)?.price ?? (p.listing ? Math.round((p.listing.minPrice * 1.05) / 1000) * 1000 : Math.round((p.askingPrice * 1.08) / 1000) * 1000);
}

/** Engagements envers la commune qui s'appliquent au projet d'un terrain que je possède. */
const obligationOf = (p: Plot, owned: boolean) => (owned ? p.obligation : undefined);

/** Critères du projet : PLU, plus les engagements pris auprès de la commune (bonus de hauteur, commerces en rez-de-chaussée). */
function plotCriteria(p: Plot, base: Criteria, owned: boolean): Criteria {
  const ob = obligationOf(p, owned);
  return criteriaFor(p, ob?.groundCommerce ? { ...base, groundFloorUse: 'commerce' } : base, ob?.programme.bonusLevels ?? 0);
}

/** Bilan d'un projet, avec le cadre d'opération et les engagements éventuels. */
function planBilan(p: Plot, proj: ReturnType<typeof computeProject>, landPrice: number, owned: boolean) {
  const ob = obligationOf(p, owned);
  return computeBilan({
    project: proj,
    market: currentMarket(state, p),
    landPrice,
    existingSdp: p.existingSdp,
    params: programmeParams(currentParams(state), ob?.programme),
    ...(ob ? { socialShare: ob.socialShare, quality: ob.quality, salesPremium: ob.programme.salesPremium } : {}),
  });
}

/** Cherche le projet le plus rentable sans erreur (R+0 à R+8, avec ou sans attique, stationnement automatique). */
interface BestPlan {
  /** Type de logement du meilleur projet. */
  housing: HousingType;
  levels: number;
  attic: boolean;
  margin: number;
  marginRate: number;
  /** Prix de terrain maximal pour la marge visée. */
  maxLand: number;
  dwellings: number;
  sdp: number;
  /** Nombre de bâtiments du meilleur projet. */
  buildings: number;
  /** Vrai si le meilleur projet est un bâtiment unique alors que plusieurs étaient possibles. */
  single?: boolean;
}
function bestForm(p: Plot, owned: boolean): BestPlan | null {
  const landPrice = owned ? p.paid / (1 + state.config.bilanParams.acquisitionFeeRate) : landDraft(p);
  let best: BestPlan | null = null;
  const ob = owned ? p.obligation : undefined;
  for (const housing of ob ? (['collectif'] as const) : housingTypesFor(ruleOf(p))) for (let levels = 0; levels <= (housing === 'maison' ? 1 : 8); levels++) {
    for (const attic of [false, true]) {
      if (ob && levels + (attic ? 1 : 0) > ob.maxLevels) continue;
      const proj = computeProject(p.parcel, plotCriteria(p, { ...criteria(), levels, attic, housing, parkingStrategy: 'auto' }, owned));
      if (!proj.footprint || proj.checks.some((c) => c.status === 'error')) continue;
      const b = planBilan(p, proj, landPrice, owned);
      if (!best || b.margin > best.margin) best = { levels, attic, housing, margin: b.margin, marginRate: b.marginRate, maxLand: b.maxLandPrice, dwellings: proj.indicators.dwellings, sdp: proj.indicators.sdpTotal, buildings: proj.indicators.buildings };
    }
  }
  // Plusieurs bâtiments ne sont pas toujours plus rentables (allée ou porche, distance entre bâtiments) : on compare avec un seul.
  if (best && best.buildings > 1 && form.second) {
    for (const levels of [best.levels - 1, best.levels, best.levels + 1]) {
      if (levels < 0 || (ob && levels > ob.maxLevels)) continue;
      const proj = computeProject(p.parcel, plotCriteria(p, { ...criteria(), levels, attic: levels === best.levels && best.attic, housing: best.housing, parkingStrategy: 'auto', secondBuilding: false }, owned));
      if (!proj.footprint || proj.checks.some((c) => c.status === 'error')) continue;
      const b = planBilan(p, proj, landPrice, owned);
      if (b.margin > best.margin) best = { levels, attic: levels === best.levels && best.attic, housing: best.housing, margin: b.margin, marginRate: b.marginRate, maxLand: b.maxLandPrice, dwellings: proj.indicators.dwellings, sdp: proj.indicators.sdpTotal, buildings: 1, single: true };
    }
  }
  return best;
}

const briefCache = new Map<string, BestPlan | null>();
/** Meilleur projet d'un terrain, mémorisé pour la durée d'un trimestre (le calcul teste une vingtaine de variantes). */
function bestBrief(p: Plot, owned: boolean): BestPlan | null {
  const key = `${p.id}|${state.round}|${owned}|${landDraft(p)}|${form.placement}|${form.shape}|${form.depth}`;
  if (!briefCache.has(key)) {
    if (briefCache.size > 200) briefCache.clear();
    briefCache.set(key, bestForm(p, owned));
  }
  return briefCache.get(key)!;
}

/** Sur la fiche d'un terrain : les voisines qu'on peut y joindre pour un projet plus grand (ajout en un clic). */
function neighboursBlock(p: Plot): string {
  if (p.municipal || p.projectId || p.obligation || p.issue === 'zone' || (p.owner && p.owner !== ME)) return '';
  const list = neighboursOf([p], 4);
  if (!list.length) return '';
  return fold(
    `Projet sur plusieurs terrains · ${list.length} voisine${list.length > 1 ? 's' : ''}`,
    `<div class="muted" style="font-size:12px">Ajoutez une voisine pour simuler un projet plus grand, voir le coût total et déposer une offre groupée « tout ou rien ».</div>
     <ul class="neigh">${list
       .map((c) => `<li><a href="#" data-goto="${esc(c.id)}">${esc(shortLabel(c).replace(/ · \d+ m²$/, ''))}</a> <span class="muted">${Math.round(areaOf(c))} m² · ${c.owner === ME ? 'à vous' : c.listing ? `en vente, départ ${eur(c.listing.minPrice)}` : `${eur(c.askingPrice)} affiché`}${c.issue === 'delaisse' ? ' · délaissé' : c.issue ? ' · à assembler' : ''}</span> <button class="add" data-add="${esc(c.id)}" data-base="${esc(p.id)}">+ Ajouter</button></li>`)
       .join('')}</ul>`,
  );
}

/** Résumé de lecture immédiate d'un terrain : règles, meilleur projet, prix par rapport au quartier. */
function plotBrief(p: Plot, owned: boolean): string {
  if (p.zacRole === 'equipement') return '';
  const rule = ruleOf(p);
  const area = areaOf(p);
  const chip = (t: string, cls = '') => `<span class="chip ${cls}">${t}</span>`;
  const rules = rule && rule.buildable
    ? [
        chip(`R+${rule.maxLevels} max`),
        chip(`emprise ${Math.round(rule.maxCoverage * 100)} %`),
        chip(rule.setbackFond || rule.setbackLateral ? `retraits ${[rule.setbackFond ? `fond ${rule.setbackFond} m` : '', rule.setbackLateral ? `côtés ${rule.setbackLateral} m` : ''].filter(Boolean).join(', ')}` : 'en limite possible'),
        chip(rule.alignment === 'rue' ? 'alignement sur rue' : 'implantation libre'),
        p.density === 'dense' ? chip('tissu dense') : p.density === 'diffuse' ? chip('tissu aéré') : '',
      ].join('')
    : '';
  // Prix au m² comparé au prix moyen des terrains libres du quartier.
  const free = state.plots.filter((x) => !x.owner && !x.issue && !x.municipal);
  const ppms = free.map((x) => x.askingPrice / areaOf(x)).sort((x, y) => x - y);
  const avg = ppms.length ? ppms[Math.floor(ppms.length / 2)] : 0;
  const ppm = (p.owner && p.paid ? p.paid / (1 + state.config.bilanParams.acquisitionFeeRate) : p.askingPrice) / area;
  const rel = avg > 0 ? Math.round((ppm / avg - 1) * 100) : 0;
  const price = avg > 0 && !p.issue && Math.abs(rel) >= 5 ? `<span class="muted"> · ${Math.abs(rel)} % ${rel > 0 ? 'plus cher' : 'moins cher'} que la médiane des terrains libres (${Math.round(avg)} €/m²)</span>` : '';
  let best = '';
  if (!p.issue && !p.projectId && !p.municipal) {
    const b = bestBrief(p, owned);
    best = b
      ? `<div class="brief ${b.margin >= 0 ? 'ok' : 'ko'}"><b>Meilleur projet</b> : ${b.housing === 'maison' ? 'maisons, ' : ''}R+${b.levels}${b.attic ? ' + attique' : ''}${b.buildings > 1 ? `, ${b.buildings} bâtiments` : ''}, ${b.dwellings} logements · marge <b class="${b.margin >= 0 ? 'good' : 'bad'}">${eur(b.margin)}</b> (${pct(b.marginRate)} du CA) · le terrain pourrait valoir jusqu’à ${eur(b.maxLand)}${price}</div>`
      : `<div class="brief ko"><b>Aucun projet rentable</b> avec les réglages actuels sur ce terrain seul.${price}</div>`;
  } else if (price) best = `<div class="brief"><span class="muted">Prix :</span>${price}</div>`;
  return `${rules ? `<div class="rules">${rules}</div>` : ''}${best}`;
}

/** Les règles de la zone du PLU, en clair. */
function zoneCard(p: Plot): string {
  const rule = ruleOf(p);
  if (!rule) return '';
  const several = p.zones.length > 1 ? '<div class="muted" style="font-size:12px">Terrain à cheval sur plusieurs zones : la règle la plus stricte s’applique.</div>' : '';
  const code = p.zoneCode ? `<span class="muted">${esc(p.zoneCode)}</span> · ` : '';
  const dens = p.density === 'dense' ? ' · tissu dense' : p.density === 'diffuse' ? ' · tissu aéré' : '';
  if (!rule.buildable) return `<div><b>${code}${esc(rule.label)}</b>${several}<div class="muted">${esc(rule.summary)}</div></div>`;
  const chip = (t: string) => `<span class="chip">${t}</span>`;
  return `<div><b>${code}${esc(rule.label)}${dens}</b>${several}
    <div class="muted" style="font-size:12px">${esc(rule.summary)}</div>
    <div style="margin-top:4px">${chip(`Hauteur max <b>R+${rule.maxLevels}</b>`)}${chip(`Emprise <b>${Math.round(rule.maxCoverage * 100)} %</b>`)}${chip(`Pleine terre <b>${Math.round(rule.minOpenGround * 100)} %</b>`)}${rule.setbackFond || rule.setbackLateral ? chip(`Retraits <b>${rule.setbackFond ? `fond ${rule.setbackFond} m` : ''}${rule.setbackFond && rule.setbackLateral ? ', ' : ''}${rule.setbackLateral ? `côtés ${rule.setbackLateral} m` : ''}</b>`) : chip('Construction en limite possible')}${chip(rule.use === 'bureaux' ? '<b>Bureaux</b> uniquement' : 'Logements, commerces')}${chip(rule.alignment === 'rue' ? '<b>Alignement sur rue</b> obligatoire' : 'Implantation libre')}</div>
    <div class="muted" style="font-size:11px;margin-top:4px">Règles simplifiées inspirées du type de zone, pas le règlement réel.</div></div>`;
}

function locationDetail(p: Plot): string {
  const n = p.parcel.ring.length;
  const here = { lon: p.parcel.ring.reduce((t, q) => t + q.lon, 0) / n, lat: p.parcel.ring.reduce((t, q) => t + q.lat, 0) / n };
  const parts = locationParts(here, district.pois).slice(0, 4);
  if (!parts.length) return '<div class="muted">Aucun équipement structurant à proximité.</div>';
  return `<div class="muted" style="font-size:12px">Les équipements proches font monter les prix de vente (donc le terrain) :<br>${parts.map((x) => `${esc(LOCATION_RULES[x.kind].label)} ${esc(x.name)} · ${x.distance} m · +${(x.bonus * 100).toFixed(1).replace('.', ',')} %`).join('<br>')}</div>`;
}

const TYPOS: Typology[] = ['T1', 'T2', 'T3', 'T4', 'T5'];
let mixOpen = false;
/**
 * Répartition des logements : ce que le marché de la commune achète (ventes réelles), le programme choisi, et ce que cet écart
 * change (prix moyen de vente, rapidité des ventes).
 */
function mixFold(proj: ReturnType<typeof computeProject>): string {
  if (proj.housing === 'maison') return `<div class="muted" style="font-size:12px">${proj.indicators.dwellings} maison${proj.indicators.dwellings > 1 ? 's' : ''} de ${Math.round(proj.indicators.avgDwellingArea)} m² habitables en moyenne, vendues au prix des maisons de la commune${state.config.market.houseRatio ? ` (×${state.config.market.houseRatio.toFixed(2).replace('.', ',')} le prix d’un appartement neuf)` : ''}.</div>`;
  const market = state.config.market;
  const stats = district.marketStats;
  const mix = form.mix ?? market.demandMix ?? criteria().mix;
  const sum = TYPOS.reduce((s, t) => s + mix[t], 0) || 1;
  const counts = proj.typologyCounts;
  const total = TYPOS.reduce((s, t) => s + counts[t], 0);
  const fit = mixFit(counts, market.demandMix);
  const factor = typologyPriceFactor(proj, market);
  const head = stats
    ? `<div class="muted" style="font-size:12px">${esc(stats.source)} · ${stats.sales.toLocaleString('fr-FR')} ventes d’appartements · médiane ${stats.pricePerM2.toLocaleString('fr-FR')} €/m²${stats.byYear.length > 1 ? ` (${stats.byYear[0].year} : ${stats.byYear[0].pricePerM2.toLocaleString('fr-FR')} → ${stats.byYear[stats.byYear.length - 1].year} : ${stats.byYear[stats.byYear.length - 1].pricePerM2.toLocaleString('fr-FR')})` : ''}</div>`
    : '<div class="muted" style="font-size:12px">Pas de statistiques de ventes pour cette carte : répartition standard.</div>';
  const rows = TYPOS.map((t) => {
    const s = stats?.byTypology[t];
    return `<tr><td><b>${t}</b></td><td>${s ? `${Math.round(s.share * 100)} %` : '–'}</td><td>${s ? `${s.area} m²` : `${Math.round(DEFAULT_ASSUMPTIONS.typologyArea[t])} m²`}</td><td>${s ? `${s.pricePerM2.toLocaleString('fr-FR')} €` : '–'}</td><td><input type="number" min="0" max="100" step="5" data-mix="${t}" value="${Math.round((mix[t] / sum) * 100)}" aria-label="Part de ${t} dans votre programme (%)"/></td><td class="muted">${total ? `${counts[t]}` : '–'}</td></tr>`;
  }).join('');
  const fitTxt = market.demandMix
    ? `<div class="check ${fit >= 0.9 ? 'ok' : fit >= 0.78 ? 'warn' : 'bad'}">Adéquation au marché <b>${Math.round(fit * 100)} %</b>${fit >= 0.95 ? ' : programme calé sur ce que la commune achète.' : ' : les logements qui s’écartent de la demande se vendent plus lentement.'}${market.typologyRatio ? ` Prix moyen de vente ${Math.abs(Math.round((factor - 1) * 100)) === 0 ? '<b>égal</b> au prix de la commune' : `<b>${factor >= 1 ? '+' : '−'}${Math.abs(Math.round((factor - 1) * 100))} %</b> par rapport au prix de la commune`} (les petits logements se vendent plus cher au m²).` : ''}</div>`
    : '';
  const body = `${head}
    <table class="mixtable"><tr><th></th><th title="Part des ventes d’appartements">Ventes</th><th title="Surface médiane vendue">Taille</th><th title="Prix médian au m²">Prix</th><th title="Part dans votre programme (%)">Votre mix</th><th title="Logements obtenus">Obtenus</th></tr>${rows}</table>
    ${fitTxt}
    <div class="row"><button id="mix-market" type="button" ${market.demandMix ? '' : 'disabled'} title="Reprendre la répartition des ventes de la commune">Caler sur le marché</button><button id="mix-default" type="button" title="Répartition standard du jeu">Standard</button></div>`;
  return `<details class="fold" id="mix-fold" ${mixOpen ? 'open' : ''}><summary>Répartition des logements${market.demandMix ? ` · adéquation ${Math.round(fit * 100)} %` : ''}</summary><div class="foldbody">${body}</div></details>`;
}

/** Zones de la jauge du verdict : en dessous de 0 % la marge est négative, jusqu'à 8 % elle est juste, au-delà le projet est rentable. */
const VERDICT_MIN = -0.15;
const VERDICT_MAX = 0.25;
const VERDICT_OK = 0.08;
const gaugePos = (m: number) => Math.max(0, Math.min(100, ((m - VERDICT_MIN) / (VERDICT_MAX - VERDICT_MIN)) * 100));

/**
 * Verdict du terrain en une carte : « Rentable / Limite / Déficitaire » sur une jauge rouge, orange, verte, avec le gain estimé,
 * la fourchette si les prix de vente bougent de 5 % (la marge s'ajuste à chaque trimestre avec le marché) et l'étape suivante.
 */
function verdictCard(p: Plot, proj: ReturnType<typeof computeProject>, landPrice: number, owned: boolean, b: ReturnType<typeof planBilan>, ok: boolean, short: number): string {
  const ob = obligationOf(p, owned);
  const at = (delta: number) =>
    computeBilan({
      project: proj,
      market: currentMarket(state, p),
      landPrice,
      existingSdp: p.existingSdp,
      params: programmeParams(currentParams(state), ob?.programme),
      ...(ob ? { socialShare: ob.socialShare, quality: ob.quality } : {}),
      salesPremium: (ob?.programme.salesPremium ?? 0) + delta,
    });
  const up = at(0.05);
  const down = at(-0.05);
  const m = b.marginRate;
  const level = !ok ? 'warn' : m < 0 ? 'bad' : m < VERDICT_OK ? 'mid' : 'good';
  const word = !ok ? 'À corriger' : m < 0 ? 'Déficitaire' : m < VERDICT_OK ? 'Limite' : 'Rentable';
  const lo = Math.min(gaugePos(down.marginRate), gaugePos(up.marginRate));
  const hi = Math.max(gaugePos(down.marginRate), gaugePos(up.marginRate));
  // Hausse des prix de vente qui ramènerait la marge à zéro (la marge est quasi linéaire avec les prix).
  const slope = (up.margin - down.margin) / 0.1;
  const breakEven = b.margin < 0 && slope > 0 ? -b.margin / slope : null;
  const outlook =
    breakEven !== null
      ? breakEven <= 0.3
        ? `Il faudrait environ <b>+${Math.round(breakEven * 100)} %</b> sur les prix de vente pour atteindre l’équilibre.`
        : 'Même avec une forte hausse des prix, ce projet resterait déficitaire : changez de projet ou négociez le terrain.'
      : `Si les prix de vente varient de 5 % : de <b>${pct(down.marginRate)}</b> à <b>${pct(up.marginRate)}</b> de marge.`;
  const next = !ok
    ? 'Corrigez les points signalés ci-dessous, ou cliquez sur « Meilleur projet ».'
    : short > 0
      ? `Il vous manque ${eur(short)} de trésorerie.`
      : owned
        ? 'Le terrain est à vous : lancez l’opération.'
        : 'Étape suivante : faites une offre ou achetez (boutons plus bas).';
  return `<div class="verdict ${level}" title="Calculée aux prix de vente actuels (indice ${(state.marketIndex * 100).toFixed(0)}) : la marge bouge avec le marché, les taux et les coûts.">
      <div class="vd-head"><b class="vd-word">${word}</b><span class="vd-gain">${ok ? `${b.margin >= 0 ? '+' : '−'}${eur(Math.abs(b.margin))} · ${pct(m)}` : ''}</span></div>
      <div class="vd-gauge" aria-hidden="true"><i class="z-bad"></i><i class="z-mid"></i><i class="z-good"></i><span class="vd-range" style="left:${lo.toFixed(1)}%;width:${Math.max(1.5, hi - lo).toFixed(1)}%"></span><span class="vd-mark" style="left:${gaugePos(m).toFixed(1)}%"></span></div>
      <div class="vd-scale"><span style="left:0">−15 %</span><span style="left:${gaugePos(0).toFixed(1)}%">0 %</span><span style="left:${gaugePos(VERDICT_OK).toFixed(1)}%">8 %</span><span style="left:100%">+25 %</span></div>
      <p class="vd-note">${outlook}</p>
      ${ok ? `<p class="vd-max">Prix de terrain maximal pour votre marge visée (${pct(state.config.bilanParams.targetMargin)}) : <b>${eur(b.maxLandPrice)}</b>${owned ? '' : ` · vous comptez payer ${eur(landPrice)}`}.</p>` : ''}
      <p class="vd-next">${next}</p>
      ${owned ? `<div class="row"><button id="launch" class="primary" ${ok && short <= 0 ? '' : 'disabled'}>Lancer l’opération</button></div>` : ''}
    </div>`;
}

/** Verdict du dernier projet calculé par `projectForm` : l'onglet Terrain le place en haut du panneau. */
let lastVerdict = '';
function projectForm(p: Plot, owned: boolean, inlineVerdict = true): string {
  lastVerdict = '';
  const rule = ruleOf(p);
  const ob = obligationOf(p, owned);
  // Hauteur permise (attique compris) : PLU plus bonus de la ZAC, sans dépasser l'engagement pris.
  const totalCap = Math.min(rule ? rule.maxLevels + (ob?.programme.bonusLevels ?? 0) : 11, ob ? ob.maxLevels : 99);
  // Type de logement : maisons imposées en quartier pavillonnaire, immeuble imposé par un appel d'offres ou en zone dense.
  const types = ob ? (['collectif'] as HousingType[]) : housingTypesFor(rule);
  // Un nouveau terrain (ou assemblage) s'ouvre sur son meilleur projet ; le joueur ajuste ensuite à sa guise.
  const bestKey = `${p.id}|${[...selected].sort().join('+')}`;
  if (autoBestKey !== bestKey) {
    autoBestKey = bestKey;
    const found = bestForm(p, owned);
    if (found) {
      form.levels = found.levels;
      form.attic = found.attic;
      form.housing = found.housing;
      form.second = !found.single;
      form.parking = 'auto';
    }
  }
  if (!types.includes(form.housing)) form.housing = types[0];
  const maxLv = Math.max(0, Math.min(rule || ob ? totalCap - (form.attic ? 1 : 0) : 10, form.housing === 'maison' ? 1 : 99));
  if (form.levels > maxLv) form.levels = maxLv;
  const proj = computeProject(p.parcel, plotCriteria(p, criteria(), owned));
  drawOverlay(proj);
  const errors = proj.checks.filter((c) => c.status === 'error');
  const sel = (v: ParkingStrategy, l: string) => `<option value="${v}" ${form.parking === v ? 'selected' : ''}>${l}</option>`;
  const options = `<label class="f">Stationnement<select id="f-parking">${sel('auto', 'automatique')}${sel('sous-sol', 'sous-sol')}${sel('rdc', 'rez-de-chaussée')}${sel('surface', 'en surface')}${sel('hors-site', 'places achetées à proximité')}${sel('aucun', 'aucun')}</select></label>
    <label class="f" title="Où poser le bâtiment sur le terrain : le long de la rue, en retrait au fond de la parcelle, ou la meilleure des deux">Implantation<select id="f-placement" ${rule?.alignment === 'rue' ? 'disabled' : ''}>${[['auto', 'automatique'], ['rue', 'le long de la rue'], ['fond', 'en retrait, au fond du terrain']].map(([v, l]) => `<option value="${v}" ${(rule?.alignment === 'rue' ? 'rue' : form.placement) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    ${rule?.alignment === 'rue' ? '<div class="muted" style="font-size:12px">Le PLU de cette zone impose l’alignement sur la rue.</div>' : ''}
    <label class="f" title="Forme adaptée : suit le terrain (L sur un angle) ; rectangle : volume simple, plus lisible">Forme du bâtiment<select id="f-shape">${[['adapte', 'adaptée au terrain'], ['rectangle', 'rectangle simple']].map(([v, l]) => `<option value="${v}" ${form.shape === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f" title="Au-delà de 14 m de profondeur, l'éclairement naturel devient difficile">Profondeur max du bâtiment<select id="f-depth">${[10, 12, 15, 18, 22].map((d) => `<option value="${d}" ${form.depth === d ? 'selected' : ''}>${d} m</option>`).join('')}</select></label>`;
  const canSecond = !rule || rule.maxBuildings >= 2;
  const secondControl = canSecond
    ? `<div class="row" style="align-items:center;margin-top:0"><label class="f" style="margin:0" title="Le promoteur occupe le terrain au mieux : un ou plusieurs bâtiments derrière celui sur rue, si le terrain est assez profond ou grand et si le PLU l'autorise (allée ou porche d'accès, distance entre bâtiments)"><input type="checkbox" id="f-second" ${form.second ? 'checked' : ''}/> plusieurs bâtiments si possible</label>${form.second ? `<label class="f" style="margin:0" title="Hauteur des bâtiments de fond">fond R+<select id="f-second-levels"><option value="" ${form.secondLevels === null ? 'selected' : ''}>auto</option>${Array.from({ length: Math.min(6, rule ? rule.maxLevels : 5) + 1 }, (_, i) => `<option value="${i}" ${i === form.secondLevels ? 'selected' : ''}>${i}</option>`).join('')}</select></label>` : ''}</div>`
    : '<div class="muted" style="font-size:12px">Le PLU de cette zone n’autorise qu’un seul bâtiment par terrain.</div>';
  let html = `<h2>Projet</h2>
    <div class="row" style="align-items:center">
      <label class="f" style="margin:0">Niveaux R+<select id="f-levels">${Array.from({ length: maxLv + 1 }, (_, i) => `<option ${i === form.levels ? 'selected' : ''}>${i}</option>`).join('')}</select></label>
      <label class="f" style="margin:0" title="L'attique compte comme un niveau dans la hauteur maximale de la zone">attique <input type="checkbox" id="f-attic" ${form.attic ? 'checked' : ''} ${(rule || ob) && totalCap - 1 < form.levels ? 'disabled' : ''}/></label>
      <button id="best" title="Teste les niveaux autorisés par le PLU, avec ou sans attique, et choisit le plus rentable sans erreur">Meilleur projet</button>
    </div>
    ${types.length > 1 ? `<label class="f" title="Immeuble collectif : escalier, ascenseur, appartements. Maisons : un logement par maison (R+1, 75 m² d'emprise au plus), plusieurs maisons sur le terrain, un jardin chacune">Type de logement<select id="f-housing"><option value="collectif" ${form.housing === 'collectif' ? 'selected' : ''}>immeuble collectif</option><option value="maison" ${form.housing === 'maison' ? 'selected' : ''}>maisons (ensemble)</option></select></label>` : `<div class="muted" style="font-size:12px">${types[0] === 'maison' ? 'Quartier pavillonnaire : ensembles de maisons seulement.' : 'Immeuble collectif.'}</div>`}
    ${secondControl}
    ${fold('Options', options)}
    ${mixFold(proj)}`;
  if (!proj.footprint) return html + `<p class="bad">Rien de constructible avec ces critères.</p>`;

  const landPrice = owned ? p.paid / (1 + state.config.bilanParams.acquisitionFeeRate) : landDraft(p);
  const b = planBilan(p, proj, landPrice, owned);
  const c0 = b.costs;
  const equityBuild = (c0.demolition + c0.works + c0.fixed + c0.design + c0.insurance + c0.contingency + c0.taxes) * (1 - state.config.bilanParams.loanShare);
  const cashNeeded = (owned ? 0 : landDraft(p) * (1 + state.config.bilanParams.acquisitionFeeRate)) + equityBuild;
  const short = cashNeeded - me().cash;
  const i = proj.indicators;
  const ok = errors.length === 0;
  const verdict = verdictCard(p, proj, landPrice, owned, b, ok, short);
  if (inlineVerdict) html += verdict;
  else lastVerdict = verdict;
  html += `<div class="kpis">
      <div class="kpi"><small>Marge</small><b class="${b.margin >= 0 ? 'good' : 'bad'}">${eur(b.margin)}</b><span class="muted">${pct(b.marginRate)} du CA</span></div>
      <div class="kpi" title="Le terrain est payé comptant. La banque ne finance le terrain (80 %) et les travaux qu'une fois ${Math.round(state.config.presaleThreshold * 100)} % des logements vendus sur plan."><small>Fonds propres</small><b class="${short > 0 ? 'bad' : ''}">${eur(cashNeeded)}</b><span class="muted">${owned ? 'pour lancer' : 'achat compris'}</span></div>
      <div class="kpi"><small>Durée</small><b>${b.quarters} trim.</b><span class="muted">${i.dwellings} logts · ${Math.round(i.sdpTotal)} m²</span></div>
    </div>`;
  html += proj.checks.filter((c) => c.status === 'error' || c.status === 'warn').map((c) => `<div class="check ${c.status === 'error' ? 'bad' : 'warn'}">${esc(c.label)} : ${esc(c.detail)}</div>`).join('');
  if (!ok) html += `<div class="muted" style="font-size:12px">Pour débloquer : réduisez les niveaux, changez le mode de stationnement dans « Options », ou cliquez sur « Meilleur projet ».</div>`;
  if (short > 0) html += `<div class="check bad">Il vous manque ${eur(short)} pour ${owned ? 'lancer' : 'acheter et lancer'} ce projet.</div>`;
  const rows = `<table>
      <tr><td>Surface de plancher</td><td>${Math.round(i.sdpTotal)} m² (${i.levelsCount} niv.)</td></tr>
      <tr><td>Logements</td><td>${i.dwellings} · SHAB ${Math.round(i.shab)} m²</td></tr>
      <tr><td>Implantation</td><td>${proj.placement === 'fond' ? 'en fond de terrain' : 'le long de la rue'}</td></tr>
      <tr><td>Stationnement</td><td>${proj.parking.provided}/${proj.parking.required} places</td></tr>
      <tr><td>Chiffre d’affaires</td><td>${eur(b.revenue.total)}</td></tr>
      <tr><td>Terrain et frais</td><td>${eur(b.costs.land + b.costs.acquisitionFees)}</td></tr>
      <tr><td>Travaux${p.existingSdp ? ' et démolition' : ''}</td><td>${eur(b.costs.works + b.costs.demolition)}</td></tr>
      <tr><td>Coûts fixes d’opération <span class="muted" title="études de sol, géomètre, diagnostics, dossier de permis, garantie d’achèvement, raccordements, installation de chantier : dus quelle que soit la taille">ⓘ</span></td><td>${eur(b.costs.fixed)}</td></tr>
      <tr><td>Autres frais et crédit</td><td>${eur(b.costs.total - b.costs.land - b.costs.acquisitionFees - b.costs.works - b.costs.demolition - b.costs.fixed)}</td></tr>
      <tr class="total"><td>Coût total</td><td>${eur(b.costs.total)}</td></tr>
      <tr><td>Prix de terrain max (marge ${pct(state.config.bilanParams.targetMargin)})</td><td>${eur(b.maxLandPrice)}</td></tr>
    </table>`;
  return html + fold('Détail du bilan', rows);
}

const PHASE_LABEL: Record<string, string> = {
  permis: 'Permis de construire',
  preventes: 'En attente de préventes',
  chantier: 'Chantier',
  livraison: 'Livraison',
};

function operationCard(runId: string): string {
  const r = state.projects.find((x) => x.id === runId);
  if (!r) return '';
  const mineOp = r.owner === ME;
  const owner = state.players.find((p) => p.id === r.owner)!.name;
  const left = lotsLeft(r);
  const sales = expectedSales(state).get(r.id) ?? 0;
  const threshold = Math.round(state.config.presaleThreshold * 100);
  const share = Math.round(soldShare(r) * 100);
  const bar = `<div style="position:relative;height:8px;background:var(--line);border-radius:4px;margin:8px 0 4px"><div style="height:8px;width:${share}%;background:${share >= threshold ? 'var(--good)' : 'var(--accent)'};border-radius:4px"></div><div title="seuil de préventes : ${threshold} %" style="position:absolute;left:${threshold}%;top:-3px;width:2px;height:14px;background:var(--ink)"></div></div>`;
  const stage = r.phase === 'permis' ? `trimestre ${r.phaseElapsed + 1}/${r.permitRounds}` : r.phase === 'chantier' ? `trimestre ${r.phaseElapsed + 1}/${r.buildRounds}` : r.phase === 'livraison' ? 'derniers lots' : 'en attente';
  let html = `<div class="card"><div><b>${esc(r.id)}</b> <span class="muted">${esc(owner)} · ${Math.round(r.sdp)} m²</span></div>
    <div>${PHASE_LABEL[r.phase]} <span class="muted">· ${stage}</span></div>
    ${phaseTimeline(r)}
    ${r.terms ? deliveryBar(r) : ''}
    ${bar}<div>${r.lotsSold}/${r.lots} lots vendus${left ? ` <span class="muted">· ≈ <span data-sales="${esc(r.id)}">${sales.toFixed(1).replace('.', ',')}</span> par trimestre</span>` : ' · tout est vendu'}</div>`;
  html += r.financed ? '<div class="muted">Crédit bancaire débloqué</div>' : `<div class="muted">Crédit débloqué à ${threshold} % vendus${share >= threshold ? '' : ` · encore ${Math.max(1, Math.ceil(r.lots * state.config.presaleThreshold) - r.lotsSold)} lot(s)`}</div>`;
  if (mineOp) {
    const lm = expectedMargin(state, r);
    html += `<div title="Estimation : prix du lancement ajusté du marché et de votre prix de vente sur les lots restants (les ventes plus lentes coûtent en plus des intérêts)">Marge attendue <b data-margin="${esc(r.id)}" class="${lm.margin >= 0 ? 'good' : 'bad'}">${eur(lm.margin)}</b> <span class="muted"><span data-margin-rate="${esc(r.id)}">${pct(lm.rate)}</span>${r.extraCost ? ` · surcoûts ${eur(r.extraCost)}` : ''}</span></div>`;
    if (left > 0)
      html += `<label class="f" title="Une remise vend plus vite ; une prime ralentit les ventes">Prix de vente <span><input type="range" data-price="${esc(r.id)}" min="${MIN_PRICE_POLICY * 100}" max="${MAX_PRICE_POLICY * 100}" step="1" value="${Math.round(r.pricePolicy * 100)}"> <b data-pct="${esc(r.id)}">${r.pricePolicy > 0 ? '+' : ''}${Math.round(r.pricePolicy * 100)} %</b> <span class="muted">(≈ <span data-lot="${esc(r.id)}">${eur(lotPrice(state, r))}</span>/lot)</span></span></label>`;
  }
  return html + '</div>';
}

/** Marché foncier : mes offres et les terrains mis en vente. */
function renderMarche(): string {
  drawOverlay(null);
  const mine = state.offers.filter((o) => o.player === ME);
  const listed = state.plots.filter((p) => p.owner === null && p.listing).sort((a, b) => a.listing!.until - b.listing!.until || b.askingPrice - a.askingPrice);
  const row = (p: Plot) => {
    const rule = ruleOf(p);
    const o = offerOf(state, p.id, ME);
    return `<tr class="${o ? 'me' : ''}"><td><a href="#" data-goto="${esc(p.id)}">${esc(shortLabel(p).replace(/ · \d+ m²$/, ''))}</a><div class="muted" style="font-size:11px">${Math.round(areaOf(p))} m²${rule ? ` · ${esc(rule.label)}${rule.buildable ? ` R+${rule.maxLevels}` : ''}` : ''}</div></td><td class="num">${eur(p.listing!.minPrice)}</td><td class="num">${quarterLabel(p.listing!.until - 1)}<div class="muted" style="font-size:11px">${offersOn(state, p.id).length} offre(s)${o ? ' · la vôtre' : ''}</div></td></tr>`;
  };
  const myRows = mine
    .map((o) => {
      const p = plotById(o.plot)!;
      return `<div class="card"><a href="#" data-goto="${esc(p.id)}">${esc(shortLabel(p))}</a> <b>${eur(o.price)}</b><div class="muted">${o.bundle ? '<b>offre groupée « tout ou rien »</b> · ' : ''}${p.listing ? `mise en vente · réponse après ${quarterLabel(p.listing.until - 1)}` : 'prospection · réponse à la fin du trimestre'} · ${eur(o.reserved)} bloqués</div><button data-withdraw="${esc(p.id)}">${o.bundle ? 'Retirer le groupe' : 'Retirer'}</button></div>`;
    })
    .join('');
  return `<h2>Mes offres (${mine.length})</h2>${myRows || '<p class="muted">Aucune offre en cours. Choisissez un terrain en vente ci-dessous, ou prospectez un autre terrain depuis la carte.</p>'}
    ${mine.length ? `<p class="muted" style="font-size:12px">${eur(committedCash(state, ME))} sont bloqués sur votre trésorerie tant que les offres sont ouvertes.</p>` : ''}
    <h2>Terrains en vente (${listed.length})</h2>
    ${listed.length ? `<table class="rank"><tr><td class="muted">Terrain</td><td class="num muted">Départ</td><td class="num muted">Échéance</td></tr>${listed.slice(0, 40).map(row).join('')}</table>` : '<p class="muted">Aucun terrain en vente pour le moment : de nouveaux arrivent chaque trimestre.</p>'}
    <p class="muted" style="font-size:12px">Les offres sont sous pli fermé. À l’échéance, le plus offrant remporte le terrain (à égalité, le premier arrivé) ; les autres sont remboursés.</p>`;
}

function renderOperations(): string {
  drawOverlay(null);
  const mine = state.projects.filter((r) => r.owner === ME);
  const holdings = state.plots.filter((p) => p.owner === ME && !p.projectId);
  const watches = watchList(state, ME).filter((w) => /^(launch|delivery|presales|debt):/.test(w.id + ':'));
  return `${watches.length ? `<h2>À surveiller</h2>${renderWatch(watches)}` : ''}<h2>Mes opérations (${mine.length})</h2>${mine.map((r) => operationCard(r.id)).join('') || '<p class="muted">Aucune opération en cours.</p>'}
    <h2>Mes terrains libres (${holdings.length})</h2>
    ${holdings.map((p) => `<div class="card"><a href="#" data-goto="${esc(p.id)}">${esc(p.label ?? p.id)}</a><div class="muted">payé ${eur(p.paid)} · portage ${eur(p.paid * state.config.holdingCostRate)}/trim.</div></div>`).join('') || '<p class="muted">Aucun.</p>'}`;
}

function renderJournal(): string {
  drawOverlay(null);
  const items = state.log.slice(-60).reverse();
  return `<h2>Journal</h2><ul class="log">${items.map((e) => `<li><span class="muted">${quarterLabel(e.round)}</span> ${esc(e.text)}</li>`).join('') || '<li class="muted">Rien pour le moment.</li>'}</ul>`;
}

function renderRanking(): string {
  drawOverlay(null);
  const r = currentRanking();
  const k = r.findIndex((x) => x.player === ME);
  return `<h2>${state.over ? 'Classement final' : 'Classement'}</h2>
    <div id="tab-podium"></div>
    <p class="rank-gap">${rankGapText(r, k)}</p>
    <p class="muted">Patrimoine = trésorerie + terrains (au prix de reprise) + fonds propres engagés, moins les dettes. Départ : ${eurFull(state.config.startCash)}.</p>`;
}

function bindSelection() {
  const side = $('side');
  const on = (id: string, f: () => void) => {
    const el = side.querySelector<HTMLElement>(`#${id}`);
    if (el) el.onclick = f;
  };
  const first = [...selected][0];
  on('toTender', () => ((tab = 'commune'), renderAll()));
  on('buy', () => act({ type: 'buy', player: ME, plot: first }) && renderAll());
  on('sell', () => act({ type: 'sellPlot', player: ME, plot: first }) && renderAll());
  on('launch', () => {
    if (act({ type: 'launch', player: ME, plot: first, criteria: criteria() })) {
      toast('Opération lancée');
      renderAll();
    }
  });
  on('buyAll', () => {
    for (const id of selected) if (!act({ type: 'buy', player: ME, plot: id })) break;
    renderAll();
  });
  on('merge', () => {
    const ids = [...selected];
    if (act({ type: 'merge', player: ME, plots: ids })) {
      selected = new Set([ids.sort().join('+')]);
      toast('Parcelles assemblées');
      renderAll();
    }
  });
  side.querySelectorAll<HTMLButtonElement>('[data-rm]').forEach((b) => (b.onclick = () => (selected.delete(b.dataset.rm!), renderAll())));
  side.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((b) => (b.onclick = () => {
      if (b.dataset.base) selected.add(b.dataset.base);
      selected.add(b.dataset.add!);
      multi = true;
      syncMultiBox();
      renderAll();
    }));
  side.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((b) => (b.onclick = () => ((offerLevel = b.dataset.level as typeof offerLevel), renderAll())));
  on('bundle', () => {
    const plots = [...selected].map((id) => plotById(id)).filter((p): p is Plot => !!p);
    const offers = plots.filter((p) => !p.owner && !offerOf(state, p.id, ME)).map((p) => ({ plot: p.id, price: bidFor(p) }));
    const extra = plots.filter((p) => p.owner === ME).map((p) => p.id);
    if (act({ type: 'bundleOffer', player: ME, offers, extra })) {
      toast('Offre groupée déposée : réponse à la fin du trimestre. Tout ou rien, puis assemblage automatique.');
      renderAll();
    }
  });
  on('prospectAll', () => {
    const rate = state.config.bilanParams.acquisitionFeeRate;
    void rate;
    let ok = 0;
    let failed = 0;
    for (const id of selected) {
      const p = plotById(id);
      if (!p || p.owner || p.municipal || p.issue === 'zone' || offerOf(state, id, ME)) continue;
      const r = applyAction(state, { type: 'offer', player: ME, plot: id, price: defaultBid(p) });
      if (r.ok) {
        state = r.state;
        ok++;
      } else failed++;
    }
    save();
    toast(`${ok} offre${ok > 1 ? 's' : ''} déposée${ok > 1 ? 's' : ''}${failed ? ` · ${failed} refusée${failed > 1 ? 's' : ''} (fonds ou règles)` : ''} : réponse à la fin du trimestre (ou à l’échéance de la mise en vente)`, failed > 0 && ok === 0);
    renderAll();
  });
  on('clear', () => ((selected = new Set()), renderAll()));
  const bidInput = side.querySelector<HTMLInputElement>('#bid');
  if (bidInput) bidInput.onchange = () => ((bidDraft[first] = Math.max(0, Math.round(+bidInput.value || 0))), renderAll());
  on('offer', () => {
    const price = +(side.querySelector<HTMLInputElement>('#bid')?.value ?? 0);
    if (act({ type: 'offer', player: ME, plot: first, price })) {
      toast(isListed(plotById(first)!) ? 'Offre déposée : réponse à l’échéance de la mise en vente' : 'Prospection lancée : réponse à la fin du trimestre');
      delete bidDraft[first];
      renderAll();
    }
  });
  on('withdraw', () => act({ type: 'withdraw', player: ME, plot: first }) && (toast('Offre retirée, somme débloquée'), renderAll()));
  side.querySelectorAll<HTMLButtonElement>('[data-withdraw]').forEach((b) => (b.onclick = () => act({ type: 'withdraw', player: ME, plot: b.dataset.withdraw! }) && renderAll()));
  const how2 = side.querySelector<HTMLButtonElement>('#howto2');
  if (how2) how2.onclick = () => openTutorial();
  side.querySelectorAll<HTMLInputElement>('[data-price]').forEach((el) => {
    const id = el.dataset.price!;
    // En temps réel : le pourcentage, le prix du lot et le rythme de vente attendu suivent le curseur pendant qu'on le déplace.
    el.oninput = () => {
      if (!act({ type: 'setPrice', player: ME, project: id, policy: +el.value / 100 })) return;
      const run = state.projects.find((x) => x.id === id);
      if (!run) return;
      const set = (attr: string, text: string) => {
        const t = side.querySelector<HTMLElement>(`[${attr}="${id}"]`);
        if (t) t.textContent = text;
      };
      const v = Math.round(run.pricePolicy * 100);
      set('data-pct', `${v > 0 ? '+' : ''}${v} %`);
      set('data-lot', eur(lotPrice(state, run)));
      set('data-sales', (expectedSales(state).get(id) ?? 0).toFixed(1).replace('.', ','));
      // La marge attendue suit le prix de vente en direct.
      const lm = expectedMargin(state, run);
      set('data-margin', eur(lm.margin));
      set('data-margin-rate', pct(lm.rate));
      side.querySelector(`[data-margin="${id}"]`)?.setAttribute('class', lm.margin >= 0 ? 'good' : 'bad');
    };
    el.onchange = () => renderAll(); // met à jour aussi les autres opérations (la demande se partage)
  });
  const dp = side.querySelector<HTMLSelectElement>('#f-depth');
  if (dp) dp.onchange = () => ((form.depth = +dp.value), renderAll());
  const bestBtn = side.querySelector<HTMLButtonElement>('#best');
  if (bestBtn)
    bestBtn.onclick = () => {
      const p = simPlot ?? plotById([...selected][0]);
      const found = p ? bestForm(p, p.id !== SIM_ID && p.owner === ME) : null;
      if (!found) return toast('Aucun projet réalisable sur ce terrain avec ces réglages : essayez un autre mode de stationnement ou assemblez-le.', true);
      form.levels = found.levels;
      form.attic = found.attic;
      if (found.single) form.second = false;
      form.housing = found.housing;
      form.parking = 'auto';
      toast(`Meilleur projet : ${found.housing === 'maison' ? 'maisons, ' : ''}R+${found.levels}${found.attic ? ' avec attique' : ''}${found.buildings > 1 ? `, ${found.buildings} bâtiments` : found.single ? ', un seul bâtiment' : ''}, ${eur(found.margin)} de marge`);
      renderAll();
    };
  const pf = side.querySelector<HTMLSelectElement>('#pfilter');
  if (pf) pf.onchange = () => ((plotFilter = pf.value as typeof plotFilter), renderAll());
  const viewSel = side.querySelector<HTMLSelectElement>('#view');
  if (viewSel) viewSel.onchange = () => ((view = viewSel.value as typeof view), applyView(), renderAll());
  const multiBox = side.querySelector<HTMLInputElement>('#multi');
  if (multiBox) multiBox.onchange = () => (multi = multiBox.checked);
  const lv = side.querySelector<HTMLSelectElement>('#f-levels');
  if (lv) lv.onchange = () => ((form.levels = +lv.value), renderAll());
  const at = side.querySelector<HTMLInputElement>('#f-attic');
  if (at) at.onchange = () => ((form.attic = at.checked), renderAll());
  const hs = side.querySelector<HTMLSelectElement>('#f-housing');
  if (hs) hs.onchange = () => ((form.housing = hs.value as HousingType), renderAll());
  const sec = side.querySelector<HTMLInputElement>('#f-second');
  if (sec) sec.onchange = () => ((form.second = sec.checked), renderAll());
  const secLv = side.querySelector<HTMLSelectElement>('#f-second-levels');
  if (secLv) secLv.onchange = () => ((form.secondLevels = secLv.value === '' ? null : +secLv.value), renderAll());
  const mixFoldEl = side.querySelector<HTMLDetailsElement>('#mix-fold');
  if (mixFoldEl) mixFoldEl.ontoggle = () => (mixOpen = mixFoldEl.open);
  side.querySelectorAll<HTMLInputElement>('[data-mix]').forEach((inp) => {
    inp.onchange = () => {
      const next = { ...(form.mix ?? state.config.market.demandMix ?? criteria().mix) } as Record<Typology, number>;
      for (const i of side.querySelectorAll<HTMLInputElement>('[data-mix]')) next[i.dataset.mix as Typology] = Math.max(0, Math.min(100, +i.value || 0)) / 100;
      form.mix = TYPOS.some((t) => next[t] > 0) ? next : null;
      renderAll();
    };
  });
  const mixMarket = side.querySelector<HTMLButtonElement>('#mix-market');
  if (mixMarket) mixMarket.onclick = () => ((form.mix = null), renderAll());
  const mixDefault = side.querySelector<HTMLButtonElement>('#mix-default');
  if (mixDefault) mixDefault.onclick = () => ((form.mix = { ...DEFAULT_CRITERIA.mix }), renderAll());
  const plc = side.querySelector<HTMLSelectElement>('#f-placement');
  if (plc) plc.onchange = () => ((form.placement = plc.value as Placement), renderAll());
  const shp = side.querySelector<HTMLSelectElement>('#f-shape');
  if (shp) shp.onchange = () => ((form.shape = shp.value as FootprintShape), renderAll());
  const pk = side.querySelector<HTMLSelectElement>('#f-parking');
  if (pk) pk.onchange = () => ((form.parking = pk.value as ParkingStrategy), renderAll());
  side.querySelectorAll<HTMLAnchorElement>('[data-goto]').forEach(
    (a) =>
      (a.onclick = (e) => {
        e.preventDefault();
        selected = new Set([a.dataset.goto!]);
        tab = 'terrain';
        const p = plotById(a.dataset.goto!);
        if (p) map.panTo([p.parcel.ring[0].lat, p.parcel.ring[0].lon]);
        renderAll();
      }),
  );
}

function renderAll() {
  renderTop();
  renderPills();
  drawPlots();
  renderSide();
  updateMapCard();
}

/** Fenêtre « Version et nouveautés » : numéro de bêta, build et ce qui a changé. */
const release = (r: (typeof CHANGELOG)[number]) => `<h3 class="rel">${esc(r.version)} · ${esc(r.title)}</h3><ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;

function openVersion() {
  markNotesSeen();
  openModal(
    `<h2 class="mh">Urbasim · bêta ${esc(VERSION)}</h2>
     <p class="muted">Build <b>${esc(BUILD)}</b> · ${esc(__APP_DATE__)} · ${esc(__APP_COMMIT__)}<br>Le numéro de build monte à chaque mise à jour publiée : s’il change, une nouvelle version est en ligne.</p>
     <div class="tuto">${CHANGELOG.slice(0, 2).map(release).join('')}${CHANGELOG.length > 2 ? `<details class="fold"><summary>Versions précédentes (${CHANGELOG.length - 2})</summary><div class="foldbody">${CHANGELOG.slice(2).map(release).join('')}</div></details>` : ''}</div>
     <div class="row" style="margin-top:12px"><span class="spacer"></span><button id="vr-ok" type="button" class="primary">Fermer</button></div>`,
    (root) => (root.querySelector<HTMLButtonElement>('#vr-ok')!.onclick = closeModal),
  );
}

/** Mémorise la version ouverte ; les nouveautés se signalent par l'icône de l'accueil (plus de grande fenêtre à chaque mise à jour). */
function announceUpdate() {
  try {
    localStorage.setItem(BUILD_KEY, `${VERSION}|${BUILD}`);
  } catch {
    /* stockage indisponible */
  }
}

/** Fenêtre « Crédits et données » : sources et licences, hors de l'écran de jeu. */
function openCredits() {
  openModal(
    `<h2 class="mh">Crédits et données</h2>
     <div class="tuto"><ul>${district.credits.map((c) => `<li>${esc(c)}</li>`).join('')}<li>Police : Alte Haas Grotesk</li><li>${NO_TILES ? 'Voies : IGN, BD TOPO® (Licence Ouverte 2.0)' : 'Fond de carte : © contributeurs OpenStreetMap (licence ODbL)'}</li></ul>
     <p class="muted">Urbasim est un jeu en version bêta : les prix, les coûts et les règles d’urbanisme sont des ordres de grandeur, pas une expertise.</p></div>
     <div class="row" style="margin-top:12px"><span class="spacer"></span><button id="cr-ok" type="button" class="primary">Fermer</button></div>`,
    (root) => (root.querySelector<HTMLButtonElement>('#cr-ok')!.onclick = closeModal),
  );
}
/** Carte agrandie : le panneau latéral se masque, une fiche flottante résume le terrain choisi. */
let mapExpanded = false;
const mapFull = new L.Control({ position: 'topleft' });
mapFull.onAdd = () => {
  const el = L.DomUtil.create('div', 'leaflet-bar mapfull');
  el.innerHTML = '<a href="#" id="mapfull-btn" role="button" title="Agrandir la carte" aria-label="Agrandir la carte">⤢</a>';
  L.DomEvent.disableClickPropagation(el);
  el.querySelector('a')!.onclick = (e) => (e.preventDefault(), setMapExpanded(!mapExpanded));
  return el;
};
function setMapExpanded(on: boolean) {
  mapExpanded = on;
  $('app').classList.toggle('mapfull', on);
  const btn = document.getElementById('mapfull-btn');
  if (btn) {
    btn.textContent = on ? '⤡' : '⤢';
    btn.title = on ? 'Réduire la carte' : 'Agrandir la carte';
  }
  setTimeout(() => map.invalidateSize(), 60);
  updateMapCard();
}
/** Fiche flottante du terrain choisi quand la carte est agrandie. */
function updateMapCard() {
  let card = document.getElementById('mapcard');
  if (!mapExpanded || selected.size === 0) return card?.remove();
  if (!card) {
    card = document.createElement('div');
    card.id = 'mapcard';
    card.className = 'mapcard';
    L.DomEvent.disableClickPropagation(card);
    $('map').appendChild(card);
  }
  const plots = [...selected].map((id) => plotById(id)).filter((p): p is Plot => !!p);
  if (!plots.length) return card.remove();
  const p = plots[0];
  card.innerHTML = plots.length > 1
    ? `<b>${plots.length} parcelles</b> <span class="muted">· ${Math.round(plots.reduce((s, x) => s + areaOf(x), 0))} m²</span><div class="row"><button id="mc-open" class="primary">Ouvrir la fiche</button><button id="mc-close">✕</button></div>`
    : `<div class="head"><b>${esc(shortLabel(p).replace(/ · \d+ m²$/, ''))}</b> ${statusPill(p)}</div><div class="muted">${Math.round(areaOf(p))} m² · ${eur(p.askingPrice)} · ${Math.round(p.askingPrice / areaOf(p))} €/m²${p.zones.length ? ` · ${esc(ruleOf(p)!.label)} R+${ruleOf(p)!.maxLevels}` : ''}</div><div class="row"><button id="mc-open" class="primary">Ouvrir la fiche</button><button id="mc-close">✕</button></div>`;
  card.querySelector<HTMLButtonElement>('#mc-open')!.onclick = () => setMapExpanded(false);
  card.querySelector<HTMLButtonElement>('#mc-close')!.onclick = () => ((selected = new Set()), renderAll());
}
mapFull.addTo(map);
mapLegend.addTo(map);
mapTools.addTo(map);
pillStack.addTo(map);
fitDistrict();
applyView();
syncToolbar();
renderAll();
showHome();
pillsReady = true; // à partir d'ici, toute nouveauté non lue est annoncée par sa pastille
try {
  // On vient de choisir une autre carte : on enchaîne sur la création de la société.
  if (sessionStorage.getItem(NEW_KEY)) {
    sessionStorage.removeItem(NEW_KEY);
    openIdentity('new');
  }
} catch {
  /* stockage indisponible */
}
announceUpdate();
document.getElementById('boot')?.setAttribute('hidden', '');

// Outils de test automatisé (serveur de développement uniquement).
if (import.meta.env.DEV) {
  (window as any).__urbasim = {
    state: () => state,
    patch: (f: (s: GameState) => GameState) => ((state = f(state)), renderAll()),
    toEnd: () => {
      while (!state.over) advanceOne();
      afterAdvance('');
    },
    zoomTo: (id: string) => { const p = plotById(id); if (p) map.fitBounds(L.latLngBounds(p.parcel.ring.map((q) => [q.lat, q.lon] as [number, number])), { maxZoom: 19, padding: [120, 120] }); },
    select: (ids: string[]) => ((selected = new Set(ids)), (tab = 'terrain'), renderAll()),
    /** Premières paires de parcelles libres, petites et assemblables. */
    mergeablePairs: (max = 5) => {
      const free = state.plots.filter((p) => !p.owner && areaOf(p) > 80 && areaOf(p) < 400);
      const out: string[][] = [];
      for (let i = 0; i < free.length && out.length < max; i++)
        for (let j = i + 1; j < free.length && out.length < max; j++)
          if (mergeParcels([free[i].parcel, free[j].parcel]).ok) out.push([free[i].id, free[j].id]);
      return out;
    },
  };
}

// Mode caché : taper « motherlode » hors d'un champ de saisie.
{
  let typed = '';
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key.length !== 1) return;
    typed = (typed + e.key.toLowerCase()).slice(-10);
    if (typed !== 'motherlode' || !state) return;
    typed = '';
    state = { ...state, players: state.players.map((p) => (p.id === ME ? { ...p, cash: 1_000_000_000 } : p)) };
    save();
    renderAll();
    toast('Mode argent illimité activé');
  });
}
