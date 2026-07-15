# BAPG Billing Pipeline — Session Starter Prompt

Copy and paste the block below at the start of any new Claude session to restore full context instantly.

---

## Paste this at session start:

```
I'm working on the BAPG (Bay Area Podiatry Group) workers' comp billing pipeline.
Here is the full context:

## What this project is

A Node.js pipeline on Windows that automates WC billing:

1. Pull completed appointments from DrChrono API → NocoDB Claims Tracker
2. NocoDB checks DaisyBill to skip claims already submitted
3. Billers work the queue in NocoDB (assign Owner, update Submission Status)
4. Claims marked "Billed" auto-create AR Tracker records with 3 F/U dates (7 business days apart)
5. AR team works follow-ups in AR Tracker

Superbills are NOT part of this workflow. Airtable is legacy and fully replaced by NocoDB.

## Working directory
C:\Users\Salte\OneDrive\Desktop\Clinica San Judas\Apps\superbill-pipeline\

## GitHub
https://github.com/Salteran24/bapg-billing-pipeline (private)

## Active scripts

| Script | Purpose |
|--------|---------|
| `drchrono-auth.cjs` | One-time OAuth2 flow, saves drchrono-tokens.json |
| `nocodb/drchrono-sync-nc.cjs` | DrChrono appointments → NocoDB Claims Tracker |
| `nocodb/drchrono-billing-push.cjs` | NocoDB CPT/ICD-10 → DrChrono line items |
| `nocodb/daisybill-sync-nc.cjs` | DaisyBill submitted claims → NocoDB (dedup check) |
| `nocodb/sync-ar-tracker.cjs` | Claims "Billed" → AR Tracker with F/U dates |
| `nocodb/setup-ar-tracker.cjs` | One-time: adds columns to AR Tracker table |
| `nocodb/nc-client.cjs` | Shared NocoDB v2 API helpers |
| `nocodb/backfill-dob.cjs` | Fills DOB from DrChrono for all claims |
| `nocodb/renumber-claims.cjs` | Re-assigns claim numbers in NocoDB |
| `watch.cjs` / `watch-nc.cjs` | File watcher (legacy — Airtable; migration pending) |
| `matrix-notify.cjs` | Sends notifications to Element Matrix chat |
| `install-ar-sync-task.bat` | Installs hourly Task Scheduler task for sync-ar-tracker |

## NocoDB

- Self-hosted on DigitalOcean: http://137.184.211.133:3030
- Domain (HTTPS): https://billing.procare-solutions.net (Caddy reverse proxy, auto SSL)
- Config file: nocodb-config.json (NOT committed — contains token)
- token: nc_pat_E5nJ7bjHXofiEeF59l78M5zTYArQKAiUIYBuQC7g
- projectId: p6dyfnvms4wa5ua
- claimsTableId: mq54ly1tsuxof5q
- arTableId: mygeowzobnati57

NocoDB v2026.06.2 — uses v2 API for data operations.
Column creation uses v1: POST /api/v1/db/meta/tables/{tableId}/columns
View creation via API not supported — must use UI.

### Claims Tracker fields
- Claim Number: {YYYYMMDD}-{MRN} | {YYYYMMDD}-{LAST4FIRST4} | {YYYYMMDD}-UNKN-N
- Patient Name, MRN, Date of Birth, Date of Service, Insurer
- CPT Codes (comma-separated), ICD-10 Codes (comma-separated)
- Charges (number), Action Notes (LongText), DrChrono Appt ID
- Submission Status: Not Started | Pending | Billed | Canceled
- Owner: Unclaimed | Salvador | Alejandro | Cesar | Joseling | Eduardo
- Submission Date

### AR Tracker fields
- Claim (text — matches Claim Number in Claims Tracker)
- Patient Name, Date of Service, Insurer, Submission Date
- F/U Date 1, F/U No. 1 (notes)
- F/U Date 2, F/U No. 2 (notes)
- F/U Date 3, F/U No. 3 (notes)
- Balance Due (Currency — calculation TBD)
- AR Status: Open | Partial | Paid | Denied | Write-Off
- Notes (LongText)

F/U dates: 7 business days apart starting from Submission Date.
Trigger: claim → "Billed" → run sync-ar-tracker.cjs --apply (runs hourly via Task Scheduler)

### NocoDB users (all initial password: ProCare2026x)
- teran@baosurgery.com (Owner)
- cesar@procare-solutions.net (Editor)
- araica@procare-solutions.net (Editor)
- arguello@procare-solutions.net (Editor)
- cpineda@procare-solutions.net (Editor)
- uriarte@procare-solutions.net (Editor)

### NocoDB views in Claims Tracker
- General Overview (default, all records)
- Salvador, Alejandro, Cesar, Joseling, Eduardo (filtered by Owner)
- Unclaimed (Owner = Unclaimed)
- Sent (filter may need update to Pending after status rename)

## DaisyBill
- API base: https://go.daisybill.com/api/v1
- API key: in nocodb-config.json (NOT committed)
- Billing provider ID: 4204
- Pagination: ?page=N, page_size=25 (break when items < 25)
- Bill → Injury: bill.links[].find(rel='injury').href → injury.claim_number
- Note: DaisyBill refused to sign a BAA (documented in writing)

## DrChrono
- Practice: jennyyudpm.drchrono.com
- Doctor ID: 245533
- OAuth config: drchrono-config.json (NOT committed)
- Tokens: drchrono-tokens.json (NOT committed — 48h expiry, auto-refreshed)
- Key endpoints:
  - GET /api/patients?chart_id={mrn}&doctor=245533
  - GET /api/appointments?patient={id}&date={dos}
  - GET /api/line_items?appointment={id}
  - POST /api/line_items → add CPT code
  - PATCH /api/appointments/{id} → update icd10_codes
  - GET /api/insurances?patient={id}

## Claim number format
{YYYYMMDD}-{MRN}          — from DrChrono (chart_id exists)
{YYYYMMDD}-{LAST4FIRST4}  — manual entry, no MRN
{YYYYMMDD}-UNKN-N         — no patient name
Duplicates get suffix: -1, -2, -3...

## Infrastructure
- Server: DigitalOcean droplet 137.184.211.133 (ubuntu-s-1vcpu-2gb-nyc1)
- Docker containers: nocodb_nocodb_1, nocodb_postgres_1, caddy, synapse, livekit
- NocoDB DB: PostgreSQL. Credentials: user=nocodb, pass=nocodb_pass_2026, db=nocodb
- Caddy config: /opt/caddy/Caddyfile — reload: docker exec caddy caddy reload --config /etc/caddy/Caddyfile
- Element/Matrix: chat.procare-solutions.net (synapse container, same server)
  - "Billing Notification" room for daily/automated alerts

## Key technical decisions
- NocoDB v2 API (NOT v1) for all data operations
- Bulk PATCH: PATCH /api/v2/tables/{tableId}/records with array of {Id, ...fields}
- SingleSelect options must be pre-created before inserting new values
- DrChrono tokens auto-refresh; re-run drchrono-auth.cjs only if refresh_token fails
- Password resets via psql must use heredoc << 'SQL' to avoid bash expanding $ in bcrypt hashes
- NocoDB view creation via API returns 404 — create views manually in UI

## What's still pending
- [ ] Daily Element notification: unclaimed DOS count, billed yesterday, new cases last 24h
- [ ] Switch watch.cjs to write NocoDB instead of Airtable (Airtable fully phased out)
- [ ] Task Scheduler: auto-start watch.cjs on Windows boot
- [ ] Run drchrono-billing-push.cjs --apply for full DrChrono backfill
- [ ] Sign DigitalOcean BAA (HIPAA)
- [ ] Balance Due calculation logic in AR Tracker
- [ ] Billers should change password ProCare2026x on first login
- [ ] Rotate Airtable PAT (was hardcoded in old scripts before cleanup)
```

