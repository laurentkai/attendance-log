# Attendance Log — Project Operating Rules

## Authority and use

This file is the authoritative specification for implementation and project operations. Apply every relevant rule automatically; future prompts may reference this file instead of repeating Docker persistence, Git, UI, security, backup/restore, and validation constraints. An explicit user instruction may override a rule for that task.

`CLAUDE.md` is the review companion. Codex implements and Claude reviews unless the user explicitly requests another role.

## Product and architecture

Attendance Log is a compact attendance application for a navigation school.

- Runtime: Node.js 22+ and Express 5.
- UI: Express server-rendered HTML, Bootstrap 5 as the approved primary UI framework, and lightweight vanilla JavaScript for interaction.
- Data: PostgreSQL is the only persistent application datastore; use parameterized SQL, not an ORM.
- Schema: ordered plain-SQL migrations in `src/db/migrations`, applied by the existing migration runner and tracked in `schema_migrations`.
- Deployment: Docker Compose on an AWS Lightsail VPS. This is not Lightsail Container Service.
- Language: French for user-facing UI; English for code, comments, identifiers, commit messages, and technical documentation.

Preserve server-rendered routing and the current multi-page architecture. Do not turn the application into a SPA merely for UI work.

## Engineering and scope discipline

- Implement the simplest solution that fully satisfies the requirement.
- Preserve validated behavior outside the requested scope.
- Do not opportunistically refactor unrelated code or add speculative flexibility.
- Inspect existing helpers, patterns, and dependencies before creating another abstraction.
- State material uncertainty and verify it rather than silently inventing project facts.
- Never expose or commit real credentials, keys, recovery files, personal test data, or generated databases.

## Public entity identifiers

- User-facing entity URLs use stable opaque UUID `public_id` values; PostgreSQL numeric `id` values remain the internal primary and foreign keys.
- Validate public UUIDs before querying, then resolve them to numeric IDs server-side. Malformed and unknown UUIDs must use the same safe not-found behavior.
- UUID opacity never replaces authentication or authorization. New user-facing routes for entities with public IDs must not expose their numeric IDs in URLs, forms, links, redirects, or client data.

## Frontend architecture

Bootstrap 5 is the default toolkit for layout, navigation, forms, buttons, tables, alerts, badges, dropdowns, modals, offcanvas, utilities, and responsive behavior.

Custom CSS remains appropriate for Attendance Log identity/theme, Quick Attendance, camera/scanner layout, genuinely application-specific components, and gaps Bootstrap cannot reasonably cover.

Do not introduce a competing frontend framework or UI system without explicit user approval. This includes React, Vue, Angular, Svelte, Tailwind CSS, shadcn/ui, another CSS framework, or a SPA architecture.

### Progressive Bootstrap migration

- Prefer Bootstrap patterns on new or intentionally reworked screens.
- When redesigning a screen, replace redundant custom patterns where this is safe and in scope.
- Do not mechanically rewrite stable unrelated pages merely to remove custom CSS.
- Do not maintain parallel component systems indefinitely; progressively retire obsolete custom CSS after behavior and responsive validation.
- Any broad UI migration must be explicitly scoped.

## UI and UX standards

The interface must be clean, restrained, professional, compact, data-first, accessible, and consistent. Mobile-first priority applies especially to operational attendance workflows.

- Ground visual and copy decisions in the navigation-school operator's real task; Bootstrap is a toolkit, not a reason to produce a generic template.
- Avoid oversized dashboard cards, decorative clutter, unnecessary icons, excessive whitespace, and cards nested inside cards.
- Establish clear title, metadata, status, primary-action, secondary-action, and destructive-action hierarchy.
- Same UI concept means the same canonical component/DOM structure, base classes, behavior, spacing, and hierarchy wherever reasonably possible.
- User-facing business labels for participants, activities, sessions, attendance, instructors, and memberships must use the centralized terminology service. Keep internal table, route, model, and variable names unchanged; do not hardcode parallel labels or build an i18n framework.
- Express genuine contextual differences through modifiers or additional child content, not page-specific parallel implementations.
- When changing a shared concept, audit every equivalent occurrence: student rows, session rows, headers, notifications, forms, settings navigation, tables, searches, statuses, and action groups.
- Visual resemblance alone is not harmonization. Verify reuse in source markup and rendered behavior.
- Shared components must retain useful contextual information; consistency must not remove relevant content.
- Optional actions must not destabilize row or grid alignment.

### Installed UI skills

For meaningful theme, navigation, form/table, responsive, accessibility, new administrative screen, or consistency work, read and apply the relevant installed project skills before editing:

