import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// The site is static: copy site/ to dist/ and check that the code parses and
// the .m4a recordings listed in the verse catalog are present.
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('site', 'dist', { recursive: true });
for (const file of ['site/assets/index-BCmaOVrC.js', 'site/assets/routes-D_68uCld.js', 'site/bible-audio/scroller-audio.js', 'site/bible-audio/player.mjs', 'site/bible-audio/audio-session.mjs', 'site/bible-audio/audio-dial.mjs']) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}
const tracks = Object.values(JSON.parse(readFileSync('site/bible-audio/verses.json', 'utf8')));
if (tracks.length !== 14053) throw new Error('Incomplete audio catalog');
const missing = tracks.filter(path => !existsSync(`site/${path}`));
if (missing.length) {
  console.warn(`${missing.length} of ${tracks.length} recordings are missing from site/audio/ (first: ${missing[0]}).`);
  console.warn('Add them with: python3 tools/import_audio.py /path/to/audio.zip');
}
console.log('Static Site build ready.');
