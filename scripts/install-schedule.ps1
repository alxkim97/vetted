# Registers a daily Windows scheduled task that runs the RM folder scan.
# Run once from this folder:  powershell -ExecutionPolicy Bypass -File scripts\install-schedule.ps1 [-Time 08:30]
# Remove it again with:       Unregister-ScheduledTask -TaskName "Vetted scan" -Confirm:$false
param([string]$Time = "08:30")

$dir = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$action = New-ScheduledTaskAction -Execute $node -Argument "scripts\scan.js --trigger schedule" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
# StartWhenAvailable: if the PC was off at $Time, run as soon as it's back on.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName "Vetted scan" -Action $action -Trigger $trigger -Settings $settings -Description "Scans Raw Material Evaluation Document into Vetted (Supabase)" -Force | Out-Null
Write-Host "Scheduled 'Vetted scan' daily at $Time (runs late if the PC was off)."