- `frontend-design` — `.agents/skills/frontend-design/SKILL.md`
- `web-design-guidelines` — `.agents/skills/web-design-guidelines/SKILL.md`
- `dashboard-design-system` — `.agents/skills/dashboard-design-system/SKILL.md`
- `dashboard-product-design-standard` — `.agents/skills/dashboard-product-design-standard/SKILL.md`

`ui-ux-pro-max` is not currently installed in this repository and must not be cited as an available skill unless it is actually added later. Do not invoke every skill for a trivial text or spacing correction.

Skills supply design principles and review criteria. They do not override this file or authorize their framework-specific reference implementation. Translate React, Tailwind, or shadcn-oriented recommendations into the approved Bootstrap 5 plus server-rendered HTML architecture.

### Installed security skill

For meaningful implementation work involving authentication, authorization, sessions, OTP, password handling, rate limiting, account recovery, security-sensitive routes, or related security controls, read and apply:

- `owasp-security` — `.agents/skills/owasp-security/SKILL.md`

Consult the skill before editing those code paths. It supplements but does not override this file; do not invoke it mechanically for changes with no material security impact.

### Mobile, accessibility, and browser validation

- Use meaningful touch targets, visible keyboard focus, native semantics, and accessible names for icon-only controls.
- Prefer native HTML semantics over unnecessary ARIA.
- Give form controls meaningful labels, names, types, input modes, and autocomplete behavior; never block paste or disable browser zoom.
- Announce relevant asynchronous feedback accessibly and respect `prefers-reduced-motion`.
- Wrap or truncate long names and emails safely; prevent uncontrolled page-level horizontal overflow.
- Use intentional horizontal scrolling only for genuinely wide data tables.
- Consider the virtual keyboard for operational forms and test meaningful mobile UI around 360, 390, and 430 px.
- For high-risk interactive UI, use browser/runtime inspection when available: Quick Attendance, camera/scanner, dialogs, mobile navigation, and responsive tables.
- Static markup/CSS inspection alone is insufficient for claims about runtime dimensions, focus, camera, or pixel-level behavior. If a browser or physical-device check was not performed, say so.

## Navigation and specialized UX

### Settings

- Access Settings from a compact, accessible gear/icon control in the top-right application header.
- All settings sections share one Settings shell.
- Desktop uses compact left navigation with content on the right; mobile uses intentional compact responsive navigation.
- E-mail, Security, Backups, and future administration/security sections must not invent separate settings navigation.

### Students and Import

CSV Import belongs to student management and is accessed contextually from Students, not as a primary global navigation concept. Navigation work must not change CSV matching or lifecycle semantics.

### Quick Attendance

`Prise de présence rapide` is a specialized operational screen, not a normal administrative page. Its primary target is a 360–430 px smartphone, often used one-handed with the virtual keyboard open.

- Remove the normal global header/navigation from this workflow.
- Keep only essential context: live `X / Y présents`, a compact close/back control, and a compact mutually exclusive `Recherche` / `QR` switch.
- Never show complete manual and QR workflows simultaneously.
- Keep search as high as practical; retain accessible clear, refocus after successful manual attendance, and preserve the query after failure.
- Give the QR camera useful stable viewport space.
- Routine feedback, count changes, and Undo state must not cause disruptive layout jumps.
- Keep Undo secondary.
- Preserve the existing live polling and concurrency guards. QR scan outcomes retain distinct visual/audio/haptic feedback without affecting manual actions, polling, or Undo.
- Omit class/session/instructor/date exposition unless a concrete safety requirement calls for it.
- Layout simplification must never alter attendance, eligibility, concurrency, polling, QR, or Undo semantics.

### Shared footer

- Standard authenticated pages share one discreet `Powered by Elinaka Labs` footer inside the canonical application frame; Quick Attendance remains excluded.
- Keep its visual footprint approximately 20–25 px high where practical, with a small icon, subtle typography, and minimal vertical padding. Do not turn it into a card, panel, or competing content area.

## Business integrity

### Authentication and administration

