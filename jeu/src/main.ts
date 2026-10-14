import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import {
  DEFAULT_CRITERIA,
  LocalProjection,
  MARKETS,
  computeBilan,
  computeProject,
  type Criteria,
  type ParkingStrategy,
} from '../../moteur/src/engine';
import {
  ISSUE_MESSAGE,
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
} from '../../moteur/src/game';
import districtData from '../../moteur/data/districts/montreuil-mairie.json';

const district = districtData as unknown as District;
const ME = 'moi';
const SAVE_KEY = 'urbasim-save-v3';
const COLORS: Record<string, string> = { moi: '#1a9850', prudent: '#3b6fd4', equilibre: '#8e54c9', agressif: '#d6336c' };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const eur = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(2).replace('.', ',')} M€` : `${Math.round(n / 1000).toLocaleString('fr-FR')} k€`);
const eurFull = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;
const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')} %`;

// ---------------------------------------------------------------- état

function newGame(seed = Date.now() % 100000): GameState {
  return createGame({
    players: [
      { id: ME, name: 'Vous' },
      { id: 'prudent', name: 'Prudent', bot: true, profile: 'prudent' },
      { id: 'equilibre', name: 'Équilibré', bot: true, profile: 'equilibre' },
      { id: 'agressif', name: 'Agressif', bot: true, profile: 'agressif' },
    ],
    plots: districtToSeeds(district),
    config: { market: MARKETS[district.market] },
    seed,
  });
}

function load(): GameState {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as GameState;
      if (s?.players?.some((p) => p.id === ME) && Array.isArray(s.plots) && typeof s.demandShock === 'number' && s.config?.salesDemand > 0) return s;
    }
  } catch {
    /* sauvegarde absente ou illisible : nouvelle partie */
  }
  return newGame();
}

let state: GameState = load();
let selected = new Set<string>();
let multi = false;
let tab: 'terrain' | 'operations' | 'journal' | 'classement' = 'terrain';
let view: 'hauteur' | 'prix' | 'lieu' = 'hauteur';
/** Terrains libres mis en avant sur la carte : tous, seulement ceux à ma portée, ou ceux à assembler. */
let plotFilter: 'tous' | 'abordables' | 'assembler' = 'tous';
let form: { levels: number; attic: boolean; parking: ParkingStrategy } = { levels: 3, attic: false, parking: 'auto' };

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
const criteria = (): Criteria => ({ ...DEFAULT_CRITERIA, levels: form.levels, attic: form.attic, parkingStrategy: form.parking });

/** Passe un trimestre sans rien afficher ; retourne les nouvelles du journal qui concernent le joueur. */
function advanceOne(): { mine: string[]; phases: string } {
  const before = state.log.length;
  const phasesBefore = myPhases();
  if (!me().ready && !act({ type: 'ready', player: ME })) return { mine: [], phases: phasesBefore };
  state = playBots(state);
  save();
  const mine = state.log.slice(before).filter((e) => e.player === ME).map((e) => e.text);
  return { mine, phases: phasesBefore };
}

const myPhases = () => state.projects.filter((p) => p.owner === ME).map((p) => `${p.id}:${p.phase}`).join(',');

function afterAdvance(message: string) {
  selected = new Set([...selected].filter((id) => plotById(id)));
  if (state.over) tab = 'classement';
  toast(state.over ? 'Partie terminée !' : message);
  renderAll();
}

function endTurn() {
  if (state.over) return;
  const { mine } = advanceOne();
  afterAdvance(`${quarterLabel(state.round)}${mine.length ? ` — ${mine.length} nouvelle${mine.length > 1 ? 's' : ''} pour vous` : ''}`);
}

