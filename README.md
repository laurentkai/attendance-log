# Attendance Log

Attendance Log is a mobile-first attendance application for a navigation school. It manages students, class memberships, sessions, attendance, rapid manual and QR check-in, student QR delivery by e-mail, SMTP settings, reporting and Excel exports, encrypted provider credentials, and backup and disaster recovery.

The administration interface is in French. This guide therefore retains UI labels such as **Configuration > Sauvegardes** exactly as they appear in the application.

## Architecture

- Node.js 22 and Express serve server-rendered HTML with Bootstrap 5 and lightweight client-side JavaScript.
- PostgreSQL 17 is the only application database.
- Docker Compose runs the `app` and `postgres` services on the current production target: an AWS Lightsail VPS.
- The application listens on plain HTTP port `3000` inside the container. An external reverse proxy must provide HTTPS in production.
- `postgres_data` stores PostgreSQL data.
- `app_secrets` stores the generated application encryption key and the non-secret installation instance ID.

Both named volumes survive normal image rebuilds, container replacement, `docker compose up -d`, and host restarts.

> **Persistent-volume warning**
>
> Do not use `docker compose down -v` as routine cleanup. The `-v` option removes Compose volumes and can destroy both the PostgreSQL database and the generated application encryption key. Normal deployments use non-volume-destructive commands such as `docker compose up -d`.

## VPS prerequisites

Install:

- Git;
- Docker Engine;
- the Docker Compose plugin (`docker compose`);
- a domain name and valid HTTPS certificate for remote use;
- nginx or another reverse proxy if HTTPS is not provided elsewhere.

Node.js, npm, PostgreSQL, `pg_dump`, and `pg_restore` do not need to be installed directly on the VPS; the Docker images provide them.

HTTPS is required for production login cookies and for browser camera access on remote/mobile devices. Only `localhost` is treated as a secure camera context without HTTPS.

## Fresh installation

### 1. Clone the repository

```bash
git clone <repository-url>
cd attendance-log
```

### 2. Create and configure `.env`

```bash
cp .env.example .env
```

Edit `.env` with installation-specific values. Never commit this file.

| Variable | Purpose | Current behavior |
| --- | --- | --- |
| `BIND_ADDRESS` | Host address on which Docker publishes the application port | Optional; defaults to `0.0.0.0` |
| `PORT` | Host port mapped to application port `3000` | Optional; defaults to `3000` |
| `NODE_ENV` | Node environment | Set to `production` on the VPS |
| `POSTGRES_DB` | Compose PostgreSQL database name | Configure for the installation |
| `POSTGRES_USER` | Compose PostgreSQL user | Configure for the installation |
| `POSTGRES_PASSWORD` | Compose PostgreSQL password | Use a strong, unique value |
| `DATABASE_URL` | PostgreSQL URL for direct, non-Compose execution | Compose constructs its own URL from `POSTGRES_*` |
| `DATABASE_SSL` | TLS verification for direct database connections | Compose sets this to `false` on its private network |
| `SESSION_SECRET` | Express session signing secret | Required; at least 32 characters |
| `APP_ENCRYPTION_KEY` | Environment-supplied 256-bit key in canonical Base64 | Optional; takes precedence over the key file |
| `APP_ENCRYPTION_KEY_FILE` | Key-file path for direct execution | Optional; Compose fixes it to `/app-secrets/encryption.key` |
| `APP_INSTANCE_ID_FILE` | Instance-ID file path for direct execution | Optional; Compose fixes it to `/app-secrets/instance-id` |
| `BACKUP_TIMEZONE` | IANA timezone used by backup scheduling | Optional; defaults to `Europe/Brussels` |
| `BACKUP_RESTORE_MAX_MB` | Maximum uploaded restore archive size | Optional; defaults to `512` MiB |

Use distinct strong values for `POSTGRES_PASSWORD` and `SESSION_SECRET`. If you supply `APP_ENCRYPTION_KEY`, it must be exactly 32 random bytes encoded as canonical Base64. For the standard Compose deployment, leaving it empty allows Attendance Log to generate and persist a key in `app_secrets`.

