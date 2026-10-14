import { describe, expect, it } from 'vitest';
import { PALETTE, PARODIES, botIdentities, createGame, monogram, randomIdentity, sanitizeName, sanitizeSlogan } from '../src/game';

/** Noms réels de promoteurs : aucune parodie ne doit les reprendre tels quels. */
const REAL = ['nexity', 'bouygues', 'vinci', 'kaufman', 'icade', 'altarea', 'cogedim', 'eiffage', 'pichet', 'marignan', 'emerige', 'sogeprom', 'quartus', 'linkcity', 'spirit', 'nouveaux constructeurs', 'redman'];

describe('identité du promoteur', () => {
  it('les parodies sont nombreuses, uniques, et ne reprennent aucun nom réel à l’identique', () => {
    expect(PARODIES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(PARODIES.map((p) => p.name)).size).toBe(PARODIES.length);
    for (const p of PARODIES) {
      const low = p.name.toLowerCase();
      for (const real of REAL) expect(low.includes(real)).toBe(false);
      expect(p.name.length).toBeLessThanOrEqual(28);
      expect(p.slogan.length).toBeLessThanOrEqual(60);
    }
  });

  it('la palette a 8 couleurs distinctes', () => {
    expect(new Set(PALETTE).size).toBe(8);
    for (const c of PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('monogramme : initiales des deux premiers mots significatifs', () => {
    expect(monogram('Nexitoi Promotion')).toBe('NP');
    expect(monogram('Les Nouveaux Constricteurs')).toBe('NC');
    expect(monogram('Béton Fontaine Développement')).toBe('BF');
    expect(monogram('Sprite & Pierre')).toBe('SP');
    expect(monogram('zoé')).toBe('ZO');
    expect(monogram('')).toBe('??');
  });

  it('nettoie le nom saisi : espaces, caractères de contrôle, balises, longueur, valeur par défaut', () => {
    expect(sanitizeName('  Mon   Immo  ')).toBe('Mon Immo');
    expect(sanitizeName('<b>Gras</b>')).toBe('bGras/b');
    expect(sanitizeName('a'.repeat(60))).toHaveLength(28);
    expect(sanitizeName('   ')).toBe('Ma Promotion');
    expect(sanitizeName('\u0000\u0007')).toBe('Ma Promotion');
    expect(sanitizeSlogan('x'.repeat(100))).toHaveLength(60);
    expect(sanitizeSlogan(' un  slogan ')).toBe('un slogan');
  });

  it('au hasard : reproductible avec la même graine, varié avec d’autres, en évitant noms et couleurs donnés', () => {
    expect(randomIdentity(42)).toEqual(randomIdentity(42));
    const seen = new Set<string>();
    for (let s = 1; s <= 60; s++) seen.add(randomIdentity(s).name);
    expect(seen.size).toBeGreaterThan(10);
    const avoid = randomIdentity(7, { names: PARODIES.slice(1).map((p) => p.name), colors: PALETTE.slice(1) as unknown as string[] });
    expect(avoid.name).toBe(PARODIES[0].name);
    expect(avoid.color).toBe(PALETTE[0]);
  });

  it('les trois concurrents sont distincts entre eux et du joueur', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const me = randomIdentity(seed * 13);
      const bots = botIdentities(seed, me);
      expect(bots).toHaveLength(3);
      const names = [me.name, ...bots.map((b) => b.name)];
      const colors = [me.color, ...bots.map((b) => b.color)];
      expect(new Set(names).size).toBe(4);
      expect(new Set(colors).size).toBe(4);
    }
    expect(botIdentities(5, randomIdentity(1))).toEqual(botIdentities(5, randomIdentity(1)));
  });

  it('le jeu garde couleur et slogan des joueurs', () => {
    const s = createGame({
      players: [{ id: 'moi', name: 'Mon Immo', color: PALETTE[2], slogan: 'Bâtir demain' }, { id: 'b', name: 'Bot', bot: true, color: PALETTE[3] }],
      plots: [],
    });
    expect(s.players[0].color).toBe(PALETTE[2]);
    expect(s.players[0].slogan).toBe('Bâtir demain');
    expect(s.players[1].color).toBe(PALETTE[3]);
  });
});
