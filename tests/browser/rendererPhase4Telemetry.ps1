$ErrorActionPreference = 'Continue'
$destination = Join-Path $PSScriptRoot '../../tmp/renderer-phase4/telemetry.jsonl'
$stopPath = Join-Path $PSScriptRoot '../../tmp/renderer-phase4/telemetry.stop'
$machine = @{}
$machine.cpu = Get-CimInstance Win32_Processor | Select-Object Name,CurrentClockSpeed,MaxClockSpeed
$machine.gpu = Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,AdapterRAM
$machine.sensorErrors = @()
foreach ($query in @(@{Namespace='root/wmi';ClassName='MSAcpi_ThermalZoneTemperature'},@{Namespace='root/LibreHardwareMonitor';ClassName='Sensor'},@{Namespace='root/OpenHardwareMonitor';ClassName='Sensor'})) {
  try { $machine[$query.Namespace] = Get-CimInstance @query -ErrorAction Stop } catch { $machine.sensorErrors += $_.Exception.Message }
}
$machine | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $PSScriptRoot '../../tmp/renderer-phase4/telemetry-machine.json')
$paths = @('\Processor Information(_Total)\% Processor Performance','\Processor Information(_Total)\Processor Frequency','\Processor(_Total)\% Processor Time','\GPU Adapter Memory(*)\Dedicated Usage','\GPU Adapter Memory(*)\Shared Usage','\GPU Engine(*)\Utilization Percentage')
$deadline = (Get-Date).AddHours(3)
while (!(Test-Path -LiteralPath $stopPath) -and (Get-Date) -lt $deadline) {
  $record = @{utc=[DateTime]::UtcNow.ToString('o')}
  try { $record.counters = (Get-Counter $paths -ErrorAction Stop).CounterSamples | Where-Object { $_.CookedValue -gt 0 } | Select-Object Path,CookedValue } catch { $record.error = $_.Exception.Message }
  $record.chrome = @(Get-Process chrome -ErrorAction SilentlyContinue | Select-Object Id,CPU,WorkingSet64,PrivateMemorySize64)
  $record | ConvertTo-Json -Depth 6 -Compress | Add-Content -LiteralPath $destination
  Start-Sleep -Seconds 2
}
