// Build a GitHub Pages copy of site/ in pages/.
//
// GitHub Pages serves this repo at https://<owner>.github.io/<repo>/ and caps a
// published site at 1 GB, so the copy:
//   - leaves out site/audio/ and plays the recordings from AUDIO_URL, the
//     folder that holds the book folders (genesis/1/1.m4a, ...). That host
//     must allow cross-origin fetches (CORS), because the player uses fetch();
//   - prefixes the app's absolute paths (/assets, /data, /bible-audio,
//     /favicon.svg) and the router's base path with /<repo>.
//
// Usage: node tools/build-pages.mjs [AUDIO_URL] [repo]
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const audioURL = new URL(process.argv[2] || 'https://pub-7b8d053ddd56406380dad80c36da49a5.r2.dev/audio/');
if (!audioURL.pathname.endsWith('/')) audioURL.pathname += '/';
const base = `/${process.argv[3] || 'ebiblewithtts'}`;

rmSync('pages', { recursive: true, force: true });
mkdirSync('pages', { recursive: true });
cpSync('site', 'pages', { recursive: true, filter: source => !source.startsWith('site/audio') });
writeFileSync('pages/.nojekyll', '');

// Replace each `from` exactly `count` times so a changed bundle fails loudly
// instead of shipping a half-rewritten site.
function rewrite(file, replacements) {
  let text = readFileSync(file, 'latin1');
  for (const [from, to, count] of replacements) {
    const found = text.split(from).length - 1;
    if (found !== count) throw new Error(`${file}: expected ${count} × ${JSON.stringify(from)}, found ${found}`);
    text = text.split(from).join(to);
  }
  writeFileSync(file, text, 'latin1');
}

const prefixed = (quote, counts) => ['/assets/', '/data/', '/bible-audio/', '/favicon.svg']
  .map((path, i) => [quote + path, quote + base + path, counts[i]])
  .filter(([, , count]) => count);

rewrite('pages/index.html', [
  ...prefixed('"', [7, 0, 1, 1]),
  ['<meta name="description"', `<meta name="bible-audio-base" content="${audioURL.href}"/><meta name="description"`, 1],
]);
rewrite('pages/assets/index-BCmaOVrC.js', [
  ...prefixed('`', [1, 0, 0, 1]),
  ['e.update({basepath:``,', `e.update({basepath:\`${base}\`,`, 1],
]);
rewrite('pages/assets/routes-D_68uCld.js', prefixed('`', [0, 1, 0, 0]));

// Catalog paths are relative to site/ (audio/genesis/1/1.m4a); make them
// relative to AUDIO_URL (genesis/1/1.m4a).
const catalog = JSON.parse(readFileSync('pages/bible-audio/verses.json', 'utf8'));
for (const [key, path] of Object.entries(catalog)) {
  if (!path.startsWith('audio/')) throw new Error(`Unexpected catalog path ${path}`);
  catalog[key] = path.slice('audio/'.length);
}
writeFileSync('pages/bible-audio/verses.json', JSON.stringify(catalog));

if (existsSync('pages/audio')) throw new Error('pages/ must not include the audio');
console.log(`GitHub Pages copy ready in pages/ (served at ${base}/, audio from ${audioURL.href}).`);
