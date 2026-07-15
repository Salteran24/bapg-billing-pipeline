# BAPG Superbill Pipeline

Medical billing pipeline for **Bay Area Podiatry Group (BAPG)**.  
Connects DrChrono (EHR) → PDF Superbill Drop → Airtable (Claims Tracker) → DaisyBill (WC billing).

---

## Architecture

```
PDF Superbills (drop folder)
        │
        ▼
    watch.cjs  ──►  backfill-insurer.cjs  (fills insurer from PDF)
        │
        ▼
    process.cjs  (extracts patient/DOS/CPT/ICD-10 from PDF → Airtable)
        │
        ▼
   Airtable Claims Tracker  ◄──  drchrono-sync.cjs  (DrChrono appointments)
        │
        ▼
   daisybill-sync.cjs  (marks submitted WC bills as "Sent")
```

---

## Airtable

| Resource | ID |
|---|---|
| Base | `appbB5puT1FyWGd5E` |
| Claims Tracker table | `tblZiyYJQEfLiMEfz` |
| A/R Tracker table | `tbleuFZMh6LRCGBNp` |
| Patients table | `tblysrW3BRLIFZ3vQ` |
| PAT (Personal Access Token) | `patnBokJEopKE8Lvm.f391eef36e...` (see scripts) |

### Claims Tracker — key fields

| Field | Notes |
|---|---|
| `Claim Number` | Formula: `YYYYMMDD-{MRN}` (e.g. `20260611-SMJO000001`). Same-day duplicates get `-1`, `-2` suffix. |
| `Tacking Number (CH)` | DrChrono appointment ID — used to deduplicate on re-sync |
| `Date of Service` | ISO date `YYYY-MM-DD` |
| `Action Notes` | Multi-line: `PATIENT:`, `DrChrono:`, `MRN:`, `Insurer:`, `CPT:`, `ICD-10:`, `Charges:` |
| `CPT Codes` | Formula field — extracts CPT line from Action Notes |
| `Submission Status` | Single-select: `Not Started`, `Sent`, `Done` |
| `Submission Date` | Date set by daisybill-sync when marked Sent |
| `Owner` | Single-select biller assignment; unclaimed = `Unclaimed` |
| `Assigned To` | Collaborator field for per-biller work queue |

---

## Scripts

### `watch.cjs` — PDF inbox watcher
Polls `C:\Users\Salte\OneDrive\Desktop\Superbill Inbox` every 5 seconds.  
When a new PDF appears it runs (in order):
1. `backfill-insurer.cjs` — fills insurer name into existing Airtable records
2. `process.cjs` — extracts claims from the PDF and creates new Airtable records
3. Moves the PDF to `processed/`

**Start:**
```powershell
cd "C:\Users\Salte\OneDrive\Desktop\Clinica San Judas\Apps\superbill-pipeline"
node watch.cjs
```

---

### `process.cjs` — PDF → Airtable
Reads a superbill PDF, extracts patient name, DOS, CPT codes, ICD-10, insurer.  
Creates records in Claims Tracker + A/R Tracker.

**Manual run:**
```powershell
node process.cjs "C:\path\to\superbill.pdf"
```

---

### `backfill-insurer.cjs` — Insurer backfill from PDF
Reads a PDF, extracts `(patient_name, DOS, insurer)` triples, then PATCHes matching Airtable claims.  
Matches ALL claims (not just DrChrono-sourced) by normalized name + DOS.

**Manual run:**
```powershell
node backfill-insurer.cjs "C:\path\to\superbill.pdf"
```

---

### `drchrono-sync.cjs` — DrChrono → Airtable
Fetches completed appointments from DrChrono API and creates claims in Airtable.  
Deduplicates via `Tacking Number (CH)` (stores DrChrono appointment ID).

**Usage:**
```powershell
# Last 7 days (default)
node drchrono-sync.cjs

# Specific date range
node drchrono-sync.cjs 2026-01-01 2026-03-31
```

**Notes:**
- Requires `drchrono-tokens.json` — run `drchrono-auth.cjs` once first if missing
- Insurance always falls back to `Self-Pay` (DrChrono billing module not in use); real insurer comes from PDF via `backfill-insurer.cjs`
- Token auto-refreshes when within 10 min of expiry (48h lifetime)

---

### `drchrono-auth.cjs` — One-time OAuth setup
Opens browser to DrChrono OAuth, catches callback on `localhost:8000`, saves tokens to `drchrono-tokens.json`.

```powershell
node drchrono-auth.cjs
```

**Important:** Do NOT include a `scope` parameter — DrChrono returns `invalid_scope` with any scope value. The default scopes include everything needed.

