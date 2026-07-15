@echo off
echo Instalando tarea programada BAPG-AR-Tracker-Sync...

PowerShell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$action = New-ScheduledTaskAction -Execute 'node' -Argument '\"C:\Users\Salte\OneDrive\Desktop\Clinica San Judas\Apps\superbill-pipeline\nocodb\sync-ar-tracker.cjs\" --apply' -WorkingDirectory 'C:\Users\Salte\OneDrive\Desktop\Clinica San Judas\Apps\superbill-pipeline'; $trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Hours 1) -Once -At '00:00'; $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -StartWhenAvailable; Register-ScheduledTask -TaskName 'BAPG-AR-Tracker-Sync' -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force"

if %ERRORLEVEL% == 0 (
    echo.
    echo Tarea instalada correctamente.
    echo Corre cada hora automaticamente.
    echo Para verla: Inicio ^> Task Scheduler ^> BAPG-AR-Tracker-Sync
) else (
    echo.
    echo ERROR al instalar. Asegurate de correr este archivo como Administrador.
)
pause
