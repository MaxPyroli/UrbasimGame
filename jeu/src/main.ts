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
  applyAction,
  createGame,
  currentMarket,
  currentParams,
  districtToSeeds,
  mergeParcels,
  netWorth,
  playBots,
  projectPhase,
  ranking,
  type Action,
  type District,
  type GameState,
  type Plot,
} from '../../moteur/src/game';
import districtData from '../../moteur/data/districts/montreuil-mairie.json';

const district = districtData as unknown as District;
const ME = 'moi';
const SAVE_KEY = 'urbasim-save-v2';
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
      if (s?.players?.some((p) => p.id === ME) && Array.isArray(s.plots)) return s;
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
let view: 'hauteur' | 'prix' = 'hauteur';
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

function endTurn() {
  if (state.over) return;
  const before = state.log.length;
  if (!me().ready && !act({ type: 'ready', player: ME })) return;
  state = playBots(state);
  save();
  const news = state.log.slice(before).filter((e) => e.player !== ME);
  selected = new Set([...selected].filter((id) => plotById(id)));
  if (state.over) tab = 'classement';
  toast(state.over ? 'Partie terminée !' : `${quarterLabel(state.round)} — ${news.length} événement${news.length > 1 ? 's' : ''}`);
  renderAll();
}

// ---------------------------------------------------------------- carte

const map = L.map('map', { zoomControl: true, preferCanvas: false });
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 19, attribution: '© contributeurs OpenStreetMap' }).addTo(map);
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

