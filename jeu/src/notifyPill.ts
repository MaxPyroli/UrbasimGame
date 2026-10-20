// Pastille de notification animée (le « moteur » des notifications) : une icône ronde avec un point ; quand quelque chose arrive,
// elle se déroule en pilule et affiche son texte, puis se replie en gardant son point jusqu'à ce qu'on la lise.
// Réutilisable partout : nouvelle version, offre reçue, appel d'offres, aléa… Se fige si l'animation est réduite (CSS global).
export interface PillOptions {
  /** Identifiant du bouton. */
  id: string;
  /** Icône SVG (markup) affichée dans le rond. */
  icon: string;
  /** Texte affiché quand la pastille se déroule. */
  label: string;
  /** Info-bulle et libellé d'accessibilité au repos. */
  title: string;
  /** Position : « corner » = coin haut droit de son conteneur ; sinon, dans le flux. */
  placement?: 'corner' | 'inline';
  /** Au clic. */
  onClick: () => void;
}

export interface Pill {
  el: HTMLButtonElement;
  /** Montre ou cache le point ; un nombre supérieur à 1 s'affiche dans la pastille. */
  setUnread: (unread: boolean | number) => void;
  /** Déroule la pastille avec son texte (ou un autre) pendant `ms`, puis la replie. */
  announce: (text?: string, ms?: number) => void;
  /** Replie tout de suite. */
  collapse: () => void;
  dispose: () => void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Markup de la pastille ; à insérer dans la page, puis à brancher avec `mountPill`. */
export function pillHTML(o: Pick<PillOptions, 'id' | 'icon' | 'label' | 'title' | 'placement'>): string {
  return `<button type="button" id="${esc(o.id)}" class="npill${o.placement === 'corner' ? ' npill-corner' : ''}" aria-label="${esc(o.title)}" title="${esc(o.title)}"><span class="ico">${o.icon}<i class="dot"></i></span><span class="txt">${esc(o.label)}</span></button>`;
}

/** Branche la pastille déjà présente dans `root` : clic, point, déroulement. */
export function mountPill(root: ParentNode, o: PillOptions): Pill {
  const el = root.querySelector<HTMLButtonElement>(`#${CSS.escape(o.id)}`)!;
  const txt = el.querySelector<HTMLElement>('.txt')!;
  const dot = el.querySelector<HTMLElement>('.dot')!;
  let timer = 0;
  el.onclick = o.onClick;
  const pill: Pill = {
    el,
    setUnread(unread) {
      const n = typeof unread === 'number' ? unread : unread ? 1 : 0;
      el.classList.toggle('new', n > 0);
      dot.textContent = n > 1 ? String(Math.min(n, 99)) : '';
      dot.classList.toggle('count', n > 1);
    },
    announce(text, ms = 7000) {
      window.clearTimeout(timer);
      if (text) txt.textContent = text;
      // Un instant de repos avant de se dérouler, pour que l'œil la voie arriver.
      timer = window.setTimeout(() => {
        el.classList.add('open');
        timer = window.setTimeout(() => el.classList.remove('open'), ms);
      }, 900);
    },
    collapse() {
      window.clearTimeout(timer);
      el.classList.remove('open');
    },
    dispose() {
      window.clearTimeout(timer);
    },
  };
  return pill;
}
