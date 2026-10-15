import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import {
  DEFAULT_CRITERIA,
  LocalProjection,
  MARKETS,
  QUALITY_COST,
  QUALITY_PREMIUM,
  computeBilan,
  computeProject,
  type Criteria,
  type ParkingStrategy,
} from '../../moteur/src/engine';
import {
  ISSUE_MESSAGE,
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
  MAX_PRICE_POLICY,
  MIN_PRICE_POLICY,
  applyAction,
  createGame,
  currentMarket,
  currentParams,
  LOCATION_RULES,
  districtToSeeds,
  expectedSales,
  lotsLeft,
  lotPrice,
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
import districtData from '../../moteur/data/districts/montreuil-mairie.json';

const district = districtData as unknown as District;
const ME = 'moi';
const SAVE_KEY = 'urbasim-save-v5';
const FALLBACK_COLORS: Record<string, string> = { moi: PALETTE[0], prudent: PALETTE[1], equilibre: PALETTE[2], agressif: PALETTE[3] };
const PROFILE_LABEL: Record<string, string> = { prudent: 'prudent', equilibre: 'équilibré', agressif: 'agressif' };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const eur = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(2).replace('.', ',')} M€` : `${Math.round(n / 1000).toLocaleString('fr-FR')} k€`);
const eurFull = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;
const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')} %`;
const TUTO_KEY = 'urbasim-tuto-v1';

// ---------------------------------------------------------------- état

function newGame(identity: Identity, difficulty: Difficulty = 'normal', seed = Date.now() % 100000): GameState {
  const bots = botIdentities(seed, identity);
  const bot = (id: 'prudent' | 'equilibre' | 'agressif', i: number) => ({ id, name: bots[i].name, bot: true as const, profile: id, color: bots[i].color, slogan: bots[i].slogan });
  return createGame({
    players: [{ id: ME, name: identity.name, color: identity.color, slogan: identity.slogan }, bot('prudent', 0), bot('equilibre', 1), bot('agressif', 2)],
    plots: districtToSeeds(district),
    config: { market: MARKETS[district.market], ...campaignConfig(difficulty) },
    seed,
  });
}

/** Partie sauvegardée, ou null (première visite ou sauvegarde périmée). */
function load(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as GameState;
      if (s?.players?.some((p) => p.id === ME) && Array.isArray(s.plots) && typeof s.demandShock === 'number' && s.config?.salesDemand > 0 && s.plots.every((p) => Array.isArray(p.zones)) && Array.isArray(s.offers) && Array.isArray(s.tenders) && s.players.every((p) => typeof p.debt === 'number')) return s;
    }
  } catch {
    /* sauvegarde absente ou illisible : nouvelle partie */
  }
  return null;
}

const saved = load();
/** Vrai dès qu'une partie existe (sauvegardée ou lancée pendant cette session) : l'écran d'accueil propose alors de la reprendre. */
let gameStarted = saved !== null;
/** Sans sauvegarde, une partie provisoire s'affiche derrière la fenêtre de création de société. */
let state: GameState = saved ?? newGame(randomIdentity(Date.now() % 100000), 'normal', 1);
const colorOf = (id: string) => state.players.find((p) => p.id === id)?.color ?? FALLBACK_COLORS[id] ?? '#888';
const shortName = (n: string) => (n.length > 16 ? `${n.slice(0, 15)}…` : n);
let selected = new Set<string>();
let multi = false;
let tab: 'terrain' | 'marche' | 'commune' | 'operations' | 'journal' | 'classement' = 'terrain';
let view: 'hauteur' | 'prix' | 'lieu' | 'zonage' = 'hauteur';
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
let form: { levels: number; attic: boolean; parking: ParkingStrategy; depth: number } = { levels: 3, attic: false, parking: 'auto', depth: 12 };

function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
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
const plotById = (id: string) => state.plots.find((p) => p.id === id);
const quarterLabel = (round: number) => `T${(round % 4) + 1} ${2027 + Math.floor(round / 4)}`;
const criteria = (): Criteria => ({ ...DEFAULT_CRITERIA, levels: form.levels, attic: form.attic, parkingStrategy: form.parking, maxDepth: form.depth });

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
  else toast(message);
  renderAll();
  if (state.over) return openEndScreen();
  // Les aléas et verdicts importants s'affichent dans une fenêtre, un par un.
  const popups = state.log.slice(before).filter((e) => e.popup && isRelevant(e, ME) && (e.player === ME || !e.player));
  if (popups.length) showPopups(popups);
}

function endTurn() {
  if (state.over) return;
  const before = state.log.length;
  const { mine } = advanceOne();
  afterAdvance(`${quarterLabel(state.round)}${mine.length ? ` — ${mine.length} nouvelle${mine.length > 1 ? 's' : ''} pour vous` : ''}`, before);
}