For local development, `BIND_ADDRESS=0.0.0.0` makes the published port reachable through the development host's network interfaces. On the Lightsail VPS, where nginx is the public entry point, use:

```dotenv
BIND_ADDRESS=127.0.0.1
PORT=3000
NODE_ENV=production
```

This restricts the application port to the VPS loopback interface while nginx serves public HTTPS traffic. A local `docker-compose.override.yml` is no longer required to change the bind address for this deployment.

### 3. Build the image

```bash
docker compose build
```

### 4. Apply database migrations

```bash
docker compose run --rm app npm run migrate
```

This command applies pending ordered SQL migrations and records them in `schema_migrations`. It is safe to rerun: already applied migrations are not applied again.

### 5. Create the break-glass administrator

```bash
docker compose run --rm \
  -e CREATE_ADMIN_USERNAME="emergency-admin" \
  -e CREATE_ADMIN_NAME="Emergency Administrator" \
  -e CREATE_ADMIN_PASSWORD="Use-A-Long-Unique-Password" \
  app npm run create-admin
```

`CREATE_ADMIN_NAME` is optional. `CREATE_ADMIN_USERNAME` and `CREATE_ADMIN_PASSWORD` are required; the password must contain at least 12 characters. These values are passed only to this one-shot container and do not need to be stored in `.env`. The command creates the single local break-glass account and refuses to create another one.

The break-glass account is always an administrator and is the only account that authenticates with a local username and password. Store its credentials securely; it is independent of SMTP.

### 6. Start the application

```bash
docker compose up -d
```

### 7. Verify services and health

```bash
docker compose ps
docker compose logs --tail=100
curl http://localhost:3000/health
```

A healthy response is:

```json
{"status":"ok","database":"connected"}
```

### 8. Complete initial configuration

1. Open the application through its HTTPS URL.
2. Enter the break-glass username in the single identifier field, then enter its password when prompted.
3. Open **Configuration > E-mail**, save the SMTP configuration, and use **Envoyer un e-mail de test**.
4. Open **Configuration > Utilisateurs** and create the named `administrator`, `manager`, and `attendance_operator` accounts required by the organization.
5. Export the recovery key from **Configuration > Sécurité** and store it securely outside the VPS and separately from database backups.
6. Configure and test backups in **Configuration > Sauvegardes**.

Normal users authenticate passwordlessly: they enter their e-mail address in the same identifier field and then enter the six-digit OTP sent by Attendance Log. SMTP must be configured and working before they can receive a code. If SMTP is unavailable, the local break-glass username still switches the unified login flow to password entry; there is no separate emergency-login page.

## HTTPS reverse proxy

The repository does not include an nginx configuration. Configure the VPS reverse proxy separately so that its HTTPS virtual host forwards to `http://127.0.0.1:3000` and supplies the original protocol.

Minimal nginx `location` example:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

With `NODE_ENV=production`, Attendance Log trusts the first proxy and sets secure session cookies. The public endpoint must therefore use a valid certificate and the proxy must forward `X-Forwarded-Proto` correctly.

## Authentication and roles

- The unified login accepts either a normal account e-mail or the unique break-glass username.
- Normal users receive a single-use six-digit OTP by e-mail. The code expires after 10 minutes, has server-enforced request/resend limits, and permits at most five verification attempts.
- Sessions use a 30-day sliding inactivity lifetime and a 90-day absolute authentication lifetime.
- Administrators manage normal accounts in **Configuration > Utilisateurs**. Do not rerun `npm run create-admin` for routine user management.
- `administrator` has full access, `manager` has operational management/reporting access without Settings, and `attendance_operator` has attendance-focused access.

## Encryption key, recovery key, and instance identity

Recoverable provider credentials are encrypted before storage in PostgreSQL. Attendance Log loads its master key in this order:

1. `APP_ENCRYPTION_KEY`, when set;
2. the persistent file at `APP_ENCRYPTION_KEY_FILE`;
3. a securely generated key written to that file on first initialization.