---

### `daisybill-sync.cjs` — DaisyBill → Airtable status sync
Pulls all submitted WC bills from DaisyBill API and marks matching Airtable claims as `Sent`.

Match key: normalized `patient_name` + `date_of_service`  
Statuses treated as "sent": `processed`, `submitted`, `denied`, `paid`, `appealed`, `forwarded`

```powershell
# Dry run (preview only, no writes)
node daisybill-sync.cjs

# Apply changes
node daisybill-sync.cjs --apply
```

**Performance:** ~5 minutes for 1,500+ bills (DaisyBill API returns 25/page, injury chain requires individual calls; patients are cached).

---

## DrChrono API

| Detail | Value |
|---|---|
| Base URL | `https://drchrono.com` |
| Auth | OAuth2 Bearer token |
| Config file | `drchrono-config.json` |
| Tokens file | `drchrono-tokens.json` |
| Appointments | `GET /api/appointments?date_range=YYYY-MM-DD/YYYY-MM-DD&status=Complete` |
| Patients | `GET /api/patients/{id}` — `chart_id` field = MRN |
| Line items | `GET /api/line_items?appointment={id}` — CPT codes |

---

## DaisyBill API

| Detail | Value |
|---|---|
| Base URL | `https://go.daisybill.com/api/v1` |
| Auth | `Authorization: Bearer {API_KEY}` |
| Billing provider ID | `4204` |
| Bills | `GET /billing_providers/4204/bills?page=N` (25/page, `per_page` blocked) |
| Patients | `GET /billing_providers/4204/patients?page=N` |
| Bill → patient chain | `bill.links[injury].href` → `injury.links[patient].href` → patient name |

**API key:** stored in `daisybill-sync.cjs` (regenerate at `go.daisybill.com/users/{id}/api_tokens` if compromised)

---

## Claim Number Format

```
YYYYMMDD-{MRN}          →  20260611-SMJO000001
YYYYMMDD-{MRN}-1        →  20260611-SMJO000001-1   (first of two same-day)
YYYYMMDD-{MRN}-2        →  20260611-SMJO000001-2   (second of two same-day)
```

MRN = DrChrono `chart_id` field.  
For PDF-only claims (no DrChrono), claim number is set by `process.cjs` using the same pattern.

---

## Standard Workflows

### Daily — process new superbills
Drop PDFs into `C:\Users\Salte\OneDrive\Desktop\Superbill Inbox`.  
`watch.cjs` handles them automatically if running.

Or manually:
```powershell
node process.cjs "C:\...\superbill.pdf"
node backfill-insurer.cjs "C:\...\superbill.pdf"
```

### Weekly — sync DrChrono appointments
```powershell
node drchrono-sync.cjs
```

### After submitting bills in DaisyBill — mark as Sent
```powershell
node daisybill-sync.cjs --apply
```

### Auto-start watcher on boot (Task Scheduler)
- Program: `node`
- Arguments: `"C:\Users\Salte\OneDrive\Desktop\Clinica San Judas\Apps\superbill-pipeline\watch.cjs"`
- Trigger: At log on

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| DrChrono 403 on auth | `scope` param in OAuth request | Remove scope entirely from auth URL |
| DrChrono token expired | Tokens > 48h old | Run `node drchrono-auth.cjs` |
| Backfill 0 matches | Filter was excluding PDF-only claims | `backfill-insurer.cjs` now matches ALL claims |
| Airtable 422 on field create | Sending unsupported params (`isValid`, etc.) | Only send `name`, `type`, `options` |
| Airtable formula field `CHAR` error | Formula engine doesn't support `CHAR()` | Use `"\\n"` literal for newlines |
| DaisyBill returns 25 bills only | Default page size is 25; `per_page` param is 403 | Paginate with `?page=N` until empty response |
| `set-unclaimed.cjs` 404 | Tried `GET /meta/bases/.../fields` for option creation | Use `typecast: true` on PATCH instead |

---

## One-time setup scripts (already run, keep for reference)

| Script | What it did |
|---|---|
| `add-cpt-field.cjs` | Created `CPT Codes` formula field (`fldWFgp9yWuP3vsrQ`) |
| `add-assigned-to.cjs` | Created `Assigned To` collaborator field (`fldzdmITJeh9wUhpL`) |
| `set-unclaimed.cjs` | Set `Owner = Unclaimed` on all blank-owner claims |
| `create-ar-table.cjs` | Created A/R Tracker table |
| `add-ar-fields.cjs` | Added fields to A/R Tracker |
| `patch-claim-numbers.cjs` | Backfilled claim numbers to `YYYYMMDD-MRN` format |