---

## Quick command reference

```bash
# Refresh DrChrono tokens (if expired)
node drchrono-auth.cjs

# Pull today's DrChrono appointments into NocoDB
node nocodb/drchrono-sync-nc.cjs 2026-07-14 2026-07-14

# Push CPT/ICD-10 from NocoDB into DrChrono (dry run first)
node nocodb/drchrono-billing-push.cjs
node nocodb/drchrono-billing-push.cjs --apply

# Sync DaisyBill submitted claims → NocoDB
node nocodb/daisybill-sync-nc.cjs --apply

# Sync Billed claims → AR Tracker
node nocodb/sync-ar-tracker.cjs
node nocodb/sync-ar-tracker.cjs --apply

# Backfill DOB from DrChrono
node nocodb/backfill-dob.cjs --apply

# Re-run claim number assignment
node nocodb/renumber-claims.cjs --apply
```

## Architecture

```
DrChrono (EHR)
  /api/appointments
  /api/line_items          drchrono-sync-nc.cjs
  /api/patients     ──────────────────────────► NocoDB Claims Tracker
       ▲                                        (billing.procare-solutions.net)
       │ drchrono-billing-push.cjs                      │
       ◄────────────────────────────────────────────────┤
                                                        │
DaisyBill (WC billing)       daisybill-sync-nc.cjs     │
  /api/v1/bills      ────────────────────────────────► │
  dedup check on pull                                   │
                                                        │ sync-ar-tracker.cjs (hourly)
                                                        ▼
                                               NocoDB AR Tracker
                                               (F/U dates, AR Status)
                                                        │
                                                 Billers work queue        Element
                                                 (views by Owner)   ──►  "Billing Notification"
```
