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
  ZONE_RULES,
  allowedLevels,
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
} from '../../moteur/src/game';
import districtData from '../../moteur/data/districts/montreuil-mairie.json';

const district = districtData as unknown as District;
const ME = 'moi';
const SAVE_KEY = 'urbasim-save-v4';
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
      if (s?.players?.some((p) => p.id === ME) && Array.isArray(s.plots) && typeof s.demandShock === 'number' && s.config?.salesDemand > 0 && s.plots.every((p) => Array.isArray(p.zones))) return s;
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
let view: 'hauteur' | 'prix' | 'lieu' | 'zonage' = 'hauteur';
/** Terrains libres mis en avant sur la carte : tous, seulement ceux à ma portée, ou ceux à assembler. */
let plotFilter: 'tous' | 'abordables' | 'assembler' = 'tous';
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
  const zoneBlocked = p.issue === 'zone';
  const dim = freePlot && (plotFilter === 'abordables' ? !affordable(p) : plotFilter === 'assembler' ? !small : false);
  const faded = freePlot && !affordable(p) && !small;
  const base: L.PathOptions = {
    color: sel ? '#000' : zoneBlocked && freePlot ? '#777' : small && freePlot ? '#7b3fa0' : col ?? (view === 'hauteur' ? '#2b6cb0' : '#7a6b4f'),
    weight: sel ? 3 : p.projectId ? 2.5 : small ? 1.8 : view === 'hauteur' ? 1.5 : 1,
    fillColor: col ?? (zoneBlocked ? '#bdbdbd' : small ? '#cdb6e6' : lieu ? lieuColor(p.locationFactor) : free),
    // Vue « hauteur » : les parcelles libres restent transparentes pour laisser voir le bâti.
    fillOpacity: col ? (p.projectId ? 0.7 : view === 'hauteur' || view === 'zonage' ? 0.35 : 0.55) : zoneBlocked ? 0.35 : small ? 0.5 : view === 'hauteur' || view === 'zonage' ? 0 : lieu ? 0.8 : 0.45,
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
  const owners = [`<span><i class="swatch" style="background:${COLORS.moi}"></i>vous</span>`, ...state.players.filter((p) => p.bot).map((p) => `<span><i class="swatch" style="background:${COLORS[p.id]}"></i>${esc(p.name)}</span>`)].join(' ');
  el.innerHTML += `<div class="legend-common">${owners}<br><span><i class="swatch" style="background:#cdb6e6;border:1px dashed #7b3fa0"></i>à assembler</span> <span>pointillé épais : opération</span></div>`;
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
    <label>Terrains libres <select id="pfilter"><option value="tous">tous</option><option value="abordables">à ma portée</option><option value="assembler">à assembler</option></select></label>
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
    layer.bindTooltip(`${esc(p.label ?? p.id)}${p.zones.length ? ` · ${esc(ruleOf(p)!.label)}` : ''}<br>${eur(p.askingPrice)} · situation ×${p.locationFactor.toFixed(2).replace('.', ',')}${p.existingHeight ? ` · bâti ${Math.round(p.existingHeight)} m` : ''}${p.owner ? ` · ${esc(state.players.find((x) => x.id === p.owner)?.name ?? '')}` : ''}`, { sticky: true });
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
    <div class="stat"><small>Trimestre</small><b>${quarterLabel(state.round)} <span class="muted">${state.round}/${state.config.rounds}</span></b></div>
    <div class="stat"><small>Trésorerie</small><b>${eur(me().cash)}</b></div>
    <div class="stat" title="Trésorerie + terrains (au prix de reprise) + fonds propres engagés dans les opérations"><small>Patrimoine</small><b>${eur(w)}</b></div>
    <div class="stat" title="Indice des prix de vente (100 = prix de départ) · taux du crédit promoteur · logements que les ménages achètent par trimestre dans le quartier, et logements en vente en ce moment (tous promoteurs)">
      <small>Marché</small><b><span class="${state.marketIndex >= 1 ? 'good' : 'bad'}">prix ${(state.marketIndex * 100).toFixed(0)}</span> · ${pct(state.interestRate)} · ${marketDemand(state).toFixed(0)}<span class="muted">/trim.</span> <span class="muted">(${unitsOnOffer(state)} en vente)</span></b>
    </div>
    <span class="spacer"></span>
    <button id="end" class="primary" ${state.over ? 'disabled' : ''}>${me().ready ? 'En attente…' : 'Fin du trimestre ▶'}</button>
    <button id="ff" ${state.over ? 'disabled' : ''} title="Avance jusqu'à la prochaine étape d'une de vos opérations ou jusqu'à un aléa (8 trimestres au plus)">▶▶</button>
    <details class="menu"><summary title="Menu">⋯</summary><div><div class="muted" style="margin-bottom:6px">${esc(district.name)}</div><button id="new">Nouvelle partie</button></div></details>`;
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
  const nOps = state.projects.filter((p) => p.owner === ME).length;
  const t = (id: typeof tab, label: string) => `<button data-tab="${id}" class="${tab === id ? 'on' : ''}">${label}</button>`;
  return `<div class="tabs">${t('terrain', 'Terrain')}${t('operations', `Opérations${nOps ? ` <span class="badge">${nOps}</span>` : ''}`)}${t('journal', 'Journal')}${t('classement', 'Classement')}</div>`;
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
      <p class="muted">Les parcelles violettes en pointillés sont trop petites ou enclavées pour être construites seules.</p></div>`;
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
  if (p.projectId) return pill('opération en cours', COLORS[p.owner ?? ''] ?? '#888');
  if (p.owner === ME) return pill('à vous', COLORS.moi);
  if (p.owner) return pill(esc(state.players.find((x) => x.id === p.owner)!.name), COLORS[p.owner] ?? '#888');
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
      ${fact('Prix affiché', `${eur(p.askingPrice)} <span class="muted">${Math.round(p.askingPrice / area)} €/m²</span>`)}
      ${fact('Zone', rule ? pill(`${esc(rule.label)}${rule.buildable ? ` · R+${rule.maxLevels}` : ''}`, rule.color) : '—')}
      ${fact('Bâti existant', p.existingSdp ? `${p.existingSdp} m²${p.existingHeight ? ` · ${Math.round(p.existingHeight)} m` : ''}` : 'aucun')}
    </div>`;

  if (run) {
    drawOverlay(null);
    return html + `<h2>Opération ${esc(run.id)}</h2>` + operationCard(run.id) + details(p);
  }
  const issueBox = p.issue === 'zone'
    ? `<div class="notice" style="--nc:#777"><b>Inconstructible</b> ${esc(ISSUE_MESSAGE.zone)}</div>`
    : p.issue
      ? `<div class="notice" style="--nc:#7b3fa0"><b>À assembler</b> ${esc(ISSUE_MESSAGE[p.issue])}<br><span class="muted">Sélectionnez les voisines (Maj+clic), achetez-les, puis « Assembler ».</span></div>`
      : '';
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
  html += `${issueBox}<div class="row"><button id="sell" class="danger" title="Revente à la banque : ${Math.round(state.config.plotSpread * 100)} % de moins que le prix affiché">Revendre · ${eur(p.askingPrice * (1 - state.config.plotSpread))}</button></div>`;
  if (p.issue) {
    drawOverlay(null);
    return html + details(p);
  }
  return html + projectForm(p, true) + details(p);
}

/** Détails repliés : règles d'urbanisme et situation. */
function details(p: Plot): string {
  const rule = ruleOf(p);
  return (rule ? fold(`Règles d’urbanisme · ${esc(rule.label)}`, zoneCard(p)) : '') + fold(`Situation · prix de vente ×${p.locationFactor.toFixed(2).replace('.', ',')}`, locationDetail(p));
}

/** Cherche le projet le plus rentable sans erreur (R+0 à R+8, avec ou sans attique, stationnement automatique). */
function bestForm(p: Plot, owned: boolean): { levels: number; attic: boolean; margin: number } | null {
  const landPrice = owned ? p.paid / (1 + state.config.bilanParams.acquisitionFeeRate) : p.askingPrice;
  let best: { levels: number; attic: boolean; margin: number } | null = null;
  for (let levels = 0; levels <= 8; levels++) {
    for (const attic of [false, true]) {
      const proj = computeProject(p.parcel, criteriaFor(p, { ...criteria(), levels, attic, parkingStrategy: 'auto' }));
      if (!proj.footprint || proj.checks.some((c) => c.status === 'error')) continue;
      const b = computeBilan({ project: proj, market: currentMarket(state, p), landPrice, existingSdp: p.existingSdp, params: currentParams(state) });
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
  const maxLv = rule ? allowedLevels(rule, form.attic) : 10;
  if (form.levels > maxLv) form.levels = maxLv;
  const proj = computeProject(p.parcel, criteriaFor(p, criteria()));
  drawOverlay(proj);
  const errors = proj.checks.filter((c) => c.status === 'error');
  const sel = (v: ParkingStrategy, l: string) => `<option value="${v}" ${form.parking === v ? 'selected' : ''}>${l}</option>`;
  const options = `<label class="f">Stationnement<select id="f-parking">${sel('auto', 'automatique')}${sel('sous-sol', 'sous-sol')}${sel('rdc', 'rez-de-chaussée')}${sel('surface', 'en surface')}${sel('hors-site', 'places achetées à proximité')}${sel('aucun', 'aucun')}</select></label>
    <label class="f" title="Au-delà de 14 m de profondeur, l'éclairement naturel devient difficile">Profondeur max du bâtiment<select id="f-depth">${[10, 12, 15, 18, 22].map((d) => `<option value="${d}" ${form.depth === d ? 'selected' : ''}>${d} m</option>`).join('')}</select></label>`;
  let html = `<h2>Projet</h2>
    <div class="row" style="align-items:center">
      <label class="f" style="margin:0">Niveaux R+<select id="f-levels">${Array.from({ length: maxLv + 1 }, (_, i) => `<option ${i === form.levels ? 'selected' : ''}>${i}</option>`).join('')}</select></label>
      <label class="f" style="margin:0" title="L'attique compte comme un niveau dans la hauteur maximale de la zone">attique <input type="checkbox" id="f-attic" ${form.attic ? 'checked' : ''} ${rule && rule.maxLevels - 1 < form.levels ? 'disabled' : ''}/></label>
      <button id="best" title="Teste les niveaux autorisés par le PLU, avec ou sans attique, et choisit le plus rentable sans erreur">Meilleur projet</button>
    </div>
    ${fold('Options', options)}`;
  if (!proj.footprint) return html + `<p class="bad">Rien de constructible avec ces critères.</p>`;

  const landPrice = owned ? p.paid / (1 + state.config.bilanParams.acquisitionFeeRate) : p.askingPrice;
  const b = computeBilan({ project: proj, market: currentMarket(state, p), landPrice, existingSdp: p.existingSdp, params: currentParams(state) });
  const c0 = b.costs;
  const equityBuild = (c0.demolition + c0.works + c0.fixed + c0.design + c0.insurance + c0.contingency + c0.taxes) * (1 - state.config.bilanParams.loanShare);
  const cashNeeded = (owned ? 0 : buyCost(p)) + equityBuild;
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
    ${bar}<div>${r.lotsSold}/${r.lots} lots vendus${left ? ` <span class="muted">· ≈ <span data-sales="${esc(r.id)}">${sales.toFixed(1).replace('.', ',')}</span> par trimestre</span>` : ' · tout est vendu'}</div>`;
  html += r.financed ? '<div class="muted">Crédit bancaire débloqué</div>' : `<div class="muted">Crédit débloqué à ${threshold} % vendus${share >= threshold ? '' : ` · encore ${Math.max(1, Math.ceil(r.lots * state.config.presaleThreshold) - r.lotsSold)} lot(s)`}</div>`;
  if (mineOp) {
    html += `<div>Marge attendue <b class="${r.bilan.margin >= 0 ? 'good' : 'bad'}">${eur(r.bilan.margin)}</b> <span class="muted">${pct(r.bilan.marginRate)}${r.extraCost ? ` · surcoûts ${eur(r.extraCost)}` : ''}</span></div>`;
    if (left > 0)
      html += `<label class="f" title="Une remise vend plus vite ; une prime ralentit les ventes">Prix de vente <span><input type="range" data-price="${esc(r.id)}" min="${MIN_PRICE_POLICY * 100}" max="${MAX_PRICE_POLICY * 100}" step="1" value="${Math.round(r.pricePolicy * 100)}"> <b data-pct="${esc(r.id)}">${r.pricePolicy > 0 ? '+' : ''}${Math.round(r.pricePolicy * 100)} %</b> <span class="muted">(≈ <span data-lot="${esc(r.id)}">${eur(lotPrice(state, r))}</span>/lot)</span></span></label>`;
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
