param(
    [Parameter(Mandatory=$true)]
    [int]$TargetPid
)

$ErrorActionPreference = "SilentlyContinue"

while ($true) {
    $proc = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
    if (-not $proc) {
        Write-Output "EXIT"
        break
    }
    $cpuSec = $proc.CPU
    if ($null -eq $cpuSec) { $cpuSec = 0 }
    
    $counterPath = "\GPU Engine(pid_${TargetPid}_*engtype_video codec engine*)\Utilization Percentage"
    $samples = (Get-Counter $counterPath -ErrorAction SilentlyContinue).CounterSamples
    $gpuVal = 0.0
    if ($samples -and $samples.Count -gt 0) {
        foreach ($s in $samples) {
            if ($s.CookedValue -gt $gpuVal) {
                $gpuVal = $s.CookedValue
            }
        }
    }
    
    $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    Write-Output "MONITOR,${timestamp},${cpuSec},${gpuVal}"
    Start-Sleep -Milliseconds 1000
}
