@echo off
REM ─── BAPG Denial Notifier ────────────────────────────────────────────────────
REM Runs denial-notifier.cjs every 30 minutes via Windows Task Scheduler.
REM
REM SETUP (one time):
REM   1. Run: node setup-matrix-room.cjs
REM   2. Copy the printed MATRIX_BOT_TOKEN and MATRIX_ROOM_ID values below.
REM
REM TO REGISTER AS A SCHEDULED TASK (run this bat once as Administrator):
REM   See the TASK SCHEDULER SETUP section at the bottom of this file.
REM ─────────────────────────────────────────────────────────────────────────────

REM ⬇ PASTE VALUES FROM setup-matrix-room.cjs OUTPUT HERE:
set MATRIX_BOT_TOKEN=syt_ZGVuaWFsLWJvdA_JLmeFNPisKIWmWklRWLZ_3mW82y
set MATRIX_ROOM_ID=!XmEUfnidmsKCWYAaeT:chat.procare-solutions.net

cd /d "C:\Users\Salte\OneDrive\Desktop\Clinica San Judas\Apps\superbill-pipeline"
node denial-notifier.cjs >> denial-notifier.log 2>&1

REM ─── TASK SCHEDULER SETUP ────────────────────────────────────────────────────
REM Run the following command once from an Administrator PowerShell or CMD
REM to register this bat as a task that runs every 30 minutes:
REM
REM schtasks /create /tn "BAPG Denial Notifier" /tr "\"C:\Users\Salte\OneDrive\Desktop\Clinica San Judas\Apps\superbill-pipeline\run-denial-notifier.bat\"" /sc minute /mo 30 /ru SYSTEM /f
REM
REM To check if it registered:
REM   schtasks /query /tn "BAPG Denial Notifier"
REM
REM To run it immediately (for testing):
REM   schtasks /run /tn "BAPG Denial Notifier"
REM
REM To remove it:
REM   schtasks /delete /tn "BAPG Denial Notifier" /f
REM ─────────────────────────────────────────────────────────────────────────────