/** Avance jusqu'à ce qu'il se passe quelque chose pour vous (étape d'une opération, aléa), au plus 8 trimestres. */
function fastForward() {
  if (state.over) return;
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

const map = L.map('map', { zoomControl: true, preferCanvas: false });
/** Sans fond de plan (page hébergée où les images externes sont bloquées) : on dessine les voies du quartier. */
const NO_TILES = import.meta.env.VITE_NO_TILES === '1';
if (!NO_TILES) {
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 19, attribution: '© contributeurs OpenStreetMap' }).addTo(map);
} else {
  map.createPane('routes');
  map.getPane('routes')!.style.zIndex = '300';
  map.getPane('routes')!.style.pointerEvents = 'none';
  const widths = [0, 8, 7, 5, 3.5, 2.5, 1.5];
  for (const r of [...(district.roads ?? [])].sort((a, b) => b.importance - a.importance)) {
    L.polyline(r.line.map(([lon, lat]) => [lat, lon] as [number, number]), { pane: 'routes', interactive: false, className: 'road', weight: widths[r.importance] ?? 2, lineCap: 'round' }).addTo(map);
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
  if (p.municipal && !p.owner) return { color: sel ? '#000' : '#0f8b8d', weight: sel ? 3 : 2.5, fillColor: '#7fd1d3', fillOpacity: 0.55, dashArray: '6 3' };
  const col = ownerColor(p);
  const ppm = p.askingPrice / Math.max(1, areaOf(p));
  // Terrains libres : plus le prix au m² est élevé, plus la teinte est foncée (échelle = 10e–90e centile des terrains libres).
  const [lo, hi] = ppmRange;
  const t = Math.min(1, Math.max(0, (ppm - lo) / Math.max(1, hi - lo)));
  const free = `hsl(${40 - 30 * t} 80% ${78 - 28 * t}%)`;
  const lieu = view === 'lieu';
  const freePlot = !p.owner;
  const small = !!p.issue;
  // Terrains libres hors de portée (trop chers pour moi) ou écartés par le filtre : estompés.
  const zoneBlocked = p.issue === 'zone';
  const listed = freePlot && isListed(p);
  const dim = freePlot && (plotFilter === 'abordables' ? !affordable(p) : plotFilter === 'assembler' ? !small : plotFilter === 'vente' ? !listed : false);
  const faded = freePlot && !affordable(p) && !small;
  const base: L.PathOptions = {
    color: sel ? '#000' : listed ? '#c98200' : zoneBlocked && freePlot ? '#777' : small && freePlot ? '#7b3fa0' : col ?? (view === 'hauteur' ? '#2b6cb0' : '#7a6b4f'),
    weight: sel ? 3 : p.projectId ? 2.5 : listed ? 3 : small ? 1.8 : view === 'hauteur' ? 1.5 : 1,
    fillColor: col ?? (listed && view !== 'prix' && view !== 'lieu' ? '#f6d27a' : zoneBlocked ? '#bdbdbd' : small ? '#cdb6e6' : lieu ? lieuColor(p.locationFactor) : free),
    // Vue « hauteur » : les parcelles libres restent transparentes pour laisser voir le bâti.
    fillOpacity: col ? (p.projectId ? 0.16 : view === 'hauteur' || view === 'zonage' ? 0.35 : 0.55) : listed ? 0.45 : zoneBlocked ? 0.35 : small ? 0.5 : view === 'hauteur' || view === 'zonage' ? 0 : lieu ? 0.8 : 0.45,
    dashArray: p.projectId ? '4 3' : small ? '2 4' : undefined,
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
const POI_COLORS: Record<string, string> = { metro: '#0b5fa5', gare: '#0b5fa5', tram: '#2f9e8f', mairie: '#8e24aa', ecole: '#e6a817', superieur: '#e6a817', parc: '#2e8b57', sante: '#d62839' };
const poiLayer = L.layerGroup();
for (const poi of district.pois) {
  L.circleMarker([poi.lat, poi.lon], { radius: poi.kind === 'metro' || poi.kind === 'gare' || poi.kind === 'mairie' ? 8 : 5, color: '#fff', weight: 1.5, fillColor: POI_COLORS[poi.kind] ?? '#555', fillOpacity: 1 })
    .bindTooltip(`${esc(LOCATION_RULES[poi.kind].label)} : ${esc(poi.name)}`)
    .addTo(poiLayer);
}

map.createPane('zones');
map.getPane('zones')!.style.zIndex = '330';
map.getPane('zones')!.style.pointerEvents = 'none';
const zonesLayer = L.layerGroup();
for (const z of district.zones ?? []) {
  for (const ring of z.rings) {
    L.polygon(ring.map(([lon, lat]) => [lat, lon] as [number, number]), { pane: 'zones', interactive: false, stroke: true, color: ZONE_RULES[z.family].color, weight: 1, opacity: 0.8, fillColor: ZONE_RULES[z.family].color, fillOpacity: 0.38 })
      .bindTooltip(`${esc(z.code)} · ${esc(ZONE_RULES[z.family].label)}`, { sticky: true })
      .addTo(zonesLayer);
  }
}

map.createPane('bati');
map.getPane('bati')!.style.zIndex = '350';
map.getPane('bati')!.style.pointerEvents = 'none';
const buildingsLayer = L.layerGroup();
/** Bâti d'origine, avec son centre : il disparaît de la carte quand une opération le démolit. */
const existingBuildings: { layer: L.Polygon; cx: number; cy: number; hidden: boolean }[] = [];
for (const b of district.buildings) {
  const layer = L.polygon(b.ring.map(([lon, lat]) => [lat, lon] as [number, number]), {
    pane: 'bati',
    interactive: false,
    stroke: true,
    color: '#3b2a1a',
    weight: 0.5,
    opacity: 0.6,
    fillColor: heightColor(b.height),
    fillOpacity: b.estimated ? 0.7 : 0.9,
  }).addTo(buildingsLayer);
  existingBuildings.push({ layer, cx: b.ring.reduce((t, q) => t + q[0], 0) / b.ring.length, cy: b.ring.reduce((t, q) => t + q[1], 0) / b.ring.length, hidden: false });
}

// Bâtiments des promoteurs : opérations en cours et livrées, dessinés à l'emplacement réel de leur emprise.
map.createPane('bati2');
map.getPane('bati2')!.style.zIndex = '360';
map.getPane('bati2')!.style.pointerEvents = 'none';
const builtLayer = L.layerGroup().addTo(map);
const footprintCache = new Map<string, [number, number][] | null>();
let hiddenKey = '';

/** Emprise d'un projet sur la carte ([lat, lon]), mémorisée : le calcul géométrique est coûteux. */
function footprintOf(p: Plot, criteria: Criteria, key: string): [number, number][] | null {
  let ring = footprintCache.get(key);
  if (ring === undefined) {
    const project = computeProject(p.parcel, criteria);
    if (project.footprint) {
      const proj = new LocalProjection(project.origin.lon, project.origin.lat);
      ring = project.footprint.map((v) => proj.toLonLat(v)).map((q) => [q.lat, q.lon] as [number, number]);
    } else ring = null;
    footprintCache.set(key, ring);
  }
  return ring;
}

const PHASE_STYLE: Record<string, { opacity: number; dash?: string }> = {
  permis: { opacity: 0.22, dash: '3 3' },
  preventes: { opacity: 0.35, dash: '3 3' },
  chantier: { opacity: 0.62, dash: '6 2' },
  livraison: { opacity: 0.88 },
};

/** Les bâtiments des joueurs remplacent le bâti d'origine des terrains qu'ils développent. */
function drawBuildings() {
  const developed = state.plots.filter((p) => p.projectId || p.built?.length);
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
  builtLayer.clearLayers();
  const add = (ring: [number, number][], owner: string, height: number, phase: string) => {
    const st = PHASE_STYLE[phase];
    const col = colorOf(owner);
    L.polygon(ring, {
      pane: 'bati2',
      interactive: false,
      color: col,
      weight: phase === 'livraison' ? 2 : 2.5,
      opacity: 1,
      dashArray: st.dash,
      fillColor: view === 'hauteur' ? heightColor(height) : col,
      fillOpacity: st.opacity,
    }).addTo(builtLayer);
  };
  for (const p of developed) {
    const run = p.projectId ? state.projects.find((r) => r.id === p.projectId) : undefined;
    if (run) {
      const ring = footprintOf(p, run.criteria, `${p.id}|${run.id}`);
      if (ring) add(ring, run.owner, run.height, run.phase);
    } else {
      for (const b of p.built ?? []) {
        const ring = footprintOf(p, b.criteria, `${p.id}|${b.runId}`);
        if (ring) add(ring, b.owner, b.height, 'livraison');
      }
    }
  }
}

const mapLegend = new L.Control({ position: 'bottomleft' });
mapLegend.onAdd = () => L.DomUtil.create('div', 'map-legend');
let legendOpen = window.innerWidth > 800;
function updateMapLegend() {
  const el = mapLegend.getContainer();
  if (!el) return;
  if (view === 'hauteur') {
    el.innerHTML = `<b>Hauteur du bâti existant</b>${HEIGHT_CLASSES.map((c) => `<div><i class="swatch" style="background:${c.color}"></i>${c.label}</div>`).join('')}`;
  } else if (view === 'zonage') {
    el.innerHTML = `<b>Règles d’urbanisme (PLU simplifié)</b>${(['renouvellement', 'centre', 'mixte', 'preservation', 'activites', 'equipement'] as const)
      .map((f) => {
        const r = ZONE_RULES[f];
        return `<div><i class="swatch" style="background:${r.color}"></i>${esc(r.label)} · ${r.buildable ? `R+${r.maxLevels}${r.use === 'bureaux' ? ' bureaux' : ''}` : 'inconstructible'}</div>`;
      })
      .join('')}`;
  } else if (view === 'lieu') {
    const ramp = [0.95, 0.98, 1, 1.03, 1.06, 1.09].map((f) => `<i class="swatch" style="background:${lieuColor(f)};width:18px"></i>`).join('');
    const kinds = ['metro', 'tram', 'mairie', 'ecole', 'parc', 'sante'].map((k) => `<span><i class="swatch" style="background:${POI_COLORS[k]}"></i>${k === 'ecole' ? 'école' : k === 'sante' ? 'hôpital' : k === 'parc' ? 'espace public' : k === 'mairie' ? 'mairie' : k === 'tram' ? 'tramway' : 'métro'}</span>`).join(' ');
    el.innerHTML = `<b>Valeur du lieu (prix de vente)</b><div>${ramp}</div><div class="muted">moins cher ← quartier médian → plus cher</div><div style="margin-top:3px">${kinds}</div>`;
  } else {
    el.innerHTML = `<b>Prix des terrains libres</b><div>plus foncé = plus cher au m²</div>`;
  }
  // Repères communs à toutes les vues : propriétaires et symboles.
  const owners = [`<span><i class="swatch" style="background:${colorOf(ME)}"></i>vous</span>`, ...state.players.filter((p) => p.bot).map((p) => `<span><i class="swatch" style="background:${colorOf(p.id)}"></i>${esc(shortName(p.name))}</span>`)].join(' ');
  el.innerHTML += `<div class="legend-common">${owners}<br><span><i class="swatch" style="background:#f6d27a;border:2px solid #c98200"></i>en vente</span> <span><i class="swatch" style="background:#cdb6e6;border:1px dashed #7b3fa0"></i>à assembler</span> <span><i class="swatch" style="background:#7fd1d3;border:1px dashed #0f8b8d"></i>terrain communal</span> <span><i class="swatch" style="background:#fff;border:2.5px solid #1f6feb"></i>bâtiment construit (contour = promoteur ; pointillé = en chantier)</span></div>`;
  // Repliable (fermée par défaut sur petit écran) : le titre devient la ligne cliquable.
  const title = el.querySelector('b');
  const heading = title ? title.outerHTML : '<b>Légende</b>';
  if (title) title.remove();
  el.innerHTML = `<details class="lg" ${legendOpen ? 'open' : ''}><summary>${heading}</summary>${el.innerHTML}</details>`;
  el.querySelector('details')!.ontoggle = (e) => (legendOpen = (e.target as HTMLDetailsElement).open);
  L.DomEvent.disableClickPropagation(el);
}

/** Barre d'outils de la carte : vue, filtre des terrains libres, sélection multiple. */
const mapTools = new L.Control({ position: 'topright' });
mapTools.onAdd = () => {
  const el = L.DomUtil.create('div', 'maptools');
  el.innerHTML = `<label>Carte <select id="view"><option value="hauteur">Hauteur du bâti</option><option value="zonage">Règles d’urbanisme</option><option value="lieu">Valeur du lieu</option><option value="prix">Prix des terrains</option></select></label>
    <label>Terrains libres <select id="pfilter"><option value="tous">tous</option><option value="vente">en vente</option><option value="abordables">à ma portée</option><option value="assembler">à assembler</option></select></label>
    <label title="Ou Maj+clic sur la carte"><input type="checkbox" id="multi"/> sélection multiple</label>`;
  L.DomEvent.disableClickPropagation(el);
  const q = <T extends HTMLElement>(id: string) => el.querySelector<T>(`#${id}`)!;
  q<HTMLSelectElement>('view').onchange = (e) => ((view = (e.target as HTMLSelectElement).value as typeof view), applyView(), renderAll());
  q<HTMLSelectElement>('pfilter').onchange = (e) => ((plotFilter = (e.target as HTMLSelectElement).value as typeof plotFilter), renderAll());
  q<HTMLInputElement>('multi').onchange = (e) => (multi = (e.target as HTMLInputElement).checked);
  return el;
};

function applyView() {
  if (view === 'hauteur') buildingsLayer.addTo(map);
  else buildingsLayer.remove();
  if (view === 'lieu') poiLayer.addTo(map);
  else poiLayer.remove();
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
  const nameOf = (id: string) => esc(state.players.find((x) => x.id === id)?.name ?? id);
  const run = p.projectId ? state.projects.find((r) => r.id === p.projectId) : undefined;
  if (run) return `<br><b>${esc(run.id)}</b> · ${nameOf(run.owner)} · ${PHASE_LABEL[run.phase].toLowerCase()} · ${Math.round(run.height)} m, ${Math.round(run.sdp)} m²`;
  const b = p.built?.[p.built.length - 1];
  return b ? `<br>Livré par ${nameOf(b.owner)} · ${Math.round(b.height)} m, ${Math.round(b.sdp)} m²` : '';
}

function drawPlots() {
  computeRange();
  drawBuildings();
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
      layers.set(p.id, layer);
    }
    layer.setStyle(plotStyle(p));
    layer.bindTooltip(`${esc(p.label ?? p.id)}${p.zones.length ? ` · ${esc(ruleOf(p)!.label)}` : ''}<br>${eur(p.askingPrice)} · situation ×${p.locationFactor.toFixed(2).replace('.', ',')}${p.existingHeight ? ` · bâti ${Math.round(p.existingHeight)} m` : ''}${p.owner ? ` · ${esc(state.players.find((x) => x.id === p.owner)?.name ?? '')}` : p.municipal ? ' · terrain communal (appel d’offres)' : ''}${buildingNote(p)}`, { sticky: true });
  }
}

function drawOverlay(project: ReturnType<typeof computeProject> | null) {
  overlay.clearLayers();
  if (!project || !project.footprint) return;
  const proj = new LocalProjection(project.origin.lon, project.origin.lat);
  const ring = project.footprint.map((v) => proj.toLonLat(v)).map((q) => [q.lat, q.lon] as [number, number]);
  L.polygon(ring, { color: '#d9480f', weight: 2, fillColor: '#f08c00', fillOpacity: 0.75, interactive: false }).addTo(overlay);
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
  const first = m.querySelector<HTMLElement>('input, button.primary');
  first?.focus();
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
  let difficulty: Difficulty = state.config.difficulty ?? 'normal';
  const dismissable = mode === 'edit' || !$('home').hidden || saved !== null || !!localStorage_get(SAVE_KEY);
  openModal(
    `<h2 class="mh">${mode === 'edit' ? 'Ma société' : 'Votre société de promotion'}</h2>
     <p class="muted">${mode === 'edit' ? 'Le nom et la couleur apparaissent sur la carte et dans le classement.' : 'Choisissez un nom et une couleur : ils apparaissent sur la carte et dans le classement. Vous pouvez tout changer plus tard.'}</p>
     <div class="preview"><span id="pv-mono"></span><div><b id="pv-name"></b><div id="pv-slogan" class="muted"></div></div></div>
     <label class="f col">Nom de la société<input id="co-name" maxlength="28" autocomplete="off" value="${esc(current.name)}"></label>
     <label class="f col">Slogan (facultatif)<input id="co-slogan" maxlength="60" autocomplete="off" value="${esc(current.slogan)}"></label>
     ${mode === 'new' ? `<div class="f col"><span>Difficulté</span><div class="levels" role="radiogroup" aria-label="Difficulté">${(['facile', 'normal', 'difficile'] as Difficulty[]).map((d) => `<button type="button" class="lvl" role="radio" data-diff="${d}" aria-checked="${d === difficulty}"><b>${DIFFICULTIES[d].label}</b><span class="muted">${DIFFICULTIES[d].summary}</span></button>`).join('')}</div></div>` : ''}
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
        root.querySelectorAll<HTMLElement>('.lvl').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.diff === difficulty)));
      };
      name.oninput = slogan.oninput = preview;
      root.querySelectorAll<HTMLButtonElement>('.sw').forEach((b) => (b.onclick = () => ((color = b.dataset.color!), preview())));
      root.querySelectorAll<HTMLButtonElement>('.lvl').forEach((b) => (b.onclick = () => ((difficulty = b.dataset.diff as Difficulty), preview())));
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
        gameStarted = true;
        selected.clear();
        tab = 'terrain';
        save();
        closeModal();
        hideHome();
        renderAll();
        if (!localStorage_get(TUTO_KEY)) openTutorial();
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
      <p class="muted">Votre offre bloque l’argent (prix et frais de notaire) jusqu’au verdict. Les concurrents enchérissent aussi.</p>`,
  },
  {
    title: 'Les appels d’offres de la commune',
    body: `<p>La commune garde quelques terrains (en <b>turquoise</b> sur la carte) et les cède par <b>appel d’offres</b>, dans l’onglet <b>Commune</b>. Elle choisit le <b>meilleur projet</b>, pas le plus offrant.</p>
      <p>Chaque appel annonce un <b>cahier des charges</b> (logements sociaux, hauteur, commerces, qualité, délai) et la <b>pondération</b> des critères : à vous de doser prix, mixité sociale, qualité et délai. Votre note s’affiche en direct.</p>
      <p>En échange, le <b>cadre de l’opération</b> apporte des avantages : en <b>ZAC</b>, terrain à prix réduit, pas de taxe d’aménagement et un étage de plus ; en <b>PUP</b>, permis instruit en 3 mois et taxe réduite ; en <b>quartier prioritaire</b>, TVA à 5,5 % donc des logements plus chers.</p>
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
      <p>Le panneau vous dit en direct si l’assemblage est possible et, sinon, pourquoi. Un grand terrain permet un immeuble plus gros, donc de meilleures marges.</p>`,
  },
  {
    title: 'Lancer un projet',
    body: `<p>Choisissez le nombre de niveaux ; <b>« Meilleur projet »</b> teste les options autorisées et prend la plus rentable. Trois chiffres comptent :</p>
      <ul><li><b>Marge</b> : ce que vous gagnez une fois tout vendu.</li><li><b>Fonds propres</b> : l’argent à sortir de votre poche.</li><li><b>Durée</b> en trimestres.</li></ul>
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
  const r = ranking(state);
  const mine = r.findIndex((x) => x.player === ME);
  const best = r[0];
  const mult = r[mine].netWorth / state.config.startCash;
  const m = (x: number) => x.toFixed(2).replace('.', ',');
  const goal = state.config.goalMultiple;
  const reached = goal > 0 && mult >= goal && !me().bankrupt;
  const verdict = me().bankrupt
    ? 'Faillite'
    : mult >= 3 ? 'Magnat du quartier' : mult >= 2 ? 'Promoteur confirmé' : mult >= 1.2 ? 'Promoteur honorable' : mult >= 1 ? 'Le quartier n’a pas fait fortune' : 'Une décennie difficile';
  const headline = me().bankrupt ? 'Votre patrimoine est devenu négatif : la banque a saisi vos terrains et arrêté vos chantiers.' : mine === 0 ? `Vous êtes le promoteur n°1 du quartier.` : `${esc(best.name)} remporte la partie. Vous terminez ${mine + 1}${mine === 1 ? 'e' : 'e'} sur ${r.length}.`;
  const st = me().stats;
  const open = state.projects.filter((p) => p.owner === ME).length;
  const rows = r
    .map((x, k) => `<tr class="${x.player === ME ? 'me' : ''}"><td>${k + 1}.</td><td>${mono(x.name, colorOf(x.player), true)} ${esc(x.name)}${x.player === ME ? '' : ` <span class="muted">${PROFILE_LABEL[x.player] ?? ''}</span>`}</td><td class="num">${state.players.find((p) => p.id === x.player)?.bankrupt ? '<span class="bad">faillite</span>' : eur(x.netWorth)}</td><td class="num muted">${state.players.find((p) => p.id === x.player)?.bankrupt ? '' : `×${m(x.netWorth / state.config.startCash)}`}</td></tr>`)
    .join('');
  const stat = (k: string, v: string) => `<div class="fact"><small>${k}</small><b>${v}</b></div>`;
  openModal(
    `<div class="muted" style="font-size:12px">Fin de partie · trimestre ${state.round}/${state.config.rounds}</div>
     <h2 class="mh">${verdict}</h2>
     <p>${headline}</p>
     ${goal ? `<div class="notice" style="--nc:${reached ? 'var(--good)' : 'var(--bad)'}"><b>${reached ? 'Objectif atteint' : 'Objectif manqué'}</b> · ${me().bankrupt ? 'faillite' : `×${m(mult)}`} pour un objectif de ×${m(goal)} (${DIFFICULTIES[state.config.difficulty].label.toLowerCase()})</div>` : ''}
     <table class="rank">${rows}</table>
     <p class="muted" style="font-size:12px">Patrimoine = trésorerie + terrains + fonds propres engagés. Départ : ${eurFull(state.config.startCash)}.</p>
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
      root.querySelector<HTMLButtonElement>('#en-map')!.onclick = closeModal;
      root.querySelector<HTMLButtonElement>('#en-other')!.onclick = () => (closeModal(), openIdentity('new'));
      root.querySelector<HTMLButtonElement>('#en-again')!.onclick = () => {
        state = newGame({ name: me().name, slogan: me().slogan ?? '', color: me().color ?? PALETTE[0] }, state.config.difficulty);
        gameStarted = true;
        selected.clear();
        tab = 'terrain';
        save();
        closeModal();
        renderAll();
        toast('Nouvelle partie : mêmes couleurs, nouveaux concurrents');
      };
    },
  );
}

