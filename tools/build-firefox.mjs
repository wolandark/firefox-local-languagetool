import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist/firefox');

const PAYLOAD = ['background.js', 'content', 'pages', 'icons'];

const GECKO = {
  id: 'langtool-spellcheck@tito.bouzout',
  strict_min_version: '128.0',
};

function firefoxManifest(chromeManifest) {
  const m = structuredClone(chromeManifest);

  if (m.background?.service_worker) {
    m.background = { scripts: [m.background.service_worker] };
  }

  delete m.minimum_chrome_version; 
  m.browser_specific_settings = { gecko: GECKO };
  return m;
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const entry of PAYLOAD) {
  const from = path.join(ROOT, entry);
  if (!fs.existsSync(from)) throw new Error(`missing payload entry: ${entry}`);
  fs.cpSync(from, path.join(OUT, entry), { recursive: true });
}

fs.writeFileSync(
  path.join(OUT, 'manifest.json'),
  JSON.stringify(firefoxManifest(manifest), null, 2) + '\n',
);

console.log(`built ${path.relative(process.cwd(), OUT)} (v${manifest.version})`);
console.log('load it: about:debugging#/runtime/this-firefox → Load Temporary Add-on → dist/firefox/manifest.json');
