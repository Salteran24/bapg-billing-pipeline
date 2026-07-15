# NocoDB Setup Guide — BAPG Billing

Complete this in order. Takes about 20 minutes total.

---

## Step 1 — Deploy NocoDB on DigitalOcean

1. Go to [https://cloud.digitalocean.com/droplets](https://cloud.digitalocean.com/droplets)
2. Click your droplet (`137.184.211.133`)
3. Click **Access** → **Launch Droplet Console** (opens a browser terminal)
4. Paste this entire block and press Enter:

```bash
mkdir -p /opt/nocodb && cd /opt/nocodb && cat > docker-compose.yml << 'EOF'
version: "3.8"
services:
  nocodb:
    image: nocodb/nocodb:latest
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      NC_DB: "pg://postgres:5432?u=nocodb&p=nocodb_pass_2026&d=nocodb"
      NC_AUTH_JWT_SECRET: "bapg-secret-jwt-2026-nocodb"
    volumes:
      - nocodb_data:/usr/app/data
    depends_on:
      - postgres
  postgres:
    image: postgres:15-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: nocodb
      POSTGRES_PASSWORD: nocodb_pass_2026
      POSTGRES_DB: nocodb
    volumes:
      - pg_data:/var/lib/postgresql/data
volumes:
  nocodb_data:
  pg_data:
EOF
docker compose pull && docker compose up -d && ufw allow 8080/tcp
```

5. Wait about 30 seconds, then open: **http://137.184.211.133:8080**

---

## Step 2 — Create admin account

1. At the NocoDB URL, click **Sign Up**
2. Use your email (`teran@baosurgery.com`) and create a password
3. You're now inside NocoDB

---

## Step 3 — Get API token

1. Click your avatar (bottom-left) → **Team & Settings**
2. Click **API Tokens** tab → **Add New Token**
3. Name it `pipeline` → click **Add**
4. Copy the token shown (you only see it once)

---

## Step 4 — Create tables (run on your Windows machine)

Open PowerShell in the pipeline folder and run:

```powershell
cd "C:\Users\Salte\OneDrive\Desktop\Clinica San Judas\Apps\superbill-pipeline"
node nocodb/nocodb-setup.cjs --token YOUR_TOKEN_HERE
```

This creates:
- **Claims Tracker** table with all fields
- **A/R Tracker** table
- Writes `nocodb-config.json` with all IDs for the other scripts

---

## Step 5 — Migrate existing Airtable data

```powershell
node nocodb/migrate-from-airtable.cjs
```

Copies all 450+ existing claims from Airtable into NocoDB. Safe to re-run.

---

## Step 6 — Test the DaisyBill sync

```powershell
# Dry run first
node nocodb/daisybill-sync-nc.cjs

# Apply if it looks right
node nocodb/daisybill-sync-nc.cjs --apply
```

---

## Step 7 — Set up biller views (in NocoDB UI)

For each biller, create a filtered **Gallery** or **Grid** view:

1. In the Claims Tracker table, click **+ Add View** → **Grid**
2. Name it after the biller (e.g. "Maria's Queue")
3. Click **Filter** → Add filter: `Owner = Maria`
4. Share the view URL with that biller

Each biller only sees their assigned claims. Alternatively use **Submission Status = Not Started** for an unassigned queue.

---

## Ongoing scripts

| Task | Command |
|---|---|
| Sync DrChrono (weekly) | `node nocodb/drchrono-sync-nc.cjs` |
| Sync DrChrono (date range) | `node nocodb/drchrono-sync-nc.cjs 2026-01-01 2026-06-30` |
| Mark DaisyBill submissions | `node nocodb/daisybill-sync-nc.cjs --apply` |
| Process PDF superbill | Drop into Superbill Inbox (watch.cjs handles it) |

> Note: `watch.cjs`, `process.cjs`, and `backfill-insurer.cjs` still write to **Airtable**  
> until you update them. Update after confirming NocoDB is working correctly.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Can't reach `http://137.184.211.133:8080` | Run `docker compose ps` in `/opt/nocodb` — check containers are Up |
| Port blocked | Run `ufw allow 8080/tcp` in server console |
| `nocodb-config.json not found` | Run Step 4 first |
| Migration fails on A/R table | Check that `arTableId` in `nocodb-config.json` is correct |