function plotStyle(p: Plot): L.PathOptions {
  const sel = selected.has(p.id);
  const col = ownerColor(p);
  const ppm = p.askingPrice / Math.max(1, areaOf(p));
  // Terrains libres : plus le prix au m² est élevé, plus la teinte est foncée (échelle = 10e–90e centile des terrains libres).
  const [lo, hi] = ppmRange;
  const t = Math.min(1, Math.max(0, (ppm - lo) / Math.max(1, hi - lo)));
  const free = `hsl(${40 - 30 * t} 80% ${78 - 28 * t}%)`;
  return {
    color: sel ? '#000' : col ?? (view === 'hauteur' ? '#2b6cb0' : '#7a6b4f'),
    weight: sel ? 3 : p.projectId ? 2.5 : view === 'hauteur' ? 1.5 : 1,
    fillColor: col ?? free,
    // Vue « hauteur » : les parcelles libres restent transparentes pour laisser voir le bâti.
    fillOpacity: col ? (p.projectId ? 0.7 : view === 'hauteur' ? 0.35 : 0.55) : view === 'hauteur' ? 0 : 0.45,
    dashArray: p.projectId ? '4 3' : undefined,
  };
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
mapLegend.onAdd = () => {
  const el = L.DomUtil.create('div', 'map-legend');
  el.innerHTML = `<b>Hauteur du bâti existant</b>${HEIGHT_CLASSES.map((c) => `<div><i class="swatch" style="background:${c.color}"></i>${c.label}</div>`).join('')}`;
  return el;
};

function applyView() {
  if (view === 'hauteur') {
    buildingsLayer.addTo(map);
    mapLegend.addTo(map);
  } else {
    buildingsLayer.remove();
    mapLegend.remove();
  }
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
    layer.bindTooltip(`${esc(p.label ?? p.id)}<br>${eur(p.askingPrice)}${p.existingHeight ? ` · bâti ${Math.round(p.existingHeight)} m` : ''}${p.owner ? ` · ${esc(state.players.find((x) => x.id === p.owner)?.name ?? '')}` : ''}`, { sticky: true });
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
    <span class="spacer"></span>
    <button id="end" class="primary" ${state.over ? 'disabled' : ''}>${me().ready ? 'En attente…' : 'Fin du trimestre ▶'}</button>
    <button id="new">Nouvelle partie</button>`;
  $('end').onclick = endTurn;
  $('new').onclick = () => {
    if (confirm('Abandonner cette partie et en commencer une nouvelle ?')) {
      state = newGame();
      selected.clear();
      tab = 'terrain';
      save();
      renderAll();
    }
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
  const heights =
    view === 'hauteur'
      ? `<div class="legend" style="margin:6px 0">${HEIGHT_CLASSES.map((c) => `<div><i class="swatch" style="background:${c.color}"></i>${c.label}</div>`).join('')}<div class="muted">teinte plus claire = hauteur estimée (non renseignée)</div></div>`
      : '';
  return `<label class="f" style="margin-top:14px">Vue de la carte<select id="view"><option value="hauteur" ${view === 'hauteur' ? 'selected' : ''}>Hauteur du bâti existant</option><option value="prix" ${view === 'prix' ? 'selected' : ''}>Prix des terrains</option></select></label>${heights}<p class="legend">
    <label><input type="checkbox" id="multi" ${multi ? 'checked' : ''}/> sélection multiple</label>
    <br><span><i class="swatch" style="background:${COLORS.moi}"></i>vous</span>${state.players
      .filter((p) => p.bot)
      .map((p) => `<span><i class="swatch" style="background:${COLORS[p.id]}"></i>${esc(p.name)}</span>`)
      .join('')}<br>${view === 'prix' ? '<span>terrains libres : plus foncé = plus cher au m²</span> ' : '<span>terrains libres : contour bleu</span> '}<span>pointillés = opération en cours</span></p>`;
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
    </table>`;

  if (run) {
    html += `<h2>Opération ${esc(run.id)}</h2>` + operationCard(run.id);
    drawOverlay(null);
    return html + legend();
  }
  if (!p.owner) {
    html += `<div class="row"><button id="buy" class="primary">Acheter · ${eurFull(p.askingPrice + fee)}</button></div>
      <p class="muted">dont ${eurFull(fee)} de frais de notaire. Essayez un projet sur ce terrain avant d’acheter :</p>`;
    return html + projectForm(p, false) + legend();
  }
  if (!mine) {
    drawOverlay(null);
    return html + legend();
  }
  html += `<div class="row"><button id="sell" class="danger">Revendre · ${eurFull(p.askingPrice * (1 - state.config.plotSpread))}</button></div>`;
  return html + projectForm(p, true) + legend();
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
  const b = computeBilan({ project: proj, market: currentMarket(state), landPrice, existingSdp: p.existingSdp, params: currentParams(state) });
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
      <tr><td>Prix de terrain max (marge ${pct(state.config.bilanParams.targetMargin)})</td><td>${eur(b.maxLandPrice)}</td></tr>
    </table>`;
  html += proj.checks.filter((c) => c.status === 'error' || c.status === 'warn').map((c) => `<div class="check ${c.status === 'error' ? 'bad' : 'warn'}">${esc(c.label)} : ${esc(c.detail)}</div>`).join('');
  if (owned) html += `<div class="row"><button id="launch" class="primary" ${ok ? '' : 'disabled'}>Lancer l’opération</button></div>`;
  return html;
}

function operationCard(runId: string): string {
  const r = state.projects.find((x) => x.id === runId);
  if (!r) return '';
  const phase = projectPhase(r, state.round);
  const total = r.permitRounds + r.buildRounds + r.sellRounds;
  const elapsed = state.round - r.launchedAt;
  const owner = state.players.find((p) => p.id === r.owner)!.name;
  const labels: Record<string, string> = { permis: 'Permis de construire', chantier: 'Chantier', vente: 'Commercialisation', termine: 'Livrée' };
  return `<div class="card"><b>${esc(r.id)}</b> · ${esc(owner)} · ${labels[phase]}
    <div class="muted">${Math.round(r.sdp)} m² SDP · trimestre ${Math.min(elapsed + 1, total)}/${total}</div>
    ${r.owner === ME ? `<div>Marge attendue ${eur(r.bilan.margin)} (${pct(r.bilan.marginRate)})${r.extraCost ? ` · surcoûts ${eur(r.extraCost)}` : ''}</div>` : ''}</div>`;
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

$('credits').textContent = district.credits.join(' · ') + ' · Fond de carte : © contributeurs OpenStreetMap · Prix et coûts : ordres de grandeur, pas une expertise.';
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
