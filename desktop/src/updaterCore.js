import crypto from 'node:crypto';
import fs from 'node:fs';

/**
 * Compara versões semânticas (suporta prefixos como 'v' ou 'v1.3.3').
 * Retorna true se latest for estritamente mais recente que current.
 */
export function isNewerVersion(current, latest) {
  if (!current || !latest) return false;
  const parseVer = (v) => {
    const clean = String(v).trim().replace(/^v/i, '');
    const parts = clean.split('-')[0].split('.').map(n => parseInt(n, 10));
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  };
  const c = parseVer(current);
  const l = parseVer(latest);
  for (let i = 0; i < 3; i++) {
    if (l[i] > c[i]) return true;
    if (l[i] < c[i]) return false;
  }
  return false;
}

/**
 * Calcula o hash SHA-256 de um buffer.
 */
export function calculateBufferSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').toLowerCase();
}

/**
 * Calcula o hash SHA-256 de um arquivo via streaming para eficiência de memória.
 */
export async function calculateFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
    stream.on('error', reject);
  });
}

/**
 * Extrai o hash SHA-256 esperado das fontes disponíveis em uma release do GitHub:
 * 1. Objeto latest.json (campo sha256)
 * 2. Conteúdo do arquivo .sha256 (primeiro token hexadecimal de 64 caracteres)
 * 3. Campo digest do asset no GitHub Releases (ex: "sha256:b294ba...")
 */
export function extractExpectedSha256({ release, latestJson, sha256Text } = {}) {
  if (latestJson && typeof latestJson.sha256 === 'string' && latestJson.sha256.trim()) {
    const clean = latestJson.sha256.trim().toLowerCase();
    if (/^[a-f0-9]{64}$/i.test(clean)) return clean;
  }

  if (sha256Text && typeof sha256Text === 'string') {
    const firstWord = sha256Text.trim().split(/\s+/)[0].toLowerCase();
    if (/^[a-f0-9]{64}$/i.test(firstWord)) return firstWord;
  }

  if (release && Array.isArray(release.assets)) {
    const zipAsset = release.assets.find(a => a.name && a.name.endsWith('.zip'));
    if (zipAsset && zipAsset.digest && typeof zipAsset.digest === 'string') {
      const digestMatch = zipAsset.digest.match(/sha256:([a-f0-9]{64})/i);
      if (digestMatch) return digestMatch[1].toLowerCase();
    }
  }

  return null;
}

/**
 * Valida a integridade do arquivo comparando o hash calculado com o esperado.
 * Lança erro descritivo em caso de divergência ou ausência de hash.
 */
