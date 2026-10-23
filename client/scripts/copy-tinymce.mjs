import { cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(root, '..', 'node_modules', 'tinymce');
const target = path.resolve(root, 'public', 'tinymce');

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const entry of [
  'tinymce.min.js',
  'license.md',
  'icons',
  'models',
  'plugins',
  'skins',
  'themes'
]) {
  cpSync(path.join(source, entry), path.join(target, entry), { recursive: true });
}
console.log('TinyMCE assets copied to client/public/tinymce');
