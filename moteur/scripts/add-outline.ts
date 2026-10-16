// Ajoute à un instantané le contour de sa commune (pour n'afficher que ce qui est dans la commune).
// Usage : npm run outline -- <id> <code_insee>
import { readFileSync, writeFileSync } from 'node:fs';
import { fetchCommuneOutline } from '../src/app/districtFetch';
import type { District } from '../src/game/district';

const [id, insee] = process.argv.slice(2);
if (!id || !insee) {
  console.error('usage : npm run outline -- <id> <code_insee>');
  process.exit(1);
}
const file = new URL(`../data/districts/${id}.json`, import.meta.url);
const d = JSON.parse(readFileSync(file, 'utf8')) as District;
const outline = await fetchCommuneOutline(insee);
writeFileSync(file, JSON.stringify({ ...d, outline }));
console.log(`${id} : contour de ${outline.length} anneau(x), ${outline.reduce((s, r) => s + r.length, 0)} points`);