// ---------------------------------------------------------------- écran d'accueil

function hideHome() {
  const h = $('home');
  h.hidden = true;
  h.innerHTML = '';
}

/** Écran d'accueil : reprendre la partie, en commencer une nouvelle, lire le mode d'emploi. */
function showHome() {
  closeNotif();
  const h = $('home');
  const resume = gameStarted && me();
  const worth = resume ? netWorth(state, ME) : 0;
  const goal = state.config.goalMultiple;
  const diff = DIFFICULTIES[state.config.difficulty ?? 'normal'];
  const saveCard = resume
    ? `<div class="home-save">
        <div class="home-save-head"><span class="mono" style="background:${colorOf(ME)}">${esc(monogram(me().name))}</span><div><b>${esc(me().name)}</b><div class="muted">${state.over ? 'Partie terminée' : `${quarterLabel(state.round)} · trimestre ${state.round}/${state.config.rounds}`} · ${esc(diff.label)}</div></div></div>
        <div class="home-stats"><div><small>Patrimoine</small><b>${eur(worth)}</b></div><div><small>Objectif</small><b>${goal ? `×${(worth / state.config.startCash).toFixed(2).replace('.', ',')} / ×${goal.toFixed(1).replace('.', ',')}` : '—'}</b></div><div><small>Opérations</small><b>${state.projects.filter((p) => p.owner === ME).length}</b></div></div>
        ${pbar(state.round, state.config.rounds, `${state.config.rounds - state.round} trimestres restants`)}
      </div>`
    : '';
  h.innerHTML = `<div class="home-inner">
      <div class="home-brand"><div class="home-logo" aria-hidden="true"><i></i><i></i><i></i><i></i></div><h1>Urbasim <span class="beta">bêta</span></h1><p class="home-tag">Le Monopoly de l’immobilier réel.<br>Achetez des terrains sur la vraie carte de ${esc(district.name.split('–')[0].trim())}, construisez, vendez, et battez vos concurrents promoteurs.</p></div>
      ${saveCard}
      <div class="home-actions">
        ${resume ? `<button id="hm-continue" class="primary big">${state.over ? 'Voir les résultats' : 'Continuer la partie'}</button>` : ''}
        <button id="hm-new" class="${resume ? '' : 'primary '}big">Nouvelle partie</button>
        <button id="hm-howto" class="big">Mode d’emploi</button>
      </div>
      <div class="home-place"><div><small>Lieu de la partie</small><b>${esc(district.name)}</b></div><span class="soon" title="Plus tard, vous choisirez la ville et le quartier">autres lieux bientôt</span></div>
      <div class="home-beta"><b>Version bêta</b> : le jeu évolue vite, des choses bougent ou cassent, et les prix, coûts et règles d’urbanisme sont des ordres de grandeur. Votre partie est enregistrée dans ce navigateur.
        <div class="home-soon"><b>À venir</b><ul><li>Choix du lieu : d’autres quartiers et villes de France</li><li>Mode multijoueur : jouer contre vos amis, sans serveur</li><li>Programmes et dispositifs (TVA 5,5 %, ZAC propres à un territoire)</li><li>Une carte plus belle et plus lisible, puis une vue 3D</li></ul></div></div>
      <ul class="home-points">
        <li><b>Vraies parcelles</b> du cadastre, PLU simplifié, bâti existant</li>
        <li><b>Enchères</b> et <b>appels d’offres</b> de la commune (ZAC, PUP)</li>
        <li><b>Concurrents</b> ordinateur, aléas, dettes et faillite</li>
      </ul>
      <div class="home-credits">Prototype · ${esc(district.credits.join(' · '))} · prix et coûts : ordres de grandeur</div>
    </div>`;
  h.hidden = false;
  const q = (id: string) => h.querySelector<HTMLButtonElement>(`#${id}`);
  const cont = q('hm-continue');
  if (cont)
    cont.onclick = () => {
      hideHome();
      if (state.over) openEndScreen();
      else if (!localStorage_get(TUTO_KEY) && state.round === 0 && !state.log.length) openTutorial();
    };
  q('hm-new')!.onclick = () => openIdentity('new');
  q('hm-howto')!.onclick = () => openTutorial();
  (cont ?? q('hm-new'))!.focus();
}

