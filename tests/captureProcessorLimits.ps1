# Processor-only Windows event trace. Requires Administrator, changes no power
# or fan settings, installs nothing, and stops only the session it creates.
param([ValidateRange(10,120)][int]$DurationSeconds = 60)
$ErrorActionPreference = 'Stop'
$directory = Join-Path $PSScriptRoot '../tmp/viewport-fps/processor-trace'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$directory = (Resolve-Path -LiteralPath $directory).Path
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$traceName = "ExtaplanCpuPower-$PID"
$tracePath = Join-Path $directory "$stamp.etl"
$counterPath = Join-Path $directory "$stamp-counters.jsonl"
$statusPath = Join-Path $directory 'status.json'
$started = $false
$attempted = $false
$failed = $false
function Write-TraceStatus($state, $detail) {
    [pscustomobject]@{State=$state;Detail=$detail;Utc=[DateTime]::UtcNow.ToString('o');Pid=$PID;Session=$traceName;Trace=$tracePath;Counters=$counterPath} |
        ConvertTo-Json | Set-Content -LiteralPath $statusPath
}
try {
    # Keyword 0x2 is this provider's Diag keyword: includes CPU thermal-cap and
    # performance-constraint events. No file/network/application providers.
    $attempted = $true
    logman create trace $traceName -p '{0F67E49F-FE51-4E9F-B490-6F2948CC6027}' 0x2 5 -o $tracePath -f bincirc -max 32 -ets
    if ($LASTEXITCODE -ne 0) { throw 'Could not start processor trace. Run this script as Administrator.' }
    $started = $true
    Write-TraceStatus 'recording' "Recording for $DurationSeconds seconds"
    $paths = @('\Processor Information(_Total)\Performance Limit Flags',
        '\Processor Information(_Total)\% Performance Limit',
        '\Processor Information(_Total)\% Processor Performance',
        '\Processor Information(_Total)\Processor Frequency')
    Get-Counter -Counter $paths -SampleInterval 2 -MaxSamples ([Math]::Ceiling($DurationSeconds / 2)) |
        ForEach-Object {
            [pscustomobject]@{Utc=$_.Timestamp.ToUniversalTime().ToString('o');Counters=@($_.CounterSamples | Select-Object Path,CookedValue,Status)} |
                ConvertTo-Json -Depth 5 -Compress | Add-Content -LiteralPath $counterPath
        }
} catch {
    $failed = $true
    Write-TraceStatus 'failed' $_.Exception.Message
    throw
} finally {
    # logman can create an empty session before failing to enable a privileged
    # provider. Attempt cleanup of our unique name even when creation failed.
    if ($attempted) {
        logman stop $traceName -ets
        if ($LASTEXITCODE -ne 0 -and $started) {
            Write-TraceStatus 'cleanup-failed' 'Could not stop the task-owned trace session.'
            throw "Could not stop $traceName"
        }
        if (-not $failed) { Write-TraceStatus 'complete' 'Stopped processor-only trace. Power/fan settings unchanged.' }
    }
}
