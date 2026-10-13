import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 1. Carrega dados de versão e commit
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
let gitCommit = 'unknown';
try {
  gitCommit = execSync('git rev-parse --short HEAD', { cwd: rootDir }).toString().trim();
} catch (_) {}

const versionInfo = {
  version: pkg.version,
  protocolVersion: 2,
  minClientProtocolVersion: 2,
  gitCommit,
  buildDate: new Date().toISOString()
};

console.log(`[Build Desktop] Compilando HyperStream v${versionInfo.version} (${gitCommit})...`);

// 2. Distribui version.json sincronizado para backend, frontend e desktop
const versionTargets = [
  path.join(rootDir, 'backend', 'src', 'version.json'),
  path.join(rootDir, 'frontend', 'version.json'),
  path.join(rootDir, 'desktop', 'version.json')
];

for (const vt of versionTargets) {
  fs.mkdirSync(path.dirname(vt), { recursive: true });
  fs.writeFileSync(vt, JSON.stringify(versionInfo, null, 2), 'utf8');
}
console.log('[Build Desktop] Metadados de versão sincronizados.');

// 3. Sincroniza arquivos do frontend para desktop/frontend
const frontendSrc = path.join(rootDir, 'frontend');
const desktopFrontendDst = path.join(rootDir, 'desktop', 'frontend');

console.log('[Build Desktop] Sincronizando arquivos do frontend para desktop/frontend...');
if (fs.existsSync(desktopFrontendDst)) {
  fs.rmSync(desktopFrontendDst, { recursive: true, force: true });
}
fs.cpSync(frontendSrc, desktopFrontendDst, { recursive: true });
console.log('[Build Desktop] Frontend sincronizado com sucesso.');

// 4. Empacota aplicativo desktop para Windows x64
console.log('[Build Desktop] Iniciando empacotamento com Electron Packager...');
const packCmd = 'npx @electron/packager desktop Hyperstream --platform=win32 --arch=x64 --out=desktop/dist --overwrite --asar.unpack-dir="bin"';
execSync(packCmd, { cwd: rootDir, stdio: 'inherit' });

const packagedDir = path.join(rootDir, 'desktop', 'dist', 'Hyperstream-win32-x64');
if (!fs.existsSync(packagedDir)) {
  throw new Error(`Diretório de build ${packagedDir} não foi criado.`);
}
console.log(`[Build Desktop] Empacotamento concluído em ${packagedDir}`);

// 5. Gera arquivo compactado Hyperstream-Windows-x64.zip para distribuição
const zipDest = path.join(rootDir, 'desktop', 'dist', 'Hyperstream-Windows-x64.zip');
if (fs.existsSync(zipDest)) {
  fs.unlinkSync(zipDest);
}

console.log(`[Build Desktop] Gerando pacote compactado para distribuição em ${zipDest}...`);
const zipCmd = `powershell.exe -NoProfile -NonInteractive -Command "Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath '${packagedDir.replace(/'/g, "''")}' | Select-Object -ExpandProperty FullName) -DestinationPath '${zipDest.replace(/'/g, "''")}' -Force"`;
execSync(zipCmd, { cwd: rootDir, stdio: 'inherit' });

if (!fs.existsSync(zipDest)) {
  throw new Error('Falha ao gerar o arquivo compactado Hyperstream-Windows-x64.zip');
}
const zipSizeMB = (fs.statSync(zipDest).size / (1024 * 1024)).toFixed(2);
console.log(`[Build Desktop] Pacote compactado gerado com sucesso (${zipSizeMB} MB).`);

// 6. Calcula hash SHA-256 e gera artefatos de validação
const zipBuffer = fs.readFileSync(zipDest);
const sha256 = crypto.createHash('sha256').update(zipBuffer).digest('hex');

const sha256Path = path.join(rootDir, 'desktop', 'dist', 'Hyperstream-Windows-x64.zip.sha256');
fs.writeFileSync(sha256Path, `${sha256}  Hyperstream-Windows-x64.zip\n`, 'utf8');

const latestJsonPath = path.join(rootDir, 'desktop', 'dist', 'latest.json');
const latestData = {
  version: versionInfo.version,
  tag: `v${versionInfo.version}`,
  gitCommit: versionInfo.gitCommit,
  protocolVersion: versionInfo.protocolVersion,
  assetName: 'Hyperstream-Windows-x64.zip',
  sha256,
  releaseDate: versionInfo.buildDate
};
fs.writeFileSync(latestJsonPath, JSON.stringify(latestData, null, 2), 'utf8');

console.log(`[Build Desktop] SHA256: ${sha256}`);
console.log(`[Build Desktop] Artefatos de release gerados com sucesso em desktop/dist/!`);