The standard Compose deployment mounts `app_secrets` at `/app-secrets`, so the generated key survives rebuilds and container replacement. The raw key is not stored in PostgreSQL and is never included in a backup archive.

Use **Configuration > Sécurité > Exporter la clé** and keep the recovery-key file in a separate secure location. A database can be restored without the matching key, but encrypted SMTP, S3, and Azure credentials then remain unusable until the matching recovery key is imported or those credentials are reconfigured.

Attendance Log also generates a random, non-secret instance UUID in `/app-secrets/instance-id`. It survives normal deployments and isolates each installation's cloud backup objects. It is not derived from a hostname, database name, or administrator identity. Do not copy another live installation's instance-ID file: a restored installation intentionally keeps its own identity and writes future backups under its own cloud prefix.

## Updating Attendance Log

Before a significant update, confirm that a recent backup succeeded in **Configuration > Sauvegardes**. When a cloud destination is configured, **Sauvegarder maintenant** creates an immediate cloud backup.

Use this sequence:

```bash
git pull
docker compose build
docker compose run --rm app npm run migrate
docker compose up -d
```

Run migrations after `docker compose build` so the migration command uses the newly built image containing the new SQL files. `docker compose run --rm app npm run migrate` updates the database schema; it does not recreate the running application service, so `docker compose up -d` is still required.

Do not recreate the first administrator during normal updates. Existing users and the break-glass account are database data managed by migrations and **Configuration > Utilisateurs**.

Verify the deployment afterward:

```bash
docker compose ps
docker compose logs --tail=100
curl http://localhost:3000/health
```

## Automatic production deployment

The repository includes `.github/workflows/deploy.yml`. A push to `main` deploys automatically through a self-hosted GitHub Actions runner installed on the Lightsail VPS. The workflow operates directly in the existing production checkout; it does not use `actions/checkout` or maintain a second production copy.

### Register the self-hosted runner

1. In the GitHub repository, open **Settings > Actions > Runners** and choose **New self-hosted runner**.
2. Select the VPS operating system and architecture, then run GitHub's generated download and registration commands on the VPS in a permanent runner directory.
3. Add the custom label `attendance-log-production` during registration, for example by appending `--labels attendance-log-production` to GitHub's generated `./config.sh` command.
4. Run the runner under a dedicated VPS account that can read and update the existing Attendance Log checkout and run Docker Compose. That account must also be able to authenticate `git fetch origin` for this repository.
5. From the runner directory, install and start it as a service using the supplied service script:

   ```bash
   sudo ./svc.sh install
   sudo ./svc.sh start
   sudo ./svc.sh status
   ```

6. In **Settings > Secrets and variables > Actions > Variables**, create `PRODUCTION_DEPLOY_PATH` with the absolute path of the existing production checkout, for example `/opt/attendance-log`.
7. Ensure that checkout contains the production `.env` with at least the production bind settings:

   ```dotenv
   BIND_ADDRESS=127.0.0.1
   PORT=3000
   NODE_ENV=production
   ```

The workflow checks that `.env` exists and is not tracked. `git reset --hard origin/main` updates tracked application files but does not remove the untracked/ignored production `.env`. The workflow never runs `docker compose down`, removes volumes, or changes deployment credentials. The `postgres_data` and `app_secrets` volumes therefore remain attached across deployments.

### Deployment behavior

Every push to `main` runs this sequence in `PRODUCTION_DEPLOY_PATH`:

```bash
git fetch origin
git checkout main
git reset --hard origin/main
docker compose build
docker compose run --rm app npm run migrate
docker compose up -d
```

It then runs `docker compose ps` and checks the application's `/health` response from inside the application container. A build, migration, startup, or health failure fails the workflow. Production deployments share one concurrency group; a new deployment waits for an active deployment and does not cancel it.

### Manual deployment and diagnostics

- To deploy manually, open **Actions > Deploy production**, choose **Run workflow**, select `main`, and confirm the run.
- Use the same workflow page to inspect deployment history, step output, duration, and failures.
- On the VPS, `sudo ./svc.sh status` from the runner directory reports runner service status. Attendance Log runtime logs remain available through `docker compose logs --tail=100` in the production checkout.

