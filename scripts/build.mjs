import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['web/app.jsx'], bundle: true, minify: true, outdir: 'dist', entryNames: 'app', loader: { '.woff': 'file', '.woff2': 'file' }, assetNames: 'fonts/[name]-[hash]', define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'linked' });
await copyFile('web/index.html', 'dist/index.html');
process.stdout.write('Interface compilada.\n');