/** Avance jusqu'à ce qu'il se passe quelque chose pour vous (étape d'une opération, aléa), au plus 8 trimestres. */
function fastForward() {
  if (state.over) return;
  const hasStake = state.projects.some((p) => p.owner === ME);
  const limit = hasStake ? 8 : 4;
  let n = 0;
  let why = '';
  while (!state.over && n < limit) {
    const { mine, phases } = advanceOne();
    n++;
    if (mine.length) {
      why = mine[mine.length - 1];
      break;
    }
    if (myPhases() !== phases) {
      why = 'une de vos opérations passe à l’étape suivante';
      break;
    }
  }
  afterAdvance(`${n} trimestre${n > 1 ? 's' : ''} → ${quarterLabel(state.round)}${why ? ` : ${why}` : ''}`);
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
    return run ? COLORS[run.owner] ?? '#888' : '#888';
  }
  return p.owner ? COLORS[p.owner] ?? '#888' : null;
}

/** Coût d'acquisition d'un terrain libre (prix affiché et frais de notaire). */
const buyCost = (p: Plot) => p.askingPrice * (1 + state.config.bilanParams.acquisitionFeeRate);
const affordable = (p: Plot) => buyCost(p) <= me().cash;

function plotStyle(p: Plot): L.PathOptions {
  const sel = selected.has(p.id);
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
  const dim = freePlot && (plotFilter === 'abordables' ? !affordable(p) : plotFilter === 'assembler' ? !small : false);
  const faded = freePlot && !affordable(p) && !small;
  const base: L.PathOptions = {
    color: sel ? '#000' : small && freePlot ? '#7b3fa0' : col ?? (view === 'hauteur' ? '#2b6cb0' : '#7a6b4f'),
    weight: sel ? 3 : p.projectId ? 2.5 : small ? 1.8 : view === 'hauteur' ? 1.5 : 1,
    fillColor: col ?? (small ? '#cdb6e6' : lieu ? lieuColor(p.locationFactor) : free),
    // Vue « hauteur » : les parcelles libres restent transparentes pour laisser voir le bâti.
    fillOpacity: col ? (p.projectId ? 0.7 : view === 'hauteur' ? 0.35 : 0.55) : small ? 0.5 : view === 'hauteur' ? 0 : lieu ? 0.8 : 0.45,
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
const levelsOf = (h: number) => Math.max(0, Math.round(h / 2.95) - 1);

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

map.createPane('bati');
map.getPane('bati')!.style.zIndex = '350';
map.getPane('bati')!.style.pointerEvents = 'none';
const buildingsLayer = L.layerGroup();
for (const b of district.buildings) {
  L.polygon(b.ring.map(([lon, lat]) => [lat, lon] as [number, number]), {
    pane: 'bati',
    interactive: false,
    stroke: true,
    color: '#3b2a1a',
    weight: 0.5,
    opacity: 0.6,
    fillColor: heightColor(b.height),
    fillOpacity: b.estimated ? 0.7 : 0.9,
  }).addTo(buildingsLayer);
}

const mapLegend = new L.Control({ position: 'bottomleft' });
mapLegend.onAdd = () => L.DomUtil.create('div', 'map-legend');
function updateMapLegend() {
  const el = mapLegend.getContainer();
  if (!el) return;
  if (view === 'hauteur') {
    el.innerHTML = `<b>Hauteur du bâti existant</b>${HEIGHT_CLASSES.map((c) => `<div><i class="swatch" style="background:${c.color}"></i>${c.label}</div>`).join('')}`;
  } else if (view === 'lieu') {
    const ramp = [0.95, 0.98, 1, 1.03, 1.06, 1.09].map((f) => `<i class="swatch" style="background:${lieuColor(f)};width:18px"></i>`).join('');
    const kinds = ['metro', 'tram', 'mairie', 'ecole', 'parc', 'sante'].map((k) => `<span><i class="swatch" style="background:${POI_COLORS[k]}"></i>${k === 'ecole' ? 'école' : k === 'sante' ? 'hôpital' : k === 'parc' ? 'espace public' : k === 'mairie' ? 'mairie' : k === 'tram' ? 'tramway' : 'métro'}</span>`).join(' ');
    el.innerHTML = `<b>Valeur du lieu (prix de vente)</b><div>${ramp}</div><div class="muted">moins cher ← quartier médian → plus cher</div><div style="margin-top:3px">${kinds}</div>`;
  } else {
    el.innerHTML = `<b>Prix des terrains libres</b><div>plus foncé = plus cher au m²</div>`;
  }
}

function applyView() {
  if (view === 'hauteur') buildingsLayer.addTo(map);
  else buildingsLayer.remove();
  if (view === 'lieu') poiLayer.addTo(map);
  else poiLayer.remove();
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

function drawPlots() {
  computeRange();
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
    layer.bindTooltip(`${esc(p.label ?? p.id)}<br>${eur(p.askingPrice)} · situation ×${p.locationFactor.toFixed(2).replace('.', ',')}${p.existingHeight ? ` · bâti ${Math.round(p.existingHeight)} m` : ''}${p.owner ? ` · ${esc(state.players.find((x) => x.id === p.owner)?.name ?? '')}` : ''}`, { sticky: true });
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

// ---------------------------------------------------------------- panneaux

function renderTop() {
  const w = netWorth(state, ME);
  $('top').innerHTML = `
    <h1>Urbasim</h1>
    <div class="stat"><small>Quartier</small><b>${esc(district.name)}</b></div>
    <div class="stat"><small>Trimestre</small><b>${quarterLabel(state.round)} <span class="muted">(${state.round}/${state.config.rounds})</span></b></div>
    <div class="stat"><small>Trésorerie</small><b>${eurFull(me().cash)}</b></div>
    <div class="stat"><small>Patrimoine</small><b>${eurFull(w)}</b></div>
    <div class="stat"><small>Prix de vente (indice)</small><b class="${state.marketIndex >= 1 ? 'good' : 'bad'}">${(state.marketIndex * 100).toFixed(0)}</b></div>
    <div class="stat"><small>Crédit promoteur</small><b>${pct(state.interestRate)}</b></div>
    <div class="stat" title="Logements que les ménages achètent par trimestre dans le quartier, et logements actuellement en vente (tous promoteurs)"><small>Demande · en vente</small><b>${marketDemand(state).toFixed(0)} · ${unitsOnOffer(state)} <span class="muted">logts</span></b></div>
    <span class="spacer"></span>
    <button id="end" class="primary" ${state.over ? 'disabled' : ''}>${me().ready ? 'En attente…' : 'Fin du trimestre ▶'}</button>
    <button id="ff" ${state.over ? 'disabled' : ''} title="Avance jusqu'à la prochaine étape d'une de vos opérations ou jusqu'à un aléa (8 trimestres au plus)">Avancer ▶▶</button>
    <button id="new">Nouvelle partie</button>`;
  $('end').onclick = endTurn;
  $('ff').onclick = fastForward;
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
    state = newGame();
    selected.clear();
    tab = 'terrain';
    save();
    renderAll();
  };
}

function tabs(): string {
  const t = (id: typeof tab, label: string) => `<button data-tab="${id}" class="${tab === id ? 'on' : ''}">${label}</button>`;
  return `<div class="tabs">${t('terrain', 'Terrain')}${t('operations', 'Opérations')}${t('journal', 'Journal')}${t('classement', 'Classement')}</div>`;
}

function renderSide() {
  let body = '';
  if (tab === 'terrain') body = renderSelection();
  else if (tab === 'operations') body = renderOperations();
  else if (tab === 'journal') body = renderJournal();
  else body = renderRanking();
  $('side').innerHTML = tabs() + body;
  $('side').querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => (b.onclick = () => ((tab = b.dataset.tab as typeof tab), renderAll())));
  bindSelection();
}

function legend(): string {
  const heights = view === 'hauteur' ? `<div class="legend muted" style="margin:6px 0">teinte plus claire = hauteur estimée (non renseignée dans la donnée)</div>` : '';
  return `<label class="f" style="margin-top:14px">Terrains libres<select id="pfilter"><option value="tous" ${plotFilter === 'tous' ? 'selected' : ''}>tous</option><option value="abordables" ${plotFilter === 'abordables' ? 'selected' : ''}>à ma portée</option><option value="assembler" ${plotFilter === 'assembler' ? 'selected' : ''}>à assembler</option></select></label>
    <label class="f">Vue de la carte<select id="view"><option value="hauteur" ${view === 'hauteur' ? 'selected' : ''}>Hauteur du bâti existant</option><option value="lieu" ${view === 'lieu' ? 'selected' : ''}>Valeur du lieu</option><option value="prix" ${view === 'prix' ? 'selected' : ''}>Prix des terrains</option></select></label>${heights}<p class="legend">
    <label><input type="checkbox" id="multi" ${multi ? 'checked' : ''}/> sélection multiple</label>
    <br><span><i class="swatch" style="background:${COLORS.moi}"></i>vous</span>${state.players
      .filter((p) => p.bot)
      .map((p) => `<span><i class="swatch" style="background:${COLORS[p.id]}"></i>${esc(p.name)}</span>`)
      .join('')}<br>${view === 'prix' ? '<span>terrains libres : plus foncé = plus cher au m²</span> ' : '<span>terrains libres : contour bleu</span> '}<span>pointillés épais = opération en cours</span><br><span><i class="swatch" style="background:#cdb6e6;border:1px dashed #7b3fa0"></i>trop petit ou enclavé : à assembler</span> <span>contour pointillé fin = hors de portée</span></p>`;
}

function renderSelection(): string {
  const ids = [...selected].filter((id) => plotById(id));
  if (ids.length === 0) {
    drawOverlay(null);
    return `<h2>Terrain</h2><p class="muted">Cliquez sur une parcelle. Pour assembler plusieurs parcelles mitoyennes, achetez-les, puis sélectionnez-les avec Maj+clic (ou « sélection multiple ») et cliquez sur « Assembler ».</p>${legend()}`;
  }
  const plots = ids.map((id) => plotById(id)!);
  if (plots.length > 1) return renderMulti(plots);
  return renderSingle(plots[0]);
}

function renderMulti(plots: Plot[]): string {
  drawOverlay(null);
  const area = plots.reduce((s, p) => s + areaOf(p), 0);
  const free = plots.every((p) => p.owner === null);
  const mine = plots.every((p) => p.owner === ME && !p.projectId);
  const cost = plots.reduce((s, p) => s + p.askingPrice * (1 + state.config.bilanParams.acquisitionFeeRate), 0);
  return `<h2>${plots.length} parcelles sélectionnées</h2>
    <p>${plots.map((p) => esc(p.label ?? p.id)).join('<br>')}</p>
    <table><tr><td>Surface totale</td><td>${Math.round(area)} m²</td></tr><tr><td>Prix affichés (frais compris)</td><td>${eur(cost)}</td></tr></table>
    <div class="row">
      <button id="buyAll" ${free ? '' : 'disabled'}>Tout acheter</button>
      <button id="merge" class="primary" ${mine ? '' : 'disabled'}>Assembler en un seul terrain</button>
      <button id="clear">Désélectionner</button>
    </div>
    <p class="muted">${mine ? 'Les parcelles doivent se toucher : l’assemblage permet de construire un ensemble plus grand.' : 'Pour assembler, vous devez posséder toutes les parcelles (sans opération en cours).'}</p>${legend()}`;
}

function renderSingle(p: Plot): string {
  const owner = p.owner ? state.players.find((x) => x.id === p.owner)!.name : null;
  const area = areaOf(p);
  const fee = p.askingPrice * state.config.bilanParams.acquisitionFeeRate;
  const mine = p.owner === ME;
  const run = p.projectId ? state.projects.find((r) => r.id === p.projectId) : null;
  let html = `<h2>${esc(p.label ?? p.id)}</h2>
    <table>
      <tr><td>Surface</td><td>${Math.round(area)} m²${p.parts ? ` · assemblage de ${p.parts.length}` : ''}</td></tr>
      <tr><td>Bâti existant</td><td>${p.existingSdp ? `${p.existingSdp} m² SDP${p.existingHeight ? ` · ${Math.round(p.existingHeight)} m (≈ R+${levelsOf(p.existingHeight)})` : ''}<br><span class="muted">à démolir avant de construire</span>` : 'aucun'}</td></tr>
      <tr><td>Prix affiché</td><td>${eurFull(p.askingPrice)} <span class="muted">(${Math.round(p.askingPrice / area)} €/m²)</span></td></tr>
      <tr><td>Propriétaire</td><td>${owner ? esc(owner) : '<span class="muted">libre</span>'}</td></tr>
      <tr><td>Situation</td><td>prix de vente <b class="${p.locationFactor >= 1 ? 'good' : 'bad'}">×${p.locationFactor.toFixed(2).replace('.', ',')}</b></td></tr>
    </table>${locationDetail(p)}`;

  if (run) {
    html += `<h2>Opération ${esc(run.id)}</h2>` + operationCard(run.id);
    drawOverlay(null);
    return html + legend();
  }
  const issueBox = p.issue
    ? `<div class="card" style="border-color:#7b3fa0"><b style="color:#7b3fa0">Non constructible seul</b><div>${esc(ISSUE_MESSAGE[p.issue])}</div><div class="muted">Sélectionnez les parcelles voisines (Maj+clic ou « sélection multiple »), achetez-les, puis « Assembler ».</div></div>`
    : '';
  if (!p.owner) {
    const missing = buyCost(p) - me().cash;
    html += `${issueBox}<div class="row"><button id="buy" class="primary" ${missing > 0 ? 'disabled' : ''}>Acheter · ${eurFull(buyCost(p))}</button></div>
      <p class="muted">${missing > 0 ? `<span class="bad">Il vous manque ${eurFull(missing)}.</span> ` : ''}dont ${eurFull(fee)} de frais de notaire.${p.issue ? '' : ' Essayez un projet sur ce terrain avant d’acheter :'}</p>`;
    if (p.issue) {
      drawOverlay(null);
      return html + legend();
    }
    return html + projectForm(p, false) + legend();
  }
  if (!mine) {
    drawOverlay(null);
    return html + legend();
  }
  html += `${issueBox}<div class="row"><button id="sell" class="danger">Revendre · ${eurFull(p.askingPrice * (1 - state.config.plotSpread))}</button></div>`;
  if (p.issue) {
    drawOverlay(null);
    return html + legend();
  }
  return html + projectForm(p, true) + legend();
}

function locationDetail(p: Plot): string {
  const n = p.parcel.ring.length;
  const here = { lon: p.parcel.ring.reduce((t, q) => t + q.lon, 0) / n, lat: p.parcel.ring.reduce((t, q) => t + q.lat, 0) / n };
  const parts = locationParts(here, district.pois).slice(0, 4);
  if (!parts.length) return '<p class="muted">Aucun équipement structurant à proximité.</p>';
  return `<div class="muted" style="font-size:12px">${parts.map((x) => `${esc(LOCATION_RULES[x.kind].label)} ${esc(x.name)} · ${x.distance} m · +${(x.bonus * 100).toFixed(1).replace('.', ',')} %`).join('<br>')}</div>`;
}

function projectForm(p: Plot, owned: boolean): string {
  const proj = computeProject(p.parcel, criteria());
  drawOverlay(proj);
  const errors = proj.checks.filter((c) => c.status === 'error');
  const sel = (v: ParkingStrategy, l: string) => `<option value="${v}" ${form.parking === v ? 'selected' : ''}>${l}</option>`;
  let html = `<h2>Projet</h2>
    <label class="f">Niveaux (R+x)<select id="f-levels">${Array.from({ length: 11 }, (_, i) => `<option ${i === form.levels ? 'selected' : ''}>${i}</option>`).join('')}</select></label>
    <label class="f">Attique<input type="checkbox" id="f-attic" ${form.attic ? 'checked' : ''}/></label>
    <label class="f">Stationnement<select id="f-parking">${sel('auto', 'automatique')}${sel('sous-sol', 'sous-sol')}${sel('rdc', 'rez-de-chaussée')}${sel('surface', 'en surface')}${sel('aucun', 'aucun')}</select></label>`;
  if (!proj.footprint) return html + `<p class="bad">Rien de constructible avec ces critères.</p>`;

  const landPrice = owned ? p.paid / (1 + state.config.bilanParams.acquisitionFeeRate) : p.askingPrice;
  const b = computeBilan({ project: proj, market: currentMarket(state, p), landPrice, existingSdp: p.existingSdp, params: currentParams(state) });
  const c0 = b.costs;
  const equityBuild = (c0.demolition + c0.works + c0.fixed + c0.design + c0.insurance + c0.contingency + c0.taxes) * (1 - state.config.bilanParams.loanShare);
  const cashNeeded = (owned ? 0 : buyCost(p)) + equityBuild;
  const short = cashNeeded - me().cash;
  const i = proj.indicators;
  const ok = errors.length === 0;
  html += `<table>
      <tr><td>Surface de plancher</td><td>${Math.round(i.sdpTotal)} m² (${i.levelsCount} niv.)</td></tr>
      <tr><td>Logements</td><td>${i.dwellings} · SHAB ${Math.round(i.shab)} m²</td></tr>
      <tr><td>Stationnement</td><td>${proj.parking.provided}/${proj.parking.required} places</td></tr>
      <tr><td>Chiffre d’affaires</td><td>${eur(b.revenue.total)}</td></tr>
      <tr><td>Terrain et frais</td><td>${eur(b.costs.land + b.costs.acquisitionFees)}</td></tr>
      <tr><td>Travaux${p.existingSdp ? ' et démolition' : ''}</td><td>${eur(b.costs.works + b.costs.demolition)}</td></tr>
      <tr><td>Coûts fixes d’opération <span class="muted" title="études de sol, géomètre, diagnostics, dossier de permis, garantie d’achèvement, raccordements, installation de chantier : dus quelle que soit la taille">ⓘ</span></td><td>${eur(b.costs.fixed)}</td></tr>
      <tr><td>Autres frais et crédit</td><td>${eur(b.costs.total - b.costs.land - b.costs.acquisitionFees - b.costs.works - b.costs.demolition - b.costs.fixed)}</td></tr>
      <tr class="total"><td>Marge</td><td class="${b.margin >= 0 ? 'good' : 'bad'}">${eur(b.margin)} (${pct(b.marginRate)})</td></tr>
      <tr><td>Durée</td><td>${b.quarters} trimestres</td></tr>
      <tr><td>Fonds propres à avancer ${owned ? '' : '(achat compris)'} <span class="muted" title="Le terrain est payé comptant. La banque ne finance le terrain (80 %) et les travaux qu'une fois ${Math.round(state.config.presaleThreshold * 100)} % des logements vendus sur plan.">ⓘ</span></td><td class="${short > 0 ? 'bad' : ''}">${eur(cashNeeded)}</td></tr>
      <tr><td>Prix de terrain max (marge ${pct(state.config.bilanParams.targetMargin)})</td><td>${eur(b.maxLandPrice)}</td></tr>
    </table>`;
  html += proj.checks.filter((c) => c.status === 'error' || c.status === 'warn').map((c) => `<div class="check ${c.status === 'error' ? 'bad' : 'warn'}">${esc(c.label)} : ${esc(c.detail)}</div>`).join('');
  if (short > 0) html += `<div class="check bad">Trésorerie insuffisante : il vous manque ${eurFull(short)} pour ${owned ? 'lancer' : 'acheter et lancer'} ce projet.</div>`;
  if (owned) html += `<div class="row"><button id="launch" class="primary" ${ok && short <= 0 ? '' : 'disabled'}>Lancer l’opération</button></div>`;
  return html;
}

const PHASE_LABEL: Record<string, string> = {
  permis: 'Permis de construire · commercialisation sur plan',
  preventes: 'En attente de préventes : la banque ne débloque pas le crédit',
  chantier: 'Chantier · appels de fonds des acquéreurs',
  livraison: 'Livraison et dernières ventes',
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
  const bar = `<div style="position:relative;height:8px;background:var(--line);border-radius:4px;margin:6px 0"><div style="height:8px;width:${share}%;background:${share >= threshold ? 'var(--good)' : 'var(--accent)'};border-radius:4px"></div><div title="seuil de préventes" style="position:absolute;left:${threshold}%;top:-3px;width:2px;height:14px;background:var(--ink)"></div></div>`;
  const stage = r.phase === 'permis' ? `${r.phaseElapsed}/${r.permitRounds}` : r.phase === 'chantier' ? `${r.phaseElapsed}/${r.buildRounds}` : r.phase === 'livraison' ? 'derniers lots' : 'attente';
  let html = `<div class="card"><b>${esc(r.id)}</b> · ${esc(owner)} · ${PHASE_LABEL[r.phase]}
    <div class="muted">${Math.round(r.sdp)} m² SDP · étape ${stage} · ${r.roundsRun} trimestre${r.roundsRun > 1 ? 's' : ''} écoulé${r.roundsRun > 1 ? 's' : ''}</div>
    ${bar}<div>${r.lotsSold}/${r.lots} lots vendus (${share} %) · ${left ? `environ ${sales.toFixed(1).replace('.', ',')} vente${sales >= 1.5 ? 's' : ''} par trimestre` : 'tout est vendu'}</div>`;
  if (!r.financed) html += `<div class="muted">Crédit bancaire débloqué à ${threshold} % de lots vendus${share >= threshold ? '' : ` : encore ${Math.max(1, Math.ceil(r.lots * state.config.presaleThreshold) - r.lotsSold)} lot(s) à vendre`}.</div>`;
  if (mineOp) {
    html += `<div>Marge attendue ${eur(r.bilan.margin)} (${pct(r.bilan.marginRate)})${r.extraCost ? ` · surcoûts ${eur(r.extraCost)}` : ''}</div>`;
    if (left > 0)
      html += `<label class="f" title="Une remise vend plus vite ; une prime ralentit les ventes">Prix de vente <span><input type="range" data-price="${esc(r.id)}" min="${MIN_PRICE_POLICY * 100}" max="${MAX_PRICE_POLICY * 100}" step="1" value="${Math.round(r.pricePolicy * 100)}"> <b>${r.pricePolicy > 0 ? '+' : ''}${Math.round(r.pricePolicy * 100)} %</b> <span class="muted">(≈ ${eur(lotPrice(state, r))}/lot)</span></span></label>`;
  }
  return html + '</div>';
}

function renderOperations(): string {
  drawOverlay(null);
  const mine = state.projects.filter((r) => r.owner === ME);
  const holdings = state.plots.filter((p) => p.owner === ME && !p.projectId);
  return `<h2>Mes opérations (${mine.length})</h2>${mine.map((r) => operationCard(r.id)).join('') || '<p class="muted">Aucune opération en cours.</p>'}
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
    <table>${r.map((x, k) => `<tr><td>${k + 1}. <i class="swatch" style="background:${COLORS[x.player]}"></i>${esc(x.name)}</td><td>${eurFull(x.netWorth)} <span class="muted">(×${(x.netWorth / state.config.startCash).toFixed(2).replace('.', ',')})</span></td></tr>`).join('')}</table>
    <p class="muted">Patrimoine = trésorerie + terrains (au prix de reprise) + fonds propres engagés. Départ : ${eurFull(state.config.startCash)}.</p>`;
}

function bindSelection() {
  const side = $('side');
  const on = (id: string, f: () => void) => {
    const el = side.querySelector<HTMLElement>(`#${id}`);
    if (el) el.onclick = f;
  };
  const first = [...selected][0];
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
  side.querySelectorAll<HTMLInputElement>('[data-price]').forEach((el) => {
    el.onchange = () => {
      if (act({ type: 'setPrice', player: ME, project: el.dataset.price!, policy: +el.value / 100 })) renderAll();
    };
  });
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
fitDistrict();
applyView();
renderAll();

// Outils de test automatisé (serveur de développement uniquement).
if (import.meta.env.DEV) {
  (window as any).__urbasim = {
    state: () => state,
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