export async function verifyPackageIntegrity(filePath, expectedSha256, { allowMissing = false } = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo de atualização não encontrado para validação de integridade: ${filePath}`);
  }

  const actualSha256 = await calculateFileSha256(filePath);

  if (!expectedSha256) {
    if (allowMissing) {
      return { verified: false, actualSha256, warning: 'Nenhum hash SHA-256 esperado foi fornecido pela release.' };
    }
    throw new Error('Falha de segurança: nenhum hash SHA-256 confiável foi encontrado para validar o pacote de atualização.');
  }

  const normalizedExpected = expectedSha256.trim().toLowerCase();
  if (actualSha256 !== normalizedExpected) {
    throw new Error(
      `Falha crítica de integridade (SHA-256 divergente):\n` +
      `Esperado: ${normalizedExpected}\n` +
      `Calculado: ${actualSha256}\n` +
      `O pacote pode estar corrompido ou ter sido adulterado. A atualização foi abortada e nenhum arquivo local foi modificado.`
    );
  }

  return { verified: true, actualSha256, expectedSha256: normalizedExpected };
}

/**
 * Avalia compatibilidade entre o cliente e o backend/servidor com base em versões e protocolos.
 */
export function checkCompatibility(clientMeta = {}, serverMeta = {}) {
  const cProto = clientMeta.protocolVersion || 2;
  const sProto = serverMeta.protocolVersion || 2;
  const minClientRequired = serverMeta.minClientProtocolVersion || 2;
  const minServerRequired = clientMeta.minServerProtocolVersion || 2;

  // 1. Incompatibilidade estrita de protocolo
  if (cProto < minClientRequired) {
    return {
      status: 'incompatible',
      updateRequired: true,
      reason: `O servidor exige protocolo de cliente v${minClientRequired}, mas seu cliente opera em v${cProto}. Atualize o aplicativo.`
    };
  }

  if (sProto < minServerRequired) {
    return {
      status: 'incompatible',
      updateRequired: false,
      reason: `O cliente exige servidor com protocolo v${minServerRequired}, mas o servidor reporta v${sProto}. Aguarde atualização do servidor.`
    };
  }

  // 2. Divergência de versão de release (mesmo protocolo)
  if (clientMeta.version && serverMeta.version && clientMeta.version !== serverMeta.version) {
    return {
      status: 'divergent',
      updateRequired: false,
      reason: `Versões diferem (Cliente: v${clientMeta.version}, Servidor: v${serverMeta.version}), mas os protocolos de sinalização são totalmente compatíveis.`
    };
  }

  // 3. Totalmente compatível
  return {
    status: 'compatible',
    updateRequired: false,
    reason: 'Cliente e servidor estão em total sincronia de versão e protocolo.'
  };
}

/**
 * Gera o script PowerShell autônomo e seguro para realizar atualização com backup,
 * rollback automático e confirmação de inicialização.
 */
export function generatePowerShellUpdaterScript({
  mainPid,
  targetDir,
  sourceDir,
  exePath,
  zipPath,
  extractDir,
  logPath,
  scriptPath,
  backupDir
}) {
  const esc = (s) => (s ? s.replace(/\\/g, '\\\\').replace(/"/g, '`"') : '');

  return `# HyperStream Auto-Updater (PowerShell)
$ErrorActionPreference = 'SilentlyContinue'
$MainPid = ${mainPid}
$TargetDir = "${esc(targetDir)}"
$SourceDir = "${esc(sourceDir)}"
$ExePath = "${esc(exePath)}"
$ZipPath = "${esc(zipPath)}"
$ExtractDir = "${esc(extractDir)}"
$BackupDir = "${esc(backupDir)}"
$LogFile = "${esc(logPath)}"
$ScriptPath = "${esc(scriptPath)}"

function Write-Log($msg) {
    $time = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $LogFile -Value "[$time] $msg" -ErrorAction SilentlyContinue
}

Write-Log "=========================================="
Write-Log "Iniciando atualizador autônomo do HyperStream..."
Write-Log "Diretório Alvo: $TargetDir"
Write-Log "Origem da Nova Versão: $SourceDir"
Write-Log "Caminho do Executável: $ExePath"
Write-Log "Diretório de Backup: $BackupDir"

# 1. Aguarda encerramento do processo principal do Electron (timeout de 15 segundos)
$proc = Get-Process -Id $MainPid -ErrorAction SilentlyContinue
if ($proc) {
    Write-Log "Aguardando término do processo principal (PID: $MainPid)..."
    $waited = 0
    while ((Get-Process -Id $MainPid -ErrorAction SilentlyContinue) -and ($waited -lt 15)) {
        Start-Sleep -Seconds 1
        $waited++
    }
    # Se ainda estiver rodando após 15s, finaliza com segurança
    if (Get-Process -Id $MainPid -ErrorAction SilentlyContinue) {
        Write-Log "Processo principal ainda ativo após 15s. Finalizando com Stop-Process..."
        Stop-Process -Id $MainPid -Force -ErrorAction SilentlyContinue
    }
}

# 2. Finaliza estritamente subprocessos remanescentes do HyperStream pertencentes ao TargetDir
Get-Process -Name "Hyperstream" -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and $_.Path.StartsWith($TargetDir, [System.StringComparison]::OrdinalIgnoreCase)
} | ForEach-Object {
    Write-Log "Finalizando processo remanescente na pasta de instalação: $($_.Id) ($($_.Path))"
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}

# 3. Pausa para liberação completa de handles de arquivos pelo sistema operacional
Start-Sleep -Seconds 1

# 4. Criação de backup prévio da pasta atual para rollback seguro em caso de falha
$backupSuccess = $false
try {
    Write-Log "Criando backup pré-atualização em $BackupDir..."
    if (Test-Path "$BackupDir") {
        Remove-Item -Path "$BackupDir" -Recurse -Force -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Path "$BackupDir" -Force | Out-Null
    Copy-Item -Path "$TargetDir\\*" -Destination "$BackupDir" -Recurse -Force -ErrorAction Stop
    $backupSuccess = $true
    Write-Log "Backup pré-atualização concluído com sucesso."
} catch {
    Write-Log "Aviso: Falha ao criar backup completo: $($_.Exception.Message)"
}

# 5. Cópia segura dos novos arquivos com múltiplas tentativas em caso de bloqueio transitório
$copied = $false
$attempts = 0
$maxAttempts = 6

while (-not $copied -and $attempts -lt $maxAttempts) {
    $attempts++
    Write-Log "Tentativa de substituição de arquivos $attempts de $maxAttempts..."
    try {
        Copy-Item -Path "$SourceDir\\*" -Destination "$TargetDir" -Recurse -Force -ErrorAction Stop
        $copied = $true
        Write-Log "Arquivos da nova versão copiados com sucesso!"
    } catch {
        Write-Log "Tentativa $attempts falhou: $($_.Exception.Message)"
        Start-Sleep -Seconds 1
    }
}

# 6. Se a cópia falhou, executa Rollback automático para não corromper o aplicativo
if (-not $copied) {
    Write-Log "ERRO CRÍTICO: Não foi possível copiar os arquivos atualizados após $maxAttempts tentativas."
    if ($backupSuccess -and (Test-Path "$BackupDir")) {
        Write-Log "Executando ROLLBACK restaurando a versão anterior a partir do backup..."
        Copy-Item -Path "$BackupDir\\*" -Destination "$TargetDir" -Recurse -Force -ErrorAction SilentlyContinue
        Write-Log "Rollback executado. Restaurando inicialização da versão prévia funcional..."
        Start-Process -FilePath "$ExePath" -WorkingDirectory "$TargetDir"
    }
    # Limpeza de artefatos temporários
    Remove-Item -Path "$ExtractDir" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "$ZipPath" -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "$BackupDir" -Recurse -Force -ErrorAction SilentlyContinue
    Start-Process -FilePath "cmd.exe" -ArgumentList ('/c timeout /t 2 /nobreak >nul & del /f /q "' + $ScriptPath + '"') -WindowStyle Hidden
    exit 1
}

# 7. Validação e confirmação de inicialização da nova versão
$launchedSuccessfully = $false
if (Test-Path "$ExePath") {
    Write-Log "Executável atualizado validado em: $ExePath"
    Write-Log "Iniciando nova versão com WorkingDirectory: $TargetDir"
    $newProc = Start-Process -FilePath "$ExePath" -WorkingDirectory "$TargetDir" -PassThru -ErrorAction SilentlyContinue

    # Aguarda 2 segundos para confirmar que o processo estabilizou
    Start-Sleep -Seconds 2

    if ($newProc -and -not $newProc.HasExited) {
        $launchedSuccessfully = $true
        Write-Log "SUCESSO: HyperStream reiniciado e em execução (PID: $($newProc.Id))!"
        # Remove backup apenas após inicialização confirmada da nova versão
        if (Test-Path "$BackupDir") {
            Remove-Item -Path "$BackupDir" -Recurse -Force -ErrorAction SilentlyContinue
        }
    } else {
        $code = if ($newProc) { $newProc.ExitCode } else { "desconhecido" }
        Write-Log "AVISO: Nova versão encerrou imediatamente após inicialização (Código: $code)."
        if ($backupSuccess -and (Test-Path "$BackupDir")) {
            Write-Log "Executando rollback de segurança para versão prévia..."
            Copy-Item -Path "$BackupDir\\*" -Destination "$TargetDir" -Recurse -Force -ErrorAction SilentlyContinue
            Start-Process -FilePath "$ExePath" -WorkingDirectory "$TargetDir"
            Write-Log "Versão prévia restaurada e reiniciada."
        }
    }
} else {
    Write-Log "ERRO CRÍTICO: Executável não encontrado em $ExePath após cópia."
    if ($backupSuccess -and (Test-Path "$BackupDir")) {
        Copy-Item -Path "$BackupDir\\*" -Destination "$TargetDir" -Recurse -Force -ErrorAction SilentlyContinue
        Start-Process -FilePath "$ExePath" -WorkingDirectory "$TargetDir"
    }
}

# 8. Limpeza de arquivos temporários do download e extração
Remove-Item -Path "$ExtractDir" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "$ZipPath" -Force -ErrorAction SilentlyContinue
if (Test-Path "$BackupDir") {
    Remove-Item -Path "$BackupDir" -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Log "Atualizador concluído com status de inicialização: $launchedSuccessfully"
# Remove o próprio script após pequeno delay sem travar locks
Start-Process -FilePath "cmd.exe" -ArgumentList ('/c timeout /t 2 /nobreak >nul & del /f /q "' + $ScriptPath + '"') -WindowStyle Hidden
exit 0
`;
}
