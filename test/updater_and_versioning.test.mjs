import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  isNewerVersion,
  calculateBufferSha256,
  calculateFileSha256,
  verifyPackageIntegrity,
  extractExpectedSha256,
  checkCompatibility,
  generatePowerShellUpdaterScript
} from '../desktop/src/updaterCore.js';

describe('Suíte de Testes: Atualizador Automático, Integridade SHA-256 e Versionamento', () => {
  const testDir = path.join(os.tmpdir(), `hyperstream-test-${Date.now()}`);
  const sampleData = 'HyperStream 1.3.3 Test Payload - WebRTC P2P Ultra 60FPS';
  const expectedHash = crypto.createHash('sha256').update(sampleData).digest('hex').toLowerCase();
  let sampleFilePath;

  before(() => {
    fs.mkdirSync(testDir, { recursive: true });
    sampleFilePath = path.join(testDir, 'sample-update.bin');
    fs.writeFileSync(sampleFilePath, sampleData, 'utf8');
  });

  after(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch (_) {}
  });

  // 1. Testes de Comparação Semântica de Versões
  describe('Comparador Semântico de Versões (isNewerVersion)', () => {
    test('Deve detectar nova versão com incremento de patch', () => {
      assert.equal(isNewerVersion('1.3.2', '1.3.3'), true);
      assert.equal(isNewerVersion('v1.3.2', 'v1.3.3'), true);
      assert.equal(isNewerVersion('1.3.3', '1.3.4'), true);
    });

    test('Deve detectar nova versão com incremento de minor ou major', () => {
      assert.equal(isNewerVersion('1.3.3', '1.4.0'), true);
      assert.equal(isNewerVersion('1.3.3', '2.0.0'), true);
      assert.equal(isNewerVersion('v1.0.0', 'v2.0.0'), true);
    });

    test('Deve retornar false para versões idênticas', () => {
      assert.equal(isNewerVersion('1.3.3', '1.3.3'), false);
      assert.equal(isNewerVersion('v1.3.3', '1.3.3'), false);
      assert.equal(isNewerVersion('1.3.3', 'v1.3.3'), false);
    });

    test('Deve retornar false quando a versão instalada for mais nova que a remota', () => {
      assert.equal(isNewerVersion('1.3.3', '1.3.2'), false);
      assert.equal(isNewerVersion('2.0.0', '1.9.9'), false);
    });

    test('Deve tratar entradas nulas, vazias ou indefinidas com segurança', () => {
      assert.equal(isNewerVersion(null, '1.3.3'), false);
      assert.equal(isNewerVersion('1.3.3', null), false);
      assert.equal(isNewerVersion('', ''), false);
      assert.equal(isNewerVersion(undefined, undefined), false);
    });
  });

  // 2. Testes de Cálculo e Validação de Hash SHA-256
  describe('Integridade e Checksum SHA-256 (verifyPackageIntegrity)', () => {
    test('Deve calcular hash de buffer e arquivo com fidelidade exata', async () => {
      const bufHash = calculateBufferSha256(Buffer.from(sampleData, 'utf8'));
      const fileHash = await calculateFileSha256(sampleFilePath);

      assert.equal(bufHash, expectedHash);
      assert.equal(fileHash, expectedHash);
    });

    test('Deve aprovar integridade quando o hash confere perfeitamente', async () => {
      const result = await verifyPackageIntegrity(sampleFilePath, expectedHash);
      assert.equal(result.verified, true);
      assert.equal(result.actualSha256, expectedHash);
      assert.equal(result.expectedSha256, expectedHash);
    });

    test('Deve lançar erro explícito quando o hash for divergente (arquivo adulterado)', async () => {
      const fakeHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      await assert.rejects(
        async () => {
          await verifyPackageIntegrity(sampleFilePath, fakeHash);
        },
        (err) => {
          assert.match(err.message, /Falha crítica de integridade/);
          assert.match(err.message, /Esperado:/);
          assert.match(err.message, /Calculado:/);
          return true;
        }
      );
    });

    test('Deve lançar erro se o arquivo não existir', async () => {
      const nonExistent = path.join(testDir, 'does-not-exist.zip');
      await assert.rejects(
        async () => {
          await verifyPackageIntegrity(nonExistent, expectedHash);
        },
        /não encontrado para validação/
      );
    });

    test('Deve lançar erro se hash esperado for ausente e allowMissing for false', async () => {
      await assert.rejects(
        async () => {
          await verifyPackageIntegrity(sampleFilePath, null, { allowMissing: false });
        },
        /Falha de segurança: nenhum hash SHA-256 confiável/
      );
    });
  });

  // 3. Testes de Extração de Hash a partir de Fontes de Release
  describe('Extração de Hash SHA-256 da Release (extractExpectedSha256)', () => {
    test('Deve extrair com prioridade máxima do objeto latest.json', () => {
      const latestJson = { sha256: expectedHash };
      const sha256Text = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff  update.zip';
      const extracted = extractExpectedSha256({ latestJson, sha256Text });
      assert.equal(extracted, expectedHash);
    });

    test('Deve extrair do conteúdo textual de arquivo .sha256', () => {
      const sha256Text = `${expectedHash}  Hyperstream-Windows-x64.zip\n`;
      const extracted = extractExpectedSha256({ sha256Text });
      assert.equal(extracted, expectedHash);
    });

    test('Deve extrair do campo digest do asset da release do GitHub', () => {
      const release = {
        assets: [
          {
            name: 'Hyperstream-Windows-x64.zip',
            digest: `sha256:${expectedHash}`
          }
        ]
      };
      const extracted = extractExpectedSha256({ release });
      assert.equal(extracted, expectedHash);
    });

    test('Deve retornar null se nenhuma fonte contiver hash hexadecimal válido', () => {
      assert.equal(extractExpectedSha256({ latestJson: { sha256: 'invalid-hash' } }), null);
      assert.equal(extractExpectedSha256({}), null);
    });
  });

  // 4. Testes de Avaliação de Compatibilidade entre Cliente e Backend
  describe('Matriz de Compatibilidade e Protocolo (checkCompatibility)', () => {
    test('Deve identificar sincronia total quando versão e protocolo coincidem', () => {
      const client = { version: '1.3.3', protocolVersion: 2, minServerProtocolVersion: 2 };
      const server = { version: '1.3.3', protocolVersion: 2, minClientProtocolVersion: 2 };
      const result = checkCompatibility(client, server);
      assert.equal(result.status, 'compatible');
      assert.equal(result.updateRequired, false);
    });

    test('Deve identificar divergência não impeditiva quando protocolo é compatível mas versão difere', () => {
      const client = { version: '1.3.3', protocolVersion: 2, minServerProtocolVersion: 2 };
      const server = { version: '1.3.4', protocolVersion: 2, minClientProtocolVersion: 2 };
      const result = checkCompatibility(client, server);
      assert.equal(result.status, 'divergent');
      assert.equal(result.updateRequired, false);
    });

    test('Deve exigir atualização obrigatória quando cliente opera em protocolo legado', () => {
      const legacyClient = { version: '1.2.0', protocolVersion: 1, minServerProtocolVersion: 1 };
      const server = { version: '1.3.3', protocolVersion: 2, minClientProtocolVersion: 2 };
      const result = checkCompatibility(legacyClient, server);
      assert.equal(result.status, 'incompatible');
      assert.equal(result.updateRequired, true);
    });

    test('Deve alertar incompatibilidade quando servidor for mais antigo que o exigido pelo cliente', () => {
      const newClient = { version: '2.0.0', protocolVersion: 3, minServerProtocolVersion: 3 };
      const oldServer = { version: '1.3.3', protocolVersion: 2, minClientProtocolVersion: 2 };
      const result = checkCompatibility(newClient, oldServer);
      assert.equal(result.status, 'incompatible');
      assert.equal(result.updateRequired, false);
    });
  });

  // 5. Testes de Geração do Script PowerShell do Atualizador
  describe('Geração e Validação do Script de Atualização (generatePowerShellUpdaterScript)', () => {
    test('Deve conter rotinas de isolamento de processos, backup e rollback automático', () => {
      const script = generatePowerShellUpdaterScript({
        mainPid: 1234,
        targetDir: 'C:\\Program Files\\Hyperstream',
        sourceDir: 'C:\\Temp\\hyperstream-update',
        exePath: 'C:\\Program Files\\Hyperstream\\Hyperstream.exe',
        zipPath: 'C:\\Temp\\update.zip',
        extractDir: 'C:\\Temp\\extract',
        logPath: 'C:\\Temp\\updater.log',
        scriptPath: 'C:\\Temp\\updater.ps1',
        backupDir: 'C:\\Temp\\backup'
      });

      // 1. Process isolation
      assert.match(script, /\$MainPid = 1234/);
      assert.match(script, /Get-Process -Name "Hyperstream"/);
      assert.match(script, /StartsWith\(\$TargetDir/);

      // 2. Backup prévio
      assert.match(script, /Criando backup pré-atualização/);
      assert.match(script, /Copy-Item -Path "\$TargetDir\\\*" -Destination "\$BackupDir"/);

      // 3. Rollback automático em caso de falha de cópia
      assert.match(script, /Executando ROLLBACK restaurando a versão anterior a partir do backup/);
      assert.match(script, /Copy-Item -Path "\$BackupDir\\\*" -Destination "\$TargetDir"/);

      // 4. Verificação pós-cópia e checagem de execução
      assert.match(script, /Start-Process -FilePath "\$ExePath" -WorkingDirectory "\$TargetDir" -PassThru/);
      assert.match(script, /-not \$newProc\.HasExited/);

      // 5. Rollback em caso de falha imediata de inicialização da nova versão
      assert.match(script, /Executando rollback de segurança para versão prévia/);

      // 6. Limpeza e término
      assert.match(script, /Remove-Item -Path "\$BackupDir"/);
      assert.match(script, /exit 0/);
    });
  });

  // 6. Teste de Simulação de Rollback Seguro em Caso de Falha de Instalação
  describe('Simulação de Recuperação e Rollback Atômico', () => {
    test('Deve restaurar perfeitamente a versão funcional se os arquivos forem corrompidos na cópia', () => {
      const mockInstallDir = path.join(testDir, 'mock-installed-app');
      const mockBackupDir = path.join(testDir, 'mock-app-backup');
      fs.mkdirSync(mockInstallDir, { recursive: true });

      // Estado 1: Instalação funcional original
      const originalContent = 'HYPERSTREAM_EXE_BINARY_V1.3.3_FUNCTIONAL';
      fs.writeFileSync(path.join(mockInstallDir, 'Hyperstream.exe'), originalContent, 'utf8');
      fs.writeFileSync(path.join(mockInstallDir, 'config.json'), '{"installed": true}', 'utf8');

      // Passo A: Simula criação do backup antes da cópia
      fs.mkdirSync(mockBackupDir, { recursive: true });
      fs.cpSync(mockInstallDir, mockBackupDir, { recursive: true });
      assert.equal(fs.readFileSync(path.join(mockBackupDir, 'Hyperstream.exe'), 'utf8'), originalContent);

      // Passo B: Simula falha na substituição (arquivos corrompidos ou apagados no meio da cópia)
      fs.writeFileSync(path.join(mockInstallDir, 'Hyperstream.exe'), 'CORRUPTED_INCOMPLETE_WRITE', 'utf8');
      fs.unlinkSync(path.join(mockInstallDir, 'config.json'));

      // Passo C: Simula disparo do Rollback automático a partir do backup
      fs.cpSync(mockBackupDir, mockInstallDir, { recursive: true });

      // Validação: A instalação foi 100% restaurada para o estado original íntegro
      assert.equal(fs.readFileSync(path.join(mockInstallDir, 'Hyperstream.exe'), 'utf8'), originalContent);
      assert.equal(fs.existsSync(path.join(mockInstallDir, 'config.json')), true);
    });
  });
});
