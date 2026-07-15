# BAPG Superbill Pipeline — Session Starter Prompt

Copy and paste the block below at the start of any new Claude session to restore full context instantly.

---

## Paste this at session start:

```
I'm working on the BAPG (Bay Area Podiatry Group) workers' comp billing pipeline.
Here is the full context:

## What this project is

A Node.js pipeline on Windows that:
1. Pulls completed appointments + CPT/ICD-10 codes from DrChrono (EHR)
2. Stores them in a NocoDB queue (self-hosted on DigitalOcean)
3. Syncs submitted claims from DaisyBill (WC billing system) back to NocoDB
4. Pushes CPT/ICD-10 data from NocoDB back into DrChrono to pre-fill CMS-1500s
5. Billers work the queue in NocoDB (filter by Owner, mark Submission Status)
6. Claims marked "Billed" auto-create AR Tracker records with 3 F/U dates

## Working directory
C:\Users\Salte\OneDrive\Desktop\Clinica San Judas\Apps\superbill-pipeline\

## Scripts

| Script | Purpose |
|--------|---------|
| `drchrono-auth.cjs` | One-time OAuth2 flow, saves drchrono-tokens.json |
| `drchrono-sync.cjs` | DrChrono → Airtable (legacy; being migrated) |
| `nocodb/drchrono-sync-nc.cjs` | DrChrono → NocoDB (new) |
| `nocodb/drchrono-billing-push.cjs` | NocoDB CPT/ICD-10 → DrChrono line items |
| `daisybill-sync.cjs` | DaisyBill → Airtable (legacy) |
| `nocodb/daisybill-sync-nc.cjs` | DaisyBill → NocoDB (new) |
| `nocodb/sync-ar-tracker.cjs` | Claims "Billed" → AR Tracker with F/U dates |
| `nocodb/setup-ar-tracker.cjs` | One-time: adds columns to AR Tracker table |
| `nocodb/migrate-from-airtable.cjs` | One-time Airtable → NocoDB migration (done) |
| `nocodb/renumber-claims.cjs` | Re-assigns claim numbers in NocoDB |
| `nocodb/nc-client.cjs` | Shared NocoDB v2 API helpers |
| `nocodb/backfill-dob.cjs` | Fills DOB from DrChrono for all claims |
| `process.cjs` | Watches superbill PDFs folder, parses, writes to Airtable |
| `watch.cjs` | File watcher that calls process.cjs |
| `backfill-insurer.cjs` | Fills insurer field from DrChrono insurance records |

## NocoDB

- Self-hosted on DigitalOcean: http://137.184.211.133:3030
- Domain (HTTPS): https://billing.procare-solutions.net (Caddy reverse proxy, auto SSL)
- Config file: nocodb-config.json
- token: nc_pat_E5nJ7bjHXofiEeF59l78M5zTYArQKAiUIYBuQC7g
- projectId: p6dyfnvms4wa5ua
- claimsTableId: mq54ly1tsuxof5q
- arTableId: mygeowzobnati57

NocoDB v2026.06.2 — uses v2 API for data operations.
Column creation still uses v1: POST /api/v1/db/meta/tables/{tableId}/columns
View creation via API not supported in this version — must use UI.

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
- Patient Name, Date of Service, Insurer
- Submission Date
- F/U Date 1, F/U No. 1 (notes)
- F/U Date 2, F/U No. 2 (notes)
- F/U Date 3, F/U No. 3 (notes)
- Balance Due (Currency — calculation TBD)
- AR Status: Open | Partial | Paid | Denied | Write-Off
- Notes (LongText)

F/U dates are calculated as 7 business days apart starting from Submission Date.
Trigger: claim in Claims Tracker changes to "Billed" → run sync-ar-tracker.cjs --apply

### NocoDB users (all password: ProCare2026x — billers should change on first login)
- teran@baosurgery.com (Owner)
- cesar@procare-solutions.net (Editor)
- araica@procare-solutions.net (Editor)
- arguello@procare-solutions.net (Editor)
- cpineda@procare-solutions.net (Editor)
- uriarte@procare-solutions.net (Editor)

### NocoDB views in Claims Tracker
- General Overview (default, all records)
- Salvador, Alejandro, Cesar, Joseling, Eduardo (filtered by Owner, Status != Done)
- Unclaimed (Owner = Unclaimed)
- Sent (Submission Status = Sent)

## Airtable (legacy — being phased out)
- Base: appbB5puT1FyWGd5E
- Claims: tblZiyYJQEfLiMEfz
- A/R: tbleuFZMh6LRCGBNp
- PAT: (rotated — do not commit)

## DaisyBill
- API base: https://go.daisybill.com/api/v1
- API key (rotate if shared): Eew9UBykTwEqVD9qhBKPccRScrRF9L1zo9Lx
- Billing provider ID: 4204
- Pagination: ?page=N, page_size=25 (break when items < 25)
- Bill → Injury: bill.links[].find(rel='injury').href → injury.claim_number + injury.links[].find(rel='patient').href
- Note: DaisyBill refused to sign a BAA (documented in writing)

## DrChrono
- Practice: jennyyudpm.drchrono.com
- Doctor ID: 245533
- OAuth config: drchrono-config.json (client_id/secret/redirect_uri)
- Tokens: drchrono-tokens.json (48h expiry; auto-refreshed in all scripts)
- Key endpoints used:
  - GET /api/patients?chart_id={mrn}&doctor=245533 → find patient by MRN
  - GET /api/patients?last_name=X&first_name=Y&doctor=245533 → find by name
  - GET /api/appointments?patient={id}&date={dos} → find appointment
  - GET /api/line_items?appointment={id} → existing CPT codes
  - POST /api/line_items → add CPT code to appointment
  - PATCH /api/appointments/{id} → update icd10_codes
  - GET /api/insurances?patient={id} → patient insurance

## Claim number format
{YYYYMMDD}-{MRN}          — came from DrChrono (chart_id exists)
{YYYYMMDD}-{LAST4FIRST4}  — manual entry, no MRN (last4+first4 of patient name)
{YYYYMMDD}-UNKN-N         — no patient name either
Duplicates on same key get suffix -1, -2, -3...

## Infrastructure
- Server: DigitalOcean droplet 137.184.211.133 (ubuntu-s-1vcpu-2gb-nyc1)
- Docker containers: nocodb_nocodb_1, nocodb_postgres_1, caddy, synapse, livekit
- NocoDB DB: PostgreSQL (not SQLite). Credentials: user=nocodb, pass=nocodb_pass_2026, db=nocodb, host=postgres:5432
- Caddy config: /opt/caddy/Caddyfile — reload with: docker exec caddy caddy reload --config /etc/caddy/Caddyfile
- To reset a user password via DB: use heredoc to avoid $ expansion issues (see Key decisions)

## Key decisions made
- NocoDB v2 API (NOT v1) — server is v2026.06.2
- Bulk PATCH: PATCH /api/v2/tables/{tableId}/records with array of {Id, ...fields}
- SingleSelect options must be pre-created (PATCH column meta before inserting new values)
- DrChrono tokens refresh automatically; re-run drchrono-auth.cjs only if refresh_token fails
- process.cjs and watch.cjs still write to Airtable (migration pending)
- DaisyBill: links field is an ARRAY [{rel, href}], not an object — use .find(l=>l.rel==='injury')
- Password resets via psql must use heredoc << 'SQL' to avoid bash expanding $ in bcrypt hashes
- NocoDB view creation via API returns 404 — create views manually in UI

## What's still pending
- [ ] Switch watch.cjs + process.cjs to write NocoDB instead of Airtable
- [ ] Task Scheduler: auto-start watch.cjs on Windows boot
- [ ] Run drchrono-billing-push.cjs --apply for full DrChrono backfill
- [ ] Sign DigitalOcean BAA (HIPAA)
- [ ] Balance Due calculation logic in AR Tracker (TBD)
- [ ] billing.procare-solutions.net DNS propagation — verify HTTPS works
```

---

## Quick command reference

```bash
# Refresh DrChrono tokens (if expired)
node drchrono-auth.cjs

# Pull new DrChrono appointments into NocoDB
node nocodb/drchrono-sync-nc.cjs 2026-07-01 2026-07-07

# Push CPT/ICD-10 from NocoDB into DrChrono (dry run first)
node nocodb/drchrono-billing-push.cjs
node nocodb/drchrono-billing-push.cjs --apply

# Sync DaisyBill submitted claims → NocoDB
node nocodb/daisybill-sync-nc.cjs --apply

# Sync Billed claims → AR Tracker (run after billers mark claims as Billed)
node nocodb/sync-ar-tracker.cjs
node nocodb/sync-ar-tracker.cjs --apply

# Backfill DOB from DrChrono
node nocodb/backfill-dob.cjs --apply

# Re-run claim number assignment
node nocodb/renumber-claims.cjs --apply
```

## Architecture diagram

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
  marks claims Billed                                   │
                                                        │ sync-ar-tracker.cjs
                                                        ▼
                                               NocoDB AR Tracker
                                               (F/U dates, Balance Due)
                                                        │
                                                 Billers work queue
                                                 (views by Owner)
```
