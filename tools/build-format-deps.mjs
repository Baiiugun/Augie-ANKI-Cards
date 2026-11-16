// One pinned HTML/CSS parser bundle for both Node importers and the browser.
import { build } from 'esbuild';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const licenses = ['parse5','entities','css-tree','mdn-data','source-map-js'].map((name) => {
  const root = new URL('./node_modules/' + name + '/', import.meta.url);
  const file = ['LICENSE','LICENSE.txt','LICENSE-MIT.txt'].find((file) => fs.existsSync(new URL(file, root)));
  return name + '\n' + (file ? fs.readFileSync(new URL(file, root), 'utf8') : 'See pinned npm package for license');
}).join('\n\n');
await build({ stdin: { contents: "export {parseFragment,serialize} from 'parse5'; export {parse,walk,generate} from 'css-tree';", resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, format: 'esm', platform: 'browser', minify: true, legalComments: 'eof', footer: { js: '/* Third-party notices\n' + licenses.replace(/\*\//g, '* /') + '\n*/' }, outfile: fileURLToPath(new URL('../vendor/card-format-deps.js', import.meta.url)) });
