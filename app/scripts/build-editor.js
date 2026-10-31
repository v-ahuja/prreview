import { build } from 'esbuild';
import { mkdir, rm, copyFile, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'public/vendor');
const monacoRoot = fileURLToPath(new URL('../../', import.meta.resolve('monaco-editor')));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
// Monaco vendors a sanitizer inside its ESM sources. Replace that vendored copy,
// too: an npm override alone would not patch the JavaScript shipped to readers.
const sanitizer = { name: 'patched-dompurify', setup(builder) {
  builder.onResolve({ filter: /dompurify\/dompurify\.js$/ }, () => ({ path: fileURLToPath(import.meta.resolve('dompurify')) }));
} };
await build({ absWorkingDir: root, entryPoints: { monaco: 'client/monaco.js',
  'editor.worker': join(monacoRoot, 'esm/vs/editor/editor.worker.js'),
  'typescript.worker': join(monacoRoot, 'esm/vs/languages/features/typescript/ts.worker.js'),
  'json.worker': join(monacoRoot, 'esm/vs/languages/features/json/json.worker.js'),
  'css.worker': join(monacoRoot, 'esm/vs/languages/features/css/css.worker.js'),
  'html.worker': join(monacoRoot, 'esm/vs/languages/features/html/html.worker.js') },
  outdir: output, bundle: true, format: 'esm', splitting: true, minify: true, target: ['es2022'], loader: { '.ttf': 'file' }, plugins: [sanitizer], logLevel: 'warning' });
await copyFile(join(monacoRoot, 'LICENSE'), join(output, 'MONACO-LICENSE.txt'));
await build({ absWorkingDir: root,
  entryPoints: { 'rich-content': 'client/rich-content.js', 'diff-review': 'client/diff-review.js' },
  outdir: output, bundle: true, format: 'esm', splitting: true, minify: true, target: ['es2022'],
  conditions: ['production'], define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.ttf': 'file', '.woff': 'file', '.woff2': 'file', '.svg': 'file', '.png': 'file' }, logLevel: 'warning' });
await cp(join(root, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts'), join(output, 'excalidraw-assets/fonts'), { recursive: true });
console.log('Built the local editor, diff viewer, Markdown, Mermaid, and Excalidraw assets.');
