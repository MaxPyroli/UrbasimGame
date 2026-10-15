// Simule des parties (un humain inactif + 3 ordinateurs) sur une carte, pour vérifier le temps de calcul et l'équilibrage.
// Usage : npm run simulate -- <id> [difficulté=normal] [graines=1,2]
import { readFileSync } from 'node:fs';
import { DIFFICULTIES, applyAction, botIdentities, campaignConfig, createGame, districtToSeeds, marketOf, netWorth, playBots, type District, type Difficulty } from '../src/game';

const [id, diff = 'normal', seedList = '1,2'] = process.argv.slice(2);
const district = JSON.parse(readFileSync(new URL(`../data/districts/${id}.json`, import.meta.url), 'utf8')) as District;
const seeds = districtToSeeds(district);
const player = { name: 'Moi', color: '#e8590c', slogan: '' };
for (const seed of seedList.split(',').map(Number)) {
  const bots = botIdentities(seed, player);
  const bot = (p: 'prudent' | 'equilibre' | 'agressif', i: number) => ({ id: p, name: bots[i].name, bot: true as const, profile: p, color: bots[i].color, slogan: bots[i].slogan });
  let s = createGame({
    players: [{ id: 'moi', name: 'Moi', color: player.color, slogan: '' }, bot('prudent', 0), bot('equilibre', 1), bot('agressif', 2)],
    plots: seeds,
    config: { market: marketOf(district), ...campaignConfig(diff as Difficulty) },
    seed,
  });
  const t0 = Date.now();
  const times: number[] = [];
  const maxRounds = Number(process.env.ROUNDS ?? 1e9);
  while (!s.over && s.round < maxRounds) {
    const t = Date.now();
    s = playBots(s);
    const r = applyAction(s, { type: 'ready', player: 'moi' });
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    times.push(Date.now() - t);
  }
  const worth = (p: string) => (netWorth(s, p) / s.config.startCash).toFixed(1);
  const built = s.plots.filter((p) => p.built?.length).length;
  const multi = s.projects.length;
  console.log(
    `${id} ${diff} seed${seed} : ${Math.round((Date.now() - t0) / 1000)} s (tour max ${Math.max(...times)} ms, médian ${times.sort((a, b) => a - b)[times.length >> 1]} ms) · nets ${s.players.map((p) => `${p.name.slice(0, 6)} ×${worth(p.id)}`).join(' / ')} · faillites ${s.players.filter((p) => p.bankrupt).length} · terrains livrés ${built}, opérations en cours ${multi} · mise ${Math.round(s.config.startCash / 1000)} k€`,
  );
}
void DIFFICULTIES;