- Administrator identities are stored only in PostgreSQL `admin_users`; runtime authentication must never fall back to environment credentials.
- Roles are fixed and centralized: `administrator`, `manager`, and `attendance_operator`. Do not build configurable permissions or a generic RBAC engine.
- Normal accounts authenticate passwordlessly with a single-use six-digit e-mail OTP. OTP challenges are short-lived, hashed, rate-limited, never logged, and invalidated on resend or successful use.
- One permanent local break-glass account authenticates only by username and bcrypt-hashed password, remains an active administrator, does not depend on SMTP, and is created only with `npm run create-admin`.
- Login uses one identifier entry point. E-mail-shaped identifiers continue through the enumeration-safe OTP response; non-e-mail identifiers continue through the same generic password step whether or not they exist. Never advertise a separate emergency-login route, and rate-limit break-glass password failures by hashed username and IP.
- Load the active account and `session_version` from PostgreSQL for every authenticated request so deactivation, deletion, revocation, and role changes take effect immediately. Sessions slide for 30 days but require reauthentication after the 90-day absolute limit.
- Administrators have full access and exclusively manage Settings and administrator accounts. Managers handle students, Import, classes, sessions, attendance, Reporting/Excel, and student QR/e-mail. Attendance operators access only the session views and attendance workflows required to record attendance.
- UI visibility follows permissions, but server-side authorization remains authoritative. Unauthorized authenticated requests return 403; unauthenticated HTML requests redirect to login and JSON requests return 401.
- Preserve administrative access transactionally. The break-glass account cannot be demoted, deactivated, or deleted through normal routes.
- Normal OTP accounts may be deleted only by an administrator after explicit confirmation. Reject self-deletion and serialize deletion with role/deactivation changes so administrative access cannot be removed by a race.
- Only the break-glass password uses the central adaptive password-hashing implementation; it is never encrypted, rendered, or logged. Do not add invitations, password recovery, or federated login until explicitly scoped.
- The break-glass administrator is created explicitly after migrations with `npm run create-admin`; never recreate one automatically at startup. Normal accounts are created from Configuration > Utilisateurs.

### Students, memberships, sessions, and attendance

- Students have a global activity state; class memberships have a separate activity state.
- Students may belong to multiple classes. Changing one membership must not affect other classes.
- CSV import matches by email; re-importing an existing email reuses the student and existing QR identity.
- A `student_code` is a unique random seven-character uppercase alphanumeric code excluding `0`, `O`, `1`, and `I`.
- Preserve inactive students and memberships when required for history; never let current activity retroactively change historical attendance.
- Before a class has ever started a session, a membership may be removed; afterward preserve the row and deactivate it for future rosters.
- A session is `scheduled`, `open`, or `closed`. Only an explicit transition to `open` starts attendance.
- Active rosters require an active student and active membership until the session becomes historical.
- Closing changes remaining `pending` records to `absent` and sets the first `closed_at` once.
- Once closed at least once, the roster is permanently historical, including after reopening. Its source is strictly that session's `attendance_records`, never current class membership.
- Reopening preserves statuses and permits corrections only within the historical roster. Reclosing must not introduce later class members.
- Closed sessions reject attendance writes unless explicitly reopened.
- Manual and QR attendance use the same authoritative eligibility and persistence logic.
- Concurrent updates must remain idempotent and safe; client filtering is never the authority.
- Student QR identity is stable, non-guessable, independent of membership/database IDs, and contains no personal data.

## Reporting and Excel

- Official reports and Excel exports include only closed sessions.
- Scheduled and open sessions never contribute to official rates.
- Use stored historical attendance records, including currently inactive students or memberships.
- HTML reports and Excel files must share the same backend datasets and calculations.
- Avoid division-by-zero output such as `NaN` or `Infinity`.

## Mail

- All mail uses the central provider-agnostic SMTP service.
- Amazon SES is supported through standard SMTP; do not create provider-specific delivery paths without an explicit decision.
- Business features reuse the central transport and safe error normalization.
- Never render or log provider passwords, credentials, or authentication payloads.

## Secret encryption and recovery

- Encrypt recoverable provider secrets before PostgreSQL storage. The application master key lives outside PostgreSQL.
- Use the central secret service and Node's built-in AES-256-GCM implementation; do not create feature-local or homemade cryptography.
- The raw recovery key appears only after an explicit authenticated Security action and never in normal HTML, logs, URLs, browser storage, or backup archives.
- Wrong-key conditions degrade provider integrations but must not block core business data.
- Recovery-key import must validate existing encrypted secrets before replacing the active key.
- Existing legacy SMTP v1 ciphertext remains supported.
- Every new secret category must use purpose/context-bound encryption, update the central recovery-key validation enumeration, and preserve backward compatibility.

## Backup

- Back up PostgreSQL logically with custom-format `pg_dump`; never copy the raw Docker volume.
- A backup ZIP contains exactly `database.dump` and non-secret `manifest.json` under the current format.
- The archive itself is not application-encrypted. Provider-secret ciphertext remains encrypted inside the dump; the recovery key is never included.
- Supported destinations are manual download, S3/S3-compatible private object storage, and Azure Blob Storage.
- Cloud objects remain private and use provider-side encryption at rest.
- Scheduling is managed inside Attendance Log: persisted daily/weekly configuration, next-run state, and a single-instance scheduler. Do not add VPS cron, Redis, or a distributed job system.
- Serialize backup and restore operations. Retention may delete only exact Attendance Log-owned objects under the configured prefix.

