// Builds the web app into dist/: index.html plus one script and one stylesheet
// whose names carry a content hash, so a new deploy never mixes old and new files.
// The server's Content-Security-Policy allows only same-origin scripts, so
// nothing is inlined into the page.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const assets = path.join(dist, 'assets');
const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 10);

await rm(dist, { recursive: true, force: true });
await mkdir(assets, { recursive: true });

const js = await build({
  entryPoints: [path.join(root, 'src/app/main.jsx')],
  bundle: true,
  write: false,
  minify: true,
  format: 'iife',
  target: ['es2020', 'safari15'],
  // the screens use React as a global; react-global.js sets it before any screen runs
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  loader: { '.js': 'jsx', '.jsx': 'jsx', '.json': 'json' },
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  logLevel: 'warning',
});
const css = await build({
  entryPoints: [path.join(root, 'src/app/styles.css')],
  bundle: true,
  write: false,
  minify: true,
  target: ['safari15'],
  logLevel: 'warning',
});

const jsText = js.outputFiles[0].text;
const cssText = css.outputFiles[0].text;
const jsName = `app-${hash(jsText)}.js`;
const cssName = `app-${hash(cssText)}.css`;
await writeFile(path.join(assets, jsName), jsText);
await writeFile(path.join(assets, cssName), cssText);

const template = await readFile(path.join(root, 'src/index.html'), 'utf8');
const html = template.replace('%CSS%', `/assets/${cssName}`).replace('%JS%', `/assets/${jsName}`);
await writeFile(path.join(dist, 'index.html'), html);
await copyFile(path.join(root, 'src/favicon.svg'), path.join(dist, 'favicon.svg'));

const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
console.log(`dist/index.html\ndist/assets/${jsName} ${kb(jsText)}\ndist/assets/${cssName} ${kb(cssText)}`);