### Disable or remove the runner

To stop automatic deployment temporarily, disable the workflow from its GitHub **Actions** page or stop the runner service from its installation directory:

```bash
sudo ./svc.sh stop
```

To remove the runner permanently, open the runner in **Settings > Actions > Runners**, choose **Remove**, and follow GitHub's generated removal instructions. Stop and uninstall the service before running the generated removal command:

```bash
sudo ./svc.sh stop
sudo ./svc.sh uninstall
```

Removing the runner does not require deleting the Attendance Log checkout, `.env`, `postgres_data`, or `app_secrets`.

## Routine operations

Restart existing containers without rebuilding:

```bash
docker compose restart
```

Restart only the application:

```bash
docker compose restart app
```

Rebuild and recreate after code or dependency changes:

```bash
docker compose build
docker compose run --rm app npm run migrate
docker compose up -d
```

A restart does not rebuild the image or apply migrations.

Useful logs and status commands:

```bash
docker compose logs -f app
docker compose logs -f postgres
docker compose logs --tail=100
docker compose ps
```

Temporarily stop services without deleting persistent volumes:

```bash
docker compose stop
```

Start them again:

```bash
docker compose up -d
```

## Database migrations

The normal migration command is:

```bash
docker compose run --rm app npm run migrate
```

Run it on first installation and after building an application version that contains new migrations. The migration runner uses a PostgreSQL advisory lock, creates/uses `schema_migrations`, and skips previously applied files. Do not manually edit migration history or deployed migration files as a routine operation.

## Backup

**Configuration > Sauvegardes** provides:

- **Télécharger une sauvegarde** for an immediate local download;
- one S3/S3-compatible or Azure Blob Storage destination;
- **Tester la destination**;
- **Sauvegarder maintenant** for an immediate cloud backup;
- daily or weekly application-managed scheduling, execution time, and retention;
- backup execution history and safe failure summaries.

Set `BACKUP_TIMEZONE` to the site's operational IANA timezone. Attendance Log manages scheduling inside the application; no VPS cron entry or Docker scheduler is required.

Each ZIP archive contains exactly:

```text
database.dump
manifest.json
```

`database.dump` is a transactionally consistent PostgreSQL custom-format logical dump. `manifest.json` contains non-sensitive metadata, including the source instance ID and encryption-key fingerprint. The archive excludes the raw encryption/recovery key, `.env`, filesystem secrets, source code, and active login/OTP state.

Provider credentials remain individually encrypted inside the database dump. The ZIP itself is intentionally not encrypted by Attendance Log. Protect local downloads appropriately. Cloud objects remain private and use provider-side encryption at rest.

New S3/Azure objects are stored beneath an instance-owned prefix equivalent to:

```text
<configured-prefix>/attendance-log/<instance-id>/...
```

Listing, download, restore listing, and retention are restricted to that prefix, so independent installations can share a bucket/container without deleting or exposing each other's backups through Attendance Log.

## Restore and disaster recovery

Open **Configuration > Sauvegardes > Restaurer une sauvegarde**. Restore V1 supports:

- an Attendance Log ZIP uploaded from local storage;
- an owned backup listed from the currently configured S3/S3-compatible or Azure destination;
- manifest, ZIP, PostgreSQL dump, format, and schema compatibility validation before production data is touched;
- encryption-key fingerprint comparison without blocking ordinary business-data recovery;
- an explicit destructive confirmation;
- a mandatory safety backup before replacing a database containing meaningful data;
- restore into an isolated staging database, current migrations, validation, and a guarded database swap;
- automatic application restart and scheduler recalculation after success.

Restore replaces the whole application database; it does not merge records or selectively restore students/sessions. Old login sessions and OTP challenges are not restored as active authentication state.

### Matching or different encryption keys

With the matching recovery key, restored SMTP and cloud credentials remain usable. With a different key, restore still preserves all business data and encrypted credential ciphertext. Core features remain available, while affected integrations fail safely until the matching key is imported from **Configuration > Sécurité** or credentials are re-entered.

The source instance ID in the manifest is informational and does not block restore. The target installation retains its own instance ID for future cloud backups.

