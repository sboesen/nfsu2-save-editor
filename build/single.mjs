// Build a single-file offline copy of the editor (inline CSS and both modules).
// The modules are concatenated in one <script type="module">; profile.js's
// `export` keywords and app.js's import are removed, which is safe because the
// declarations share one module scope.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const html = read('site/index.html')
  .replace('<link rel="stylesheet" href="style.css">', `<style>\n${read('site/style.css')}</style>`);

const profile = read('site/profile.js').replace(/^export /gm, '');
const app = read('site/app.js').replace(/^import \{[\s\S]*?\} from '\.\/profile\.js';\n\n/m, '');

const out = html.replace(
  '<script type="module" src="app.js"></script>',
  `<script type="module">\n${profile}\n${app}</script>`
);

const dest = path.join(root, 'NFSU2 Save Editor.html');
fs.writeFileSync(dest, out);
console.log(`wrote ${dest} (${out.length.toLocaleString()} bytes)`);
