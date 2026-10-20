import { MARKETS } from '../../moteur/src/engine';
import { customId, listCustomMaps, prepareMap } from './customMaps';
import { ARRONDISSEMENTS, MAX_PARCELS, SECTOR_RADII, needsSector, countParcels, countParcelsBox, estimateSeconds, marketFor, searchCommunes, type CommuneHit } from '../../moteur/src/app/communes';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt = (n: number) => n.toLocaleString('fr-FR');
const fmtTime = (s: number) => (s < 90 ? `environ ${Math.max(10, Math.round(s / 10) * 10)} s` : `environ ${Math.round(s / 60)} min`);

/** Recherche d'une commune de France : suggestions, fiche (marché, nombre de parcelles, durée de préparation). */
export function mountCommuneSearch(host: HTMLElement, onPrepared: () => void = () => {}) {
  host.innerHTML = `<div class="mapcard2"><div class="place-head"><b>Une autre commune</b><i>Carte libre</i></div>
    <input id="cs-q" type="search" placeholder="Nom de commune ou code postal" autocomplete="off" style="width:100%">
    <div id="cs-list" class="muted"></div><div id="cs-card"></div></div>`;
  const q = host.querySelector<HTMLInputElement>('#cs-q')!;
  const list = host.querySelector<HTMLElement>('#cs-list')!;
  const card = host.querySelector<HTMLElement>('#cs-card')!;
  let timer = 0;
  let abort: AbortController | null = null;
  let hits: CommuneHit[] = [];

  const showCard = async (c: CommuneHit, arr?: { arr: string; name: string }) => {
    const market = MARKETS[marketFor(c)];
    const split = ARRONDISSEMENTS[c.code];
    card.innerHTML = `<div class="place-blurb"><b>${esc(arr?.name ?? c.name)}</b> · ${esc(c.deptName)} (${esc(c.dept)}) · ${fmt(c.population)} habitants · marché de référence « ${esc(market.name)} »</div>
      ${split ? `<label class="f">Arrondissement <select id="cs-arr">${split.list.map((a) => `<option value="${a.arr}" ${arr?.arr === a.arr ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>` : ''}
      <div id="cs-size" class="muted">Comptage des parcelles…</div>`;
    const sel = card.querySelector<HTMLSelectElement>('#cs-arr');
    if (sel && !arr) {
      // Grande ville découpée : on propose d'abord un arrondissement.
      sel.onchange = () => showCard(c, split.list.find((a) => a.arr === sel.value));
      card.querySelector<HTMLElement>('#cs-size')!.textContent = 'Choisissez un arrondissement.';
      return;
    }
    if (sel) sel.onchange = () => showCard(c, split.list.find((a) => a.arr === sel.value));
    const size = card.querySelector<HTMLElement>('#cs-size')!;
    try {
      const n = await countParcels(c.code, arr?.arr);
      if (!needsSector(n, c.population)) return offerPrepare(size, c, arr, n);
      if (arr) {
        size.innerHTML = `<span class="bad">${fmt(n)} parcelles : trop grand pour une seule carte.</span>`;
        return;
      }
      // Très grande commune : on propose un secteur autour de son centre, de plus en plus large tant qu'il reste jouable.
      size.innerHTML = `<span class="bad">${fmt(n)} parcelles : trop grand pour une seule carte.</span> Choisissez un secteur autour du centre de la commune.<div id="cs-sectors" class="muted">Comptage des secteurs…</div>`;
      const counts = await Promise.all(SECTOR_RADII.map((r) => countParcelsBox(c.center, r).catch(() => 0)));
      const ok = SECTOR_RADII.map((r, i) => ({ r, n: counts[i] })).filter((x) => x.n > 0 && x.n <= MAX_PARCELS);
      const sectors = size.querySelector<HTMLElement>('#cs-sectors')!;
      if (ok.length === 0) {
        sectors.innerHTML = '<span class="bad">Secteur indisponible pour le moment.</span>';
        return;
      }
      sectors.innerHTML = `<label class="f">Secteur <select id="cs-sector">${ok.map((x, i) => `<option value="${x.r}" ${i === ok.length - 1 ? 'selected' : ''}>rayon ${x.r >= 1000 ? `${x.r / 1000} km`.replace('.', ',') : `${x.r} m`} · ${fmt(x.n)} parcelles</option>`).join('')}</select></label><div id="cs-sector-go"></div>`;
      const sel = sectors.querySelector<HTMLSelectElement>('#cs-sector')!;
      const show = () => offerPrepare(sectors.querySelector<HTMLElement>('#cs-sector-go')!, c, arr, ok.find((x) => x.r === +sel.value)!.n, +sel.value);
      sel.onchange = show;
      show();
    } catch {
      size.innerHTML = '<span class="bad">Cadastre indisponible pour le moment.</span> <button type="button" id="cs-retry">Réessayer</button>';
      size.querySelector<HTMLButtonElement>('#cs-retry')!.onclick = () => showCard(c, arr);
    }
  };

  /** Bouton de préparation (commune, arrondissement ou secteur), avec progression, annulation et nouvel essai. */
  const offerPrepare = async (size: HTMLElement, c: CommuneHit, arr: { arr: string; name: string } | undefined, n: number, sectorRadius?: number) => {
    const suffix = sectorRadius ? `s${sectorRadius}` : arr?.arr;
    const title = sectorRadius ? `${c.name} · centre (${sectorRadius >= 1000 ? `${sectorRadius / 1000} km`.replace('.', ',') : `${sectorRadius} m`})` : arr?.name ?? c.name;
    const already = (await listCustomMaps()).some((m) => m.id === customId(c.code, suffix));
    size.innerHTML = `${fmt(n)} parcelles · préparation ${fmtTime(estimateSeconds(n))} · une seule fois, puis jouable hors ligne.
      <div class="row" style="margin-top:6px"><button id="cs-go" type="button" class="primary">${already ? 'Préparer de nouveau' : 'Préparer cette carte'}</button><button id="cs-cancel" type="button" hidden>Annuler</button></div>
      <div id="cs-prog" hidden><div class="dl-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i style="width:0%"></i></div><span class="muted"></span></div>
      <div id="cs-msg"></div>`;
    const go = size.querySelector<HTMLButtonElement>('#cs-go')!;
    const cancel = size.querySelector<HTMLButtonElement>('#cs-cancel')!;
    const prog = size.querySelector<HTMLElement>('#cs-prog')!;
    const msg = size.querySelector<HTMLElement>('#cs-msg')!;
    go.onclick = async () => {
      const ctl = new AbortController();
      go.hidden = true;
      cancel.hidden = false;
      prog.hidden = false;
      msg.textContent = '';
      cancel.onclick = () => ctl.abort();
      const bar = prog.querySelector<HTMLElement>('.dl-bar i')!;
      const label = prog.querySelector<HTMLElement>('.muted')!;
      try {
        await prepareMap(
          {
            title,
            name: title,
            insee: c.code,
            market: marketFor(c),
            ...(suffix ? { suffix } : {}),
            ...(arr ? { arr: arr.arr, dvfInsee: ARRONDISSEMENTS[c.code].list.find((a) => a.arr === arr.arr)!.dvf } : {}),
            ...(sectorRadius ? { sector: { center: c.center, radius: sectorRadius }, tile: 500 } : {}),
          },
          (step, done) => {
            bar.style.width = `${Math.round(done * 100)}%`;
            label.textContent = `${Math.round(done * 100)} % · ${step}…`;
          },
          ctl.signal,
        );
        size.innerHTML = `<b>${esc(title)}</b> est prête : retrouvez-la dans « Mes cartes » ci-dessous.`;
        onPrepared();
      } catch (e) {
        const aborted = e instanceof DOMException && e.name === 'AbortError';
        go.hidden = false;
        go.textContent = 'Réessayer';
        cancel.hidden = true;
        prog.hidden = true;
        msg.innerHTML = aborted ? 'Préparation annulée.' : `<span class="bad">La préparation a échoué : ${esc(e instanceof Error ? e.message : 'erreur')}.</span> Ce qui est déjà téléchargé est conservé : « Réessayer » reprend où elle s’est arrêtée.`;
      }
    };
  };

  const search = async () => {
    abort?.abort();
    abort = new AbortController();
    try {
      hits = await searchCommunes(q.value, abort.signal);
    } catch (e) {
      if (abort.signal.aborted) return;
      list.innerHTML = '<span class="bad">Recherche indisponible (réseau).</span> <button type="button" id="cs-retry-search">Réessayer</button>';
      list.querySelector<HTMLButtonElement>('#cs-retry-search')!.onclick = () => void search();
      return;
    }
    list.innerHTML = hits.length
      ? hits.map((h, i) => `<button type="button" data-i="${i}" style="display:block;width:100%;text-align:left;margin:2px 0">${esc(h.name)} <span class="muted">· ${esc(h.deptName || h.dept)} · ${fmt(h.population)} hab.</span></button>`).join('')
      : q.value.trim().length >= 2 ? 'Aucune commune trouvée.' : '';
    list.querySelectorAll<HTMLButtonElement>('[data-i]').forEach((b) => (b.onclick = () => ((list.innerHTML = ''), showCard(hits[+b.dataset.i!]))));
  };
  q.oninput = () => {
    clearTimeout(timer);
    card.innerHTML = '';
    timer = window.setTimeout(search, 300);
  };
}
