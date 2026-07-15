@echo off
:: Run this file as Administrator (right-click -> Run as administrator)
:: Creates a Windows Task Scheduler job that runs drchrono-sync every day at 8 PM

set SCRIPT_DIR=C:\Users\Salte\OneDrive\Desktop\Clinica San Judas\Apps\superbill-pipeline
set NODE_EXE=C:\Program Files\nodejs\node.exe

echo Creating scheduled task: BAPG DrChrono Daily Sync...

schtasks /create /tn "BAPG DrChrono Daily Sync" ^
  /tr "\"%NODE_EXE%\" nocodb/drchrono-sync-nc.cjs" ^
  /sc daily /st 20:00 ^
  /sd 07/10/2026 ^
  /rl HIGHEST ^
  /f ^
  /ru "%USERNAME%"

if %ERRORLEVEL% == 0 (
  echo.
  echo SUCCESS - Task scheduled to run every day at 8:00 PM
  echo Working directory needs to be set - running fix...

  :: Use PowerShell to set the working directory since schtasks doesn't support it directly
  powershell -Command "$action = New-ScheduledTaskAction -Execute '\"%NODE_EXE%\"' -Argument 'nocodb/drchrono-sync-nc.cjs' -WorkingDirectory '%SCRIPT_DIR%'; Set-ScheduledTask -TaskName 'BAPG DrChrono Daily Sync' -Action $action"

  echo.
  echo Done! DrChrono will sync automatically every day at 8:00 PM.
  echo You can verify in Task Scheduler -^> Task Scheduler Library -^> BAPG DrChrono Daily Sync
) else (
  echo.
  echo ERROR: Could not create task. Make sure you ran this as Administrator.
)

pause
