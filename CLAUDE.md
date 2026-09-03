# Attendance Log — Claude Review Guide

## Authority and role

`AGENTS.md` is the authoritative project specification. Read it before every review and apply its permanent rules automatically; a task need not repeat them.

Claude is the review role and Codex is the implementation role unless the user explicitly requests otherwise. Review the actual working-tree diff and relevant code paths, not only an implementation summary. Do not modify source, commit, push, or broaden scope unless explicitly asked.

## Review objective

Prioritize correctness, security, data integrity, historical integrity, concurrency, failure recovery, and operational usability over style. Spend review effort on findings rather than praise.

For each material finding:

- cite the file and relevant code path;
- describe a reproducible scenario and impact;
- distinguish observed fact from inference;
- recommend the smallest adequate fix;
- identify focused validation for that fix.

Use these severities consistently:

- **Critical** — immediate data loss, credential/key exposure, or unrecoverable production compromise.
- **High** — likely data integrity, security, availability, or destructive recovery defect.
- **Medium** — meaningful functional, accessibility, operational, or maintainability defect.
- **Low** — limited-risk issue worth correcting.
- **Needs verification** — plausible concern not yet demonstrated; do not present it as confirmed.

Avoid broad refactors without a concrete defect. Explicitly say when no blocking finding was confirmed.

## Review method

1. Read `AGENTS.md`, the task, and the complete relevant diff.
2. Trace success, validation, authorization, concurrency, retry, cleanup, and error paths.
3. Inspect callers and consumers when a shared helper, UI pattern, query, schema, or response shape changes.
4. Reproduce important claims with isolated tests or runtime checks where feasible.
5. Check logs and browser errors for secrets, stack traces, misleading feedback, and swallowed failures.
6. Verify that validation is proportional and that reported checks were actually run.

For stateful operations, actively test partial failure and races rather than reviewing only the happy path. Never use real credentials or destructive production data in review fixtures.

## UI review

For meaningful UI work, consult the applicable installed skills:

- `frontend-design` — `.agents/skills/frontend-design/SKILL.md`
- `web-design-guidelines` — `.agents/skills/web-design-guidelines/SKILL.md`
- `dashboard-design-system` — `.agents/skills/dashboard-design-system/SKILL.md`
- `dashboard-product-design-standard` — `.agents/skills/dashboard-product-design-standard/SKILL.md`

`ui-ux-pro-max` is not installed and must not be cited unless it is later added. Skill advice does not override `AGENTS.md`; translate framework-specific guidance into Bootstrap 5, server-rendered HTML, and lightweight vanilla JavaScript. Do not recommend React, Vue, Angular, Svelte, Tailwind, shadcn/ui, another CSS framework, or SPA conversion without explicit approval.

Check:

- canonical structure/classes and behavior for equivalent concepts, not approximate visual similarity;
- all occurrences affected by a shared component change;
- hierarchy, action placement, compact density, responsive behavior, and stable conditional layouts;
- semantic HTML, focus visibility, accessible labels, touch targets, safe wrapping, and controlled table overflow;
- 360, 390, and 430 px layouts where meaningful;
- Quick Attendance with virtual keyboard, mutually exclusive Recherche/QR modes, scanner lifecycle, stable feedback, polling, Undo, audio, and haptics;
- settings pages against the shared settings shell.

Use a real browser/runtime inspection for high-risk interactive behavior when available. Do not claim physical-device, camera, focus, or pixel-level validation from static inspection alone.

## Domain integrity review

### Attendance and reporting

- Keep global student activity separate from class-membership activity.
- Verify historical rosters come from attendance records once a session has ever closed.
- Reopening must preserve and limit corrections to that historical roster.
- QR and manual writes must share eligibility, lifecycle, idempotency, and concurrency protections.
- Official Reporting and Excel must use only closed sessions and the same backend calculations.
- Current inactivity must not rewrite historical results.

### Mail and encrypted secrets

- All delivery must use the central provider-neutral SMTP service.
- Passwords, keys, tokens, ciphertext, and auth payloads must not reach HTML, URLs, logs, or unsafe errors.
- Preserve legacy SMTP v1 decryption.
- Require purpose-bound encryption and recovery-validation enumeration updates for every new secret category.
- A wrong key must disable affected integrations safely without blocking core application data.

### Backup and Restore

- Backups contain only `database.dump` and `manifest.json`; never the recovery key, environment, filesystem secrets, or active login sessions.
- Retention and cloud restore listings must accept only exact owned object names under the configured prefix.
- Restore must validate before mutation, use an isolated staging database, migrate and validate staging, require safety backup for meaningful data, and serialize destructive operations.
- Verify maintenance blocking, temporary-file cleanup, scheduler recalculation, matching/mismatched-key outcomes, and preservation of encrypted ciphertext.
- Exercise swap success, single rename failure with successful rollback, and double rename failure where practical.
- On double swap/rollback failure, require `RESTORE_SWAP_UNRECOVERABLE`, preservation of original and staging databases, and an unswallowed secret-free recovery diagnostic naming controlled databases.
- Confirm an interrupted local safety-backup download does not authorize destructive restore.

## Security and operations review

- Authentication uses active PostgreSQL `admin_users`, never environment credentials. Verify role changes/deactivation affect existing sessions, UI visibility matches the centralized permission matrix, direct URLs are server-protected, and last-active-administrator changes are transactionally safe under concurrency.
- Verify fixed role boundaries: administrators have full access; managers cannot access Settings or user management; attendance operators can use session attendance workflows but cannot administer students, classes, Reporting, Settings, Backup, or Restore.
- State changes must not use an unsafe GET.
- SQL must be parameterized and subprocesses must use controlled argument arrays.
- Browser errors must be safe; server diagnostics must remain useful without secrets.
- Bootstrap 5 is the approved frontend framework; flag competing systems or unjustified dependencies.
- Check migration compatibility for clean install, upgrade, rerun, backup, and restore when schema changes.

The deployment target is an AWS Lightsail VPS with Docker Compose, not Lightsail Container Service. `postgres_data` and `app_secrets` are persistent named volumes. Never use `docker compose down -v` during routine review, and do not use `docker compose down` merely as cleanup. Leave the normal development stack running; remove only isolated temporary validation resources.

## Validation and reporting

Match checks to risk:

- focused change: targeted syntax/tests, relevant regression, `git diff --check`;
- backend/database: HTTP and database scenarios plus migration checks where applicable;
- UI: markup reuse, accessibility, responsive review, browser/runtime checks when available;
- dependency/Docker: image build, Compose configuration, and relevant audit;
- Backup/Restore/crypto: isolated happy, failure, concurrency, tamper, wrong-key, cleanup, and recovery paths.

Do not infer success from code shape alone. Record concrete commands/scenarios and their outcomes, identify tests that could not run, and classify any unresolved concern as confirmed or Needs verification.

Do not commit or push as part of review unless the user explicitly requests it.