// ---------------------------------------------------------------- panneaux

/** Objectif de la partie : patrimoine final en multiple de la mise de départ. */
function objectiveStat(worth: number): string {
  const goal = state.config.goalMultiple;
  if (!goal) return '';
  const start = state.config.startCash;
  const have = worth / start;
  const pctDone = Math.max(0, Math.min(100, (have / goal) * 100));
  const reached = have >= goal;
  return `<div class="stat" title="Objectif : finir à ${eur(start * goal)} de patrimoine (×${goal.toFixed(1).replace('.', ',')} votre mise de départ)"><small>Objectif ×${goal.toFixed(1).replace('.', ',')}</small><b class="${reached ? 'good' : ''}">×${have.toFixed(2).replace('.', ',')}</b><span class="goalbar"><i style="width:${pctDone}%" class="${reached ? 'ok' : ''}"></i></span></div>`;
}

function renderTop() {
  const w = netWorth(state, ME);
  $('top').innerHTML = `
    <h1>Urbasim</h1>
    <div class="company" title="${esc(me().slogan ?? '')}"><span class="mono" style="background:${colorOf(ME)}">${esc(monogram(me().name))}</span><span class="cname">${esc(me().name)}</span></div>
    <div class="stat" title="Avancement de la partie"><small>Trimestre</small><b>${quarterLabel(state.round)} <span class="muted">${state.round}/${state.config.rounds}</span></b><span class="goalbar"><i style="width:${Math.min(100, (state.round / state.config.rounds) * 100)}%"></i></span></div>
    <div class="stat"><small>Trésorerie</small><b>${eur(me().cash)}</b></div>
    <div class="stat" title="Trésorerie + terrains (au prix de reprise) + fonds propres engagés dans les opérations, moins les dettes"><small>Patrimoine</small><b>${eur(w)}</b></div>
    ${objectiveStat(w)}
    ${me().bankrupt ? '<div class="stat"><small>Situation</small><b class="bad">FAILLITE</b></div>' : me().debt > 0 ? `<div class="stat" title="Charges impayées : elles portent intérêt et la banque ne finance plus rien tant qu'elles ne sont pas remboursées"><small>Découvert</small><b class="bad">−${eur(me().debt)}</b></div>` : ''}
    <div class="stat" title="Indice des prix de vente (100 = prix de départ) · taux du crédit promoteur · logements que les ménages achètent par trimestre dans le quartier, et logements en vente en ce moment (tous promoteurs)">
      <small>Marché</small><b><span class="${state.marketIndex >= 1 ? 'good' : 'bad'}">prix ${(state.marketIndex * 100).toFixed(0)}</span> · ${pct(state.interestRate)} · ${marketDemand(state).toFixed(0)}<span class="muted">/trim.</span> <span class="muted">(${unitsOnOffer(state)} en vente)</span></b>
    </div>
    <span class="spacer"></span>
    <button id="end" class="primary">${state.over ? 'Résultats' : me().ready ? 'En attente…' : 'Fin du trimestre ▶'}</button>
    <button id="ff" ${state.over ? 'disabled' : ''} title="Avance jusqu'à la prochaine étape d'une de vos opérations ou jusqu'à un aléa (8 trimestres au plus)">▶▶</button>
    <button id="bell" class="bell" title="Notifications et échéances" aria-label="Notifications">🔔${unreadCount() ? `<span class="badge hot">${unreadCount()}</span>` : urgentWatch() ? '<span class="badge hot">!</span>' : ''}</button>
    <details class="menu"><summary title="Menu">⋯</summary><div><div class="muted" style="margin-bottom:6px">${esc(district.name)}</div><div class="menulist"><button id="home-btn">Écran d’accueil</button><button id="howto">Mode d’emploi</button><button id="company">Ma société</button><button id="new">Nouvelle partie</button></div></div></details>`;
  $('end').onclick = () => (state.over ? openEndScreen() : endTurn());
  $('ff').onclick = fastForward;
  $('bell').onclick = openNotif;
  $('home-btn').onclick = () => (closeMenu(), showHome());
  $('howto').onclick = () => (closeMenu(), openTutorial());
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

function tabs(): string {
  const nOps = state.projects.filter((p) => p.owner === ME).length;
  const nListed = state.plots.filter((p) => p.owner === null && isListed(p)).length;
  const t = (id: typeof tab, label: string) => `<button data-tab="${id}" class="${tab === id ? 'on' : ''}">${label}</button>`;
  const market = state.config.landMarket === 'auction' ? t('marche', `Marché${nListed ? ` <span class="badge">${nListed}</span>` : ''}`) : '';
  const nTenders = openTenders(state).length;
  const commune = state.config.communeTenders ? t('commune', `Commune${nTenders ? ` <span class="badge">${nTenders}</span>` : ''}`) : '';
  return `<div class="tabs">${t('terrain', 'Terrain')}${market}${commune}${t('operations', `Opérations${nOps ? ` <span class="badge">${nOps}</span>` : ''}`)}${t('journal', 'Journal')}${t('classement', 'Classement')}</div>`;
}

function renderSide() {
  let body = '';
  if (tab === 'terrain') body = renderSelection();
  else if (tab === 'marche') body = renderMarche();
  else if (tab === 'commune') body = renderCommune();
  else if (tab === 'operations') body = renderOperations();
  else if (tab === 'journal') body = renderJournal();
  else body = renderRanking();
  $('side').innerHTML = tabs() + body;
  $('side').querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => (b.onclick = () => ((tab = b.dataset.tab as typeof tab), renderAll())));
  bindSelection();
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

function renderMulti(plots: Plot[]): string {
  drawOverlay(null);
  const area = plots.reduce((s, p) => s + areaOf(p), 0);
  const free = plots.every((p) => p.owner === null);
  const cost = plots.reduce((s, p) => s + buyCost(p), 0);
  // Diagnostic en direct : pourquoi l'assemblage est (im)possible.
  let verdict = '';
  let canMerge = false;
  const notMine = plots.filter((p) => p.owner !== ME);
  const busy = plots.filter((p) => p.projectId);
  if (notMine.length) {
    verdict = `<div class="check bad">Il faut posséder toutes les parcelles : achetez ${notMine.map((p) => esc(shortLabel(p))).join(', ')} (${eur(notMine.reduce((s, p) => s + buyCost(p), 0))}).</div>`;
  } else if (busy.length) {
    verdict = `<div class="check bad">Une opération est en cours sur ${busy.map((p) => esc(shortLabel(p))).join(', ')} : elle doit d’abord se terminer.</div>`;
  } else {
    const r = mergeParcels(plots.map((p) => p.parcel));
    if (r.ok) {
      canMerge = true;
      verdict = `<div class="check good">Assemblage possible : un terrain de ${Math.round(r.area)} m²${r.parcel.streetEdges.length ? '' : ' <b>sans accès à la rue</b> (à compléter avec une parcelle qui donne sur la rue)'}.</div>`;
    } else {
      verdict = `<div class="check bad">Assemblage impossible : ${esc(r.error)}.</div>`;
    }
  }
  const sold = plots.some((p) => p.owner && p.owner !== ME);
  return `<div class="head"><b>${plots.length} parcelles</b> <span class="muted">· ${Math.round(area)} m² · ${eur(cost)} frais compris</span></div>
    <div class="muted" style="font-size:12px;margin:4px 0">${plots.map((p) => `${esc(shortLabel(p))} (${p.owner === ME ? 'à vous' : p.owner ? esc(state.players.find((x) => x.id === p.owner)!.name) : 'libre'})`).join(' · ')}</div>
    ${verdict}
    <div class="row">
      <button id="merge" class="primary" ${canMerge ? '' : 'disabled'}>Assembler en un terrain</button>
      <button id="buyAll" ${free && !sold ? '' : 'disabled'} title="Achète toutes les parcelles libres de la sélection">Tout acheter</button>
      <button id="clear">Annuler</button>
    </div>
    <p class="muted" style="font-size:12px">Les parcelles doivent se toucher sur au moins 1,5 m. Assembler permet de construire plus gros, et de rendre constructibles des parcelles trop petites ou enclavées.</p>`;
}

function statusPill(p: Plot): string {
  if (p.projectId) return pill('opération en cours', colorOf(p.owner ?? ''));
  if (p.owner === ME) return pill(p.obligation ? 'à vous · engagements' : 'à vous', colorOf(ME));
  if (p.owner) return pill(esc(state.players.find((x) => x.id === p.owner)!.name), colorOf(p.owner));
  if (p.municipal) return pill('terrain communal', '#0f8b8d');
  if (p.issue === 'zone') return pill('inconstructible', '#777');
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
    </div>`;

  if (run) {
    drawOverlay(null);
    return html + `<h2>Opération ${esc(run.id)}</h2>` + operationCard(run.id) + details(p);
  }
  if (p.municipal && !p.owner) {
    drawOverlay(null);
    const t = openTenders(state).find((x) => x.plotId === p.id);
    return html + `<div class="notice" style="--nc:#0f8b8d"><b>Terrain communal</b> La commune ne le vend pas au plus offrant : elle choisit le meilleur projet par appel d’offres.${t ? `<br>${esc(t.id)} est ouvert (${esc(t.spec.programme.label)}).` : '<br>Un nouvel appel d’offres sera lancé prochainement.'}</div>${t ? '<div class="row"><button id="toTender" class="primary">Voir l’appel d’offres</button></div>' : ''}` + details(p);
  }
  const issueBox = p.issue === 'zone'
    ? `<div class="notice" style="--nc:#777"><b>Inconstructible</b> ${esc(ISSUE_MESSAGE.zone)}</div>`
    : p.issue
      ? `<div class="notice" style="--nc:#7b3fa0"><b>À assembler</b> ${esc(ISSUE_MESSAGE[p.issue])}<br><span class="muted">Sélectionnez les voisines (Maj+clic), achetez-les, puis « Assembler ».</span></div>`
      : '';
  if (!p.owner && state.config.landMarket === 'auction') {
    html += `${issueBox}${auctionPanel(p)}`;
    if (p.issue) {
      drawOverlay(null);
      return html + details(p);
    }
    return html + projectForm(p, false) + details(p);
  }
  if (!p.owner) {
    const missing = buyCost(p) - me().cash;
    html += `${issueBox}<div class="row"><button id="buy" class="primary" ${missing > 0 ? 'disabled' : ''}>Acheter · ${eur(buyCost(p))}</button></div>
      <div class="muted" style="font-size:12px">${missing > 0 ? `<span class="bad">Il vous manque ${eur(missing)}.</span> ` : ''}Frais de notaire compris (${eur(fee)}).</div>`;
    if (p.issue) {
      drawOverlay(null);
      return html + details(p);
    }
    return html + projectForm(p, false) + details(p);
  }
  if (!mine) {
    drawOverlay(null);
    return html + details(p);
  }
  html += `${issueBox}${p.obligation ? obligationNotice(p) : `<div class="row"><button id="sell" class="danger" title="Revente à la banque : ${Math.round(state.config.plotSpread * 100)} % de moins que le prix affiché">Revendre · ${eur(p.askingPrice * (1 - state.config.plotSpread))}</button></div>`}`;
  if (p.issue) {
    drawOverlay(null);
    return html + details(p);
  }
  return html + projectForm(p, true) + details(p);
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
  return `<h2>Appels d’offres de la commune (${open.length})</h2>
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
    : `<div class="notice" style="--nc:var(--accent)"><b>Pas en vente</b> · vous pouvez prospecter le propriétaire : réponse à la fin du trimestre, frais de prospection non remboursés. ${n ? `${n} offre${n > 1 ? 's' : ''} déjà déposée${n > 1 ? 's' : ''} ce trimestre.` : ''}<div class="muted" style="font-size:12px">Il n’accepte que s’il est satisfait du prix ; si deux promoteurs prospectent, le plus offrant l’emporte.</div></div>`;
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
function landDraft(p: Plot): number {
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
function bestForm(p: Plot, owned: boolean): { levels: number; attic: boolean; margin: number } | null {
  const landPrice = owned ? p.paid / (1 + state.config.bilanParams.acquisitionFeeRate) : landDraft(p);
  let best: { levels: number; attic: boolean; margin: number } | null = null;
  const ob = owned ? p.obligation : undefined;
  for (let levels = 0; levels <= 8; levels++) {
    for (const attic of [false, true]) {
      if (ob && levels + (attic ? 1 : 0) > ob.maxLevels) continue;
      const proj = computeProject(p.parcel, plotCriteria(p, { ...criteria(), levels, attic, parkingStrategy: 'auto' }, owned));
      if (!proj.footprint || proj.checks.some((c) => c.status === 'error')) continue;
      const b = planBilan(p, proj, landPrice, owned);
      if (!best || b.margin > best.margin) best = { levels, attic, margin: b.margin };
    }
  }
  return best;
}

/** Les règles de la zone du PLU, en clair. */
function zoneCard(p: Plot): string {
  const rule = ruleOf(p);
  if (!rule) return '';
  const several = p.zones.length > 1 ? '<div class="muted" style="font-size:12px">Terrain à cheval sur plusieurs zones : la règle la plus stricte s’applique.</div>' : '';
  const code = p.zoneCode ? `<span class="muted">${esc(p.zoneCode)}</span> · ` : '';
  if (!rule.buildable) return `<div><b>${code}${esc(rule.label)}</b>${several}<div class="muted">${esc(rule.summary)}</div></div>`;
  const chip = (t: string) => `<span class="chip">${t}</span>`;
  return `<div><b>${code}${esc(rule.label)}</b>${several}
    <div class="muted" style="font-size:12px">${esc(rule.summary)}</div>
    <div style="margin-top:4px">${chip(`Hauteur max <b>R+${rule.maxLevels}</b>`)}${chip(`Emprise <b>${Math.round(rule.maxCoverage * 100)} %</b>`)}${chip(`Pleine terre <b>${Math.round(rule.minOpenGround * 100)} %</b>`)}${rule.setbackFond || rule.setbackLateral ? chip(`Retraits <b>${rule.setbackFond ? `fond ${rule.setbackFond} m` : ''}${rule.setbackFond && rule.setbackLateral ? ', ' : ''}${rule.setbackLateral ? `côtés ${rule.setbackLateral} m` : ''}</b>`) : chip('Construction en limite possible')}${chip(rule.use === 'bureaux' ? '<b>Bureaux</b> uniquement' : 'Logements, commerces')}</div>
    <div class="muted" style="font-size:11px;margin-top:4px">Règles simplifiées inspirées du type de zone, pas le règlement réel.</div></div>`;
}

function locationDetail(p: Plot): string {
  const n = p.parcel.ring.length;
  const here = { lon: p.parcel.ring.reduce((t, q) => t + q.lon, 0) / n, lat: p.parcel.ring.reduce((t, q) => t + q.lat, 0) / n };
  const parts = locationParts(here, district.pois).slice(0, 4);
  if (!parts.length) return '<div class="muted">Aucun équipement structurant à proximité.</div>';
  return `<div class="muted" style="font-size:12px">Les équipements proches font monter les prix de vente (donc le terrain) :<br>${parts.map((x) => `${esc(LOCATION_RULES[x.kind].label)} ${esc(x.name)} · ${x.distance} m · +${(x.bonus * 100).toFixed(1).replace('.', ',')} %`).join('<br>')}</div>`;
}

function projectForm(p: Plot, owned: boolean): string {
  const rule = ruleOf(p);
  const ob = obligationOf(p, owned);
  // Hauteur permise (attique compris) : PLU plus bonus de la ZAC, sans dépasser l'engagement pris.
  const totalCap = Math.min(rule ? rule.maxLevels + (ob?.programme.bonusLevels ?? 0) : 11, ob ? ob.maxLevels : 99);
  const maxLv = Math.max(0, rule || ob ? totalCap - (form.attic ? 1 : 0) : 10);
  if (form.levels > maxLv) form.levels = maxLv;
  const proj = computeProject(p.parcel, plotCriteria(p, criteria(), owned));
  drawOverlay(proj);
  const errors = proj.checks.filter((c) => c.status === 'error');
  const sel = (v: ParkingStrategy, l: string) => `<option value="${v}" ${form.parking === v ? 'selected' : ''}>${l}</option>`;
  const options = `<label class="f">Stationnement<select id="f-parking">${sel('auto', 'automatique')}${sel('sous-sol', 'sous-sol')}${sel('rdc', 'rez-de-chaussée')}${sel('surface', 'en surface')}${sel('hors-site', 'places achetées à proximité')}${sel('aucun', 'aucun')}</select></label>
    <label class="f" title="Au-delà de 14 m de profondeur, l'éclairement naturel devient difficile">Profondeur max du bâtiment<select id="f-depth">${[10, 12, 15, 18, 22].map((d) => `<option value="${d}" ${form.depth === d ? 'selected' : ''}>${d} m</option>`).join('')}</select></label>`;
  let html = `<h2>Projet</h2>
    <div class="row" style="align-items:center">
      <label class="f" style="margin:0">Niveaux R+<select id="f-levels">${Array.from({ length: maxLv + 1 }, (_, i) => `<option ${i === form.levels ? 'selected' : ''}>${i}</option>`).join('')}</select></label>
      <label class="f" style="margin:0" title="L'attique compte comme un niveau dans la hauteur maximale de la zone">attique <input type="checkbox" id="f-attic" ${form.attic ? 'checked' : ''} ${(rule || ob) && totalCap - 1 < form.levels ? 'disabled' : ''}/></label>
      <button id="best" title="Teste les niveaux autorisés par le PLU, avec ou sans attique, et choisit le plus rentable sans erreur">Meilleur projet</button>
    </div>
    ${fold('Options', options)}`;
  if (!proj.footprint) return html + `<p class="bad">Rien de constructible avec ces critères.</p>`;

  const landPrice = owned ? p.paid / (1 + state.config.bilanParams.acquisitionFeeRate) : landDraft(p);
  const b = planBilan(p, proj, landPrice, owned);
  const c0 = b.costs;
  const equityBuild = (c0.demolition + c0.works + c0.fixed + c0.design + c0.insurance + c0.contingency + c0.taxes) * (1 - state.config.bilanParams.loanShare);
  const cashNeeded = (owned ? 0 : landDraft(p) * (1 + state.config.bilanParams.acquisitionFeeRate)) + equityBuild;
  const short = cashNeeded - me().cash;
  const i = proj.indicators;
  const ok = errors.length === 0;
  html += `<div class="kpis">
      <div class="kpi"><small>Marge</small><b class="${b.margin >= 0 ? 'good' : 'bad'}">${eur(b.margin)}</b><span class="muted">${pct(b.marginRate)} du CA</span></div>
      <div class="kpi" title="Le terrain est payé comptant. La banque ne finance le terrain (80 %) et les travaux qu'une fois ${Math.round(state.config.presaleThreshold * 100)} % des logements vendus sur plan."><small>Fonds propres</small><b class="${short > 0 ? 'bad' : ''}">${eur(cashNeeded)}</b><span class="muted">${owned ? 'pour lancer' : 'achat compris'}</span></div>
      <div class="kpi"><small>Durée</small><b>${b.quarters} trim.</b><span class="muted">${i.dwellings} logts · ${Math.round(i.sdpTotal)} m²</span></div>
    </div>`;
  html += proj.checks.filter((c) => c.status === 'error' || c.status === 'warn').map((c) => `<div class="check ${c.status === 'error' ? 'bad' : 'warn'}">${esc(c.label)} : ${esc(c.detail)}</div>`).join('');
  if (!ok) html += `<div class="muted" style="font-size:12px">Pour débloquer : réduisez les niveaux, changez le mode de stationnement dans « Options », ou cliquez sur « Meilleur projet ».</div>`;
  if (short > 0) html += `<div class="check bad">Il vous manque ${eur(short)} pour ${owned ? 'lancer' : 'acheter et lancer'} ce projet.</div>`;
  if (owned) html += `<div class="row"><button id="launch" class="primary" ${ok && short <= 0 ? '' : 'disabled'}>Lancer l’opération</button></div>`;
  const rows = `<table>
      <tr><td>Surface de plancher</td><td>${Math.round(i.sdpTotal)} m² (${i.levelsCount} niv.)</td></tr>
      <tr><td>Logements</td><td>${i.dwellings} · SHAB ${Math.round(i.shab)} m²</td></tr>
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
    html += `<div>Marge attendue <b class="${r.bilan.margin >= 0 ? 'good' : 'bad'}">${eur(r.bilan.margin)}</b> <span class="muted">${pct(r.bilan.marginRate)}${r.extraCost ? ` · surcoûts ${eur(r.extraCost)}` : ''}</span></div>`;
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
      return `<div class="card"><a href="#" data-goto="${esc(p.id)}">${esc(shortLabel(p))}</a> <b>${eur(o.price)}</b><div class="muted">${p.listing ? `mise en vente · réponse après ${quarterLabel(p.listing.until - 1)}` : 'prospection · réponse à la fin du trimestre'} · ${eur(o.reserved)} bloqués</div><button data-withdraw="${esc(p.id)}">Retirer</button></div>`;
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
  const r = ranking(state);
  return `<h2>${state.over ? 'Classement final' : 'Classement'}</h2>
    <table>${r.map((x, k) => `<tr><td>${k + 1}. <span class="mono sm" style="background:${colorOf(x.player)}">${esc(monogram(x.name))}</span> ${esc(x.name)}${x.player === ME ? '' : ` <span class="muted">${PROFILE_LABEL[x.player] ?? ''}</span>`}</td><td>${eurFull(x.netWorth)} <span class="muted">(×${(x.netWorth / state.config.startCash).toFixed(2).replace('.', ',')})</span></td></tr>`).join('')}</table>
    <p class="muted">Patrimoine = trésorerie + terrains (au prix de reprise) + fonds propres engagés. Départ : ${eurFull(state.config.startCash)}.</p>`;
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
    };
    el.onchange = () => renderAll(); // met à jour aussi les autres opérations (la demande se partage)
  });
  const dp = side.querySelector<HTMLSelectElement>('#f-depth');
  if (dp) dp.onchange = () => ((form.depth = +dp.value), renderAll());
  const bestBtn = side.querySelector<HTMLButtonElement>('#best');
  if (bestBtn)
    bestBtn.onclick = () => {
      const p = plotById([...selected][0]);
      const found = p ? bestForm(p, p.owner === ME) : null;
      if (!found) return toast('Aucun projet réalisable sur ce terrain avec ces réglages : essayez un autre mode de stationnement ou assemblez-le.', true);
      form.levels = found.levels;
      form.attic = found.attic;
      form.parking = 'auto';
      toast(`Meilleur projet : R+${found.levels}${found.attic ? ' avec attique' : ''}, ${eur(found.margin)} de marge`);
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
  drawPlots();
  renderSide();
}

$('credits').textContent = district.credits.join(' · ') + (NO_TILES ? ' · Voies : IGN, BD TOPO® (Licence Ouverte 2.0)' : ' · Fond de carte : © contributeurs OpenStreetMap') + ' · Prix et coûts : ordres de grandeur, pas une expertise.';
mapLegend.addTo(map);
mapTools.addTo(map);
fitDistrict();
applyView();
(document.getElementById('view') as HTMLSelectElement).value = view;
renderAll();
showHome();

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