## Restore and disaster recovery

- Restore accepts authenticated local ZIP or configured S3/Azure sources.
- Validate archive structure, manifest/version, dump integrity, and migration compatibility before touching production data.
- Restore into an isolated staging database, run the normal migrations there, validate it, then swap it into production.
- Before replacing meaningful existing data, require explicit destructive confirmation and a completed recoverable safety backup.
- Use maintenance mode to block normal writes during the destructive phase.
- A matching encryption key restores provider-secret usability. A mismatch never blocks business-data restore; preserve ciphertext for later key import or provider reconfiguration.
- Do not restore session-store rows as active login sessions.
- Recalculate scheduler state from the current time after restore; do not immediately run stale historical schedules.
- Do not implement merge, selective-table, PITR, raw-volume, or full-VPS restore unless explicitly scoped.

If the database swap fails and rollback also fails:

- raise the distinct `RESTORE_SWAP_UNRECOVERABLE` condition;
- preserve both the original and staging databases rather than guessing or cleaning them up;
- emit an unswallowed critical diagnostic containing the controlled recovery database names and manual rename instruction, but no secrets;
- accept that manual PostgreSQL recovery may then be required.

## Security baseline

- State-changing actions use POST or another appropriate non-GET method.
- Never log secrets, keys, raw ciphertext unnecessarily, database passwords, or personal QR tokens.
- Return safe user-facing errors; do not expose stack traces or raw subprocess/SDK output.
- Do not create public backup, restore, QR-attendance, configuration, or recovery-key endpoints.
- Use HTTPS in production; remote mobile camera APIs require a secure context.
- Keep backup storage private.
- Use subprocess argument arrays and controlled values; never build shell commands from untrusted input.
- Validate server-side even when client validation exists.

## Database migrations

- Keep SQL migrations ordered and tracked through the existing runner.
- Validate both clean-install and upgrade paths; reruns must follow existing idempotency conventions.
- Do not casually rewrite an applied historical migration.
- Respect backup/restore schema compatibility and never reconstruct historical attendance from current memberships.

## Dependencies

- Inspect existing dependencies first.
- Add a dependency only when it materially simplifies or strengthens the implementation.
- Prefer Node built-ins for cryptography and basic platform functions, and official provider SDKs when an external integration requires one.
- Avoid duplicate libraries for the same task and review `npm audit` when dependencies change.
- Never add a frontend framework competing with Bootstrap 5 without explicit approval.

## Docker and VPS operations

The current deployment is an AWS Lightsail VPS using Docker Compose with two critical named volumes:

- `postgres_data` — PostgreSQL data;
- `app_secrets` — the persistent generated application encryption key when file-backed storage is used.

Both survive normal builds, container replacement, image upgrades, `docker compose up -d`, and host reboot.

- Never run `docker compose down -v` unless the user explicitly intends to destroy persistent data and keys.
- Do not remove either named volume as routine cleanup.
- When validation starts or uses the normal development Compose environment, leave it running unless explicitly told to stop it.
- Do not run `docker compose down` as routine validation cleanup. Remove only isolated temporary validation containers, databases, files, and synthetic data.

Deployment/update procedure must account for migrations:

```text
git pull
docker compose build
docker compose run --rm app npm run migrate
docker compose up -d
```

Run migrations from the newly built image. `docker compose run --rm app npm run migrate` does not replace `docker compose up -d`.

## Git workflow

- Never commit unless the user explicitly asks.
- Never push unless the user explicitly asks.
- Never amend, rewrite history, or force-push unless explicitly requested.
- Preserve user changes in a dirty working tree and do not revert unrelated modifications.
- Before a requested commit, validate the relevant changes, run `git diff --check`, and exclude temporary/debug/test artifacts, credentials, keys, recovery files, and personal data.
- Confirm the expected working-tree state after committing or pushing.

## Proportional validation

Do not run every check for every trivial change. Match validation to risk and report only checks actually performed.

- Small focused change: syntax or targeted test, focused regression, and `git diff --check`.
- Backend/business/database change: also exercise relevant HTTP and database scenarios; validate migrations when affected.
- UI change: also review shared markup/component reuse, responsive/mobile behavior, accessibility, and browser/runtime behavior when available.
- Dependency or Docker change: also run the Docker build, `docker compose config`, and relevant dependency audit.
- Backup, Restore, or crypto change: strongly test isolated happy paths, destructive/failure paths, cleanup, concurrency, wrong-key behavior, and recovery.

Do not claim physical-device, browser, cloud-provider, or destructive-path validation that was not actually performed. Leave the normal Docker development environment running afterward.