### Fresh-install recovery

For a fresh installation:

1. follow the installation procedure through `docker compose up -d` and log in with the newly created break-glass account;
2. if the source recovery key is available, import it from **Configuration > Sécurité** before or after restore;
3. open **Configuration > Sauvegardes > Restaurer une sauvegarde**;
4. upload the backup ZIP, inspect its metadata, acknowledge the warnings, and confirm restore;
5. wait for the application to restart, then sign in using an account contained in the restored database.

Restore replaces the fresh database, including its newly bootstrapped user records. The temporary break-glass account created on the fresh installation therefore does not survive the database replacement. Ensure credentials for an account contained in the backup are available. If SMTP credentials will be unreadable because the key differs, possession of the source installation's break-glass credentials is especially important.

Cloud backup listing is deliberately restricted to the current instance ID. A fresh installation receives a new instance ID and therefore does **not** list another installation's instance-isolated objects, even in the same bucket/container. For cross-instance disaster recovery, retrieve the required ZIP using the storage provider's management tools and use **Restaurer depuis un fichier**. Pre-instance-isolation archives remain restorable by local upload. Do not replace the new installation's instance ID with the source ID merely to discover old objects.

A backup whose schema migration version is newer than the running application is rejected. Update Attendance Log, build the new image, run migrations, and inspect the archive again.

Periodically test a current backup and recovery key in an isolated environment. A backup is only useful when its restore path and administrator access have been verified.

## SMTP, OTP, and student QR e-mail

**Configuration > E-mail** supports provider-neutral SMTP with STARTTLS, implicit TLS, or an explicitly unencrypted unauthenticated relay. Authenticated SMTP over an unencrypted connection is rejected. Amazon SES is used through its ordinary SMTP endpoint and SMTP credentials; no AWS mail SDK is required.

The SMTP password is encrypted in PostgreSQL and never rendered back into the form. Use **Envoyer un e-mail de test** before relying on OTP login or student QR delivery.

From a student's QR page, **Envoyer le QR** sends the student's existing personal QR to the stored student e-mail address as an embedded image and PNG attachment.

## Post-deployment checklist

After installation or update:

1. confirm `docker compose ps` shows healthy/running services;
2. confirm `/health` reports a connected database;
3. open the HTTPS login page;
4. inspect **Configuration > Sécurité** and securely export the recovery key;
5. test SMTP and a normal user's OTP login;
6. test the configured cloud destination and inspect backup history;
7. create a fresh backup;
8. from a phone over HTTPS, test manual and QR rapid attendance.

## Troubleshooting

### `app` repeatedly restarts

```bash
docker compose logs --tail=100 app
```

Check `.env`, especially `SESSION_SECRET` and `POSTGRES_*`, confirm migrations ran, and confirm the database contains a break-glass administrator. SMTP failure does not prevent break-glass login: enter its local username in the normal identifier field.

### A migration is missing

```bash
docker compose build
docker compose run --rm app npm run migrate
docker compose up -d
```

### The active key does not match restored secrets

Core business data remains available. Import the corresponding recovery key from **Configuration > Sécurité**, or reconfigure SMTP/S3/Azure credentials. Never put the recovery key in `.env` unless intentionally using it as `APP_ENCRYPTION_KEY` under an external secrets-management process.

### QR camera access fails on a phone

Confirm the application is served over HTTPS, browser camera permission is granted, and another application is not holding the camera. Manual rapid attendance remains available.

### A scheduled backup does not run

Check `BACKUP_TIMEZONE`, ensure automatic backups are enabled, run **Tester la destination**, inspect backup history in **Configuration > Sauvegardes**, and review `docker compose logs --tail=100 app`.

## Essential operating rules

- Never commit `.env`, real credentials, an exported recovery key, or generated instance-identity files.
- Keep the recovery key separate from database backups.
- Regularly verify that cloud backups succeed and periodically test restoration.
- Never use `docker compose down -v` unless destruction of both persistent database and application-secret volumes is explicitly intended.
- Do not recreate the break-glass administrator during normal updates.
