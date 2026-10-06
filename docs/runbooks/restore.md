# Restore the production database

Two ways back, fastest first.

## 1. Neon point-in-time restore (minutes, recent mistakes)

Neon keeps a short history of every change on the free plan. For a bad migration or an accidental delete in the last
few hours, this is the quickest fix.

1. Neon console → your project → **Restore** (or Branches → the `main` branch → Restore).
2. Pick a time just before the problem. Neon restores in place and keeps a backup branch of the state you replaced.
3. Check the site (`/api/health`, sign in, open a design). Nothing in Vercel needs to change: the connection strings stay
   the same.

## 2. A nightly backup (older problems, or Neon itself is the problem)

`.github/workflows/backup.yml` stores an encrypted `pg_dump` every night at 02:30 UTC and keeps 7 days of them.

1. GitHub → Actions → **Backup** → the run you want → Artifacts → download `vash-db-backup` (a zip).
2. Unzip it, then decrypt with the `BACKUP_PASSPHRASE` from your password manager:

   ```bash
   gpg --decrypt --output vash.dump vash-YYYY-MM-DDTHHMMZ.dump.gpg
   ```

3. In Neon, create a new branch (or a new project) to restore into, and copy its **direct** connection string.
   Never restore straight over production.
4. Restore with a PostgreSQL 18 client:

   ```bash
   pg_restore --no-owner --no-privileges --dbname="<direct connection string of the new branch>" vash.dump
   ```

5. Check the restored branch: row counts in `user`, `designs` and `templates` look right, and a known design opens when
   you point a local dev server's `DATABASE_URL` at it.
6. Switch production over: in Vercel, set `DATABASE_URL` to the new branch's **pooled** string; in GitHub's `production`
   environment, set `DATABASE_URL_UNPOOLED` to its direct string. Redeploy (Actions → Deploy → Run workflow).
7. Delete `vash.dump` and the unzipped file from your computer.

Photos live in Supabase Storage, not in these backups. A restored database can point at photos deleted since the dump;
those show as missing photos in the editor.

## After any restore

- Data created between the backup and the restore is gone. If personal data was lost or exposed, follow
  `docs/legal/incident-response.md`.
- Note what happened in `docs/decisions.md` if it changes how we work.
