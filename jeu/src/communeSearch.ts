import { MARKETS } from '../../moteur/src/engine';
import { ARRONDISSEMENTS, MAX_PARCELS, countParcels, estimateSeconds, marketFor, searchCommunes, type CommuneHit } from '../../moteur/src/app/communes';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt = (n: number) => n.toLocaleString('fr-FR');
const fmtTime = (s: number) => (s < 90 ? `environ ${Math.max(10, Math.round(s / 10) * 10)} s` : `environ ${Math.round(s / 60)} min`);

/** Recherche d'une commune de France : suggestions, fiche (marché, nombre de parcelles, durée de préparation). */
export function mountCommuneSearch(host: HTMLElement) {
  host.innerHTML = `<div class="mapcard2"><div class="place-head"><b>Une autre commune</b><i>France entière</i></div>
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
      if (n > MAX_PARCELS) size.innerHTML = `<span class="bad">${fmt(n)} parcelles : trop grand pour une seule carte.</span> Un secteur autour d’un point sera proposé (prochaine étape).`;
      else size.innerHTML = `${fmt(n)} parcelles · préparation ${fmtTime(estimateSeconds(n))} · téléchargement unique, puis jouable hors ligne. <b>La préparation arrive à la prochaine étape.</b>`;
    } catch {
      size.innerHTML = '<span class="bad">Cadastre indisponible pour le moment.</span>';
    }
  };

  const search = async () => {
    abort?.abort();
    abort = new AbortController();
    try {
      hits = await searchCommunes(q.value, abort.signal);
    } catch (e) {
      if (abort.signal.aborted) return;
      list.innerHTML = '<span class="bad">Recherche indisponible (réseau).</span>';
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
