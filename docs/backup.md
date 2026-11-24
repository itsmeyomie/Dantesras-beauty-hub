# Database backups (free)

Every night at 03:00 (Kenya time) GitHub copies the live database, **encrypts** it with your
passphrase and keeps the copy for 30 days. It costs nothing, and the nightly visit also keeps the
free Supabase project from pausing.

## Turn it on (once, about 5 minutes)

1. **Database password** – Supabase → Project Settings → Database → *Reset database password*
   if you don't know it. Any characters are fine.
2. **GitHub** → your repository → **Settings → Secrets and variables → Actions → New repository secret**:
   - `SUPABASE_DB_PASSWORD` = the database password from step 1
   - `BACKUP_PASSPHRASE` = a long passphrase you make up (e.g. four random words).
     **Write it down somewhere safe** – without it no backup can be opened, by you or anyone else.
3. GitHub → **Actions → Nightly database backup → Run workflow** to make the first backup now.
   A green tick means it worked.

Never paste the database password or the passphrase into a chat, an email or the code.

## Get a backup

GitHub → **Actions → Nightly database backup** → open a run → **Artifacts** → download
`dantesras-YYYY-MM-DD.dump.gpg` (it comes as a .zip – unzip it first).

## Restore (only if something went badly wrong)

You need [PostgreSQL client tools](https://www.postgresql.org/download/) and GnuPG
(`gpg`, included in Git for Windows).

```bash
gpg --decrypt dantesras-2026-11-24.dump.gpg > dantesras.dump      # asks for the passphrase
pg_restore --clean --if-exists --no-owner --no-privileges --schema=public \
  --dbname "postgresql://postgres.frjflqepqhjkxfzknnoz@aws-1-eu-west-1.pooler.supabase.com:5432/postgres" \
  dantesras.dump      # asks for the database password
```

`--clean` **replaces** what is in the database with the backup. Try it first on a new, empty
Supabase project if you can.
