import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const frontendSrc = path.join(rootDir, 'frontend');
const desktopFrontendDst = path.join(rootDir, 'desktop', 'frontend');

console.log('[Build Desktop] Sincronizando arquivos do frontend para desktop/frontend...');
if (fs.existsSync(desktopFrontendDst)) {
  fs.rmSync(desktopFrontendDst, { recursive: true, force: true });
}
fs.cpSync(frontendSrc, desktopFrontendDst, { recursive: true });
console.log('[Build Desktop] Frontend sincronizado com sucesso.');

console.log('[Build Desktop] Iniciando empacotamento com Electron Packager...');
const cmd = 'npx @electron/packager desktop Hyperstream --platform=win32 --arch=x64 --out=desktop/dist --overwrite --asar.unpack-dir="bin"';
execSync(cmd, { cwd: rootDir, stdio: 'inherit' });

console.log('[Build Desktop] Empacotamento concluído em desktop/dist/Hyperstream-win32-x64');
