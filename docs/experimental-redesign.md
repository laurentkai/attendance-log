# Experimental workspace redesign

Branch: `experiment/astra-redesign`. No schema changes or deployment to production.

## Pass 1 — UX / information architecture

This section records the accepted first pass. Pass 2 below supersedes its visual
tokens and the Settings landing decision. Review screenshots were removed from
the repository after acceptance; validation notes remain below.

### Product audit and direction

The product is an operational register for a navigation school. The daily task is to
find the right session, record arrivals, and finish the register accurately.

| Surface | Finding | Design decision |
| --- | --- | --- |
| Application shell | Horizontal navigation competes with identity and utilities; narrow centered canvas limits useful data | Persistent compact desktop rail, Bootstrap offcanvas on mobile, shared server-rendered active navigation |
| Home | Four navigation cards precede the actual work; no forward view | Open registers first, upcoming schedule second; planning action in header |
| Sessions | Reverse chronological list mixes scheduled, live and historical work | Explicit lifecycle views with URL filters and deliberate date ordering |
| Participants and activities | Oversized action grids, visible destructive buttons, inconsistent discovery | Linked identities, compact shared action menus, searchable collections |
| Attendance | Lifecycle actions and record controls compete in the header | Primary quick-entry action, secondary lifecycle tools, compact register summary |
| Quick Attendance | Already has essential concurrency and focus behavior | Preserve its dedicated operational architecture; refine visual hierarchy and targets only |
| Reporting | Landing page is an index plus a download form; cannot inspect the requested global export | Filtered overview using the same privacy-aware dataset and language context as the export |
| Settings | Eleven destinations form an undifferentiated list | Group by workspace, access/privacy, and operations; searchable navigation and a compact mobile chooser |
| Create/edit | Long undifferentiated field stacks | Group core information and optional configuration; retain explicit saves |
| Errors, privacy, import, print, backups | Sensitive workflows have useful explicit safeguards | Shared shell and consistent density, retain confirmation and data contracts |

Visual direction: a quiet, instrument-like workspace. Cool white canvas `#fafafa`,
white surfaces `#ffffff`, ink `#18181b`, secondary text `#52525b`, hairlines
`#e4e4e7`, reserved blue focus/link `#245b78`. System sans for body, a restrained
system rounded face for brand, tabular system monospace for register counts.
The signature is the live register: date, identity, state and next action in a
single aligned line. No decorative charts or marketing cards.

### Refactoring analysis

| Change / order | Blast radius | Risk | Validation |
| --- | --- | --- | --- |
| 1. Shared navigation and action-menu renderers | `src/ui.js`, every standard authenticated page | Medium: responsive shell and permissions | Role-aware markup tests, mobile drawer and keyboard checks |
| 2. Canonical collection interaction | `public/js/classes.js`, list renderers | Medium: filtering and empty states | Browser search/reset/sort/pagination; existing client tests |
| 3. Dashboard and session lifecycle views | Home GET, session list GET, live-card consumers | Medium: live update hooks | Database/HTTP tests, polling, closed and reopened scenarios |
| 4. Reporting preview | Reporting overview GET only | Medium: output language/privacy parity | Existing privacy suite, filtered HTML/export comparison |
| 5. Shared CSS and form grouping | Standard screens and dedicated Quick Attendance | Medium: global layout reach | Desktop and 360/390/430px browser sweep |

The refactor skill informs this assessment; implementation is explicitly authorized
by the redesign request. The design skills are adapted to Bootstrap and Express.
Their generic bulk-delete and offline-first recipes do not fit irreversible privacy
actions, historical attendance, or online-required writes. Existing useful batch
workflows (import and QR printing) remain contextual; no speculative bulk mutation
or stub controls are introduced.

### Preserved contracts

No migrations, numeric/public identifier changes, authentication changes, role or
PII changes, business-language resolution changes, retention/anonymization changes,
audit changes, backup/restore changes, or changes to attendance persistence.
Browser filtering is presentation only. Official totals continue to use closed
sessions and historical attendance; display uses installation locale/timezone.
User content remains escaped and untranslated. EN/FR catalogs remain centralized.

### Delivered experience

- The authenticated application uses a 200px desktop navigation rail, full-width
  working canvas, icon-and-label destinations, a compact utility header, and a
  Bootstrap mobile drawer with keyboard focus restoration. Active navigation is
  rendered on the server from the full URL. Settings remains an administrator-only
  header utility. The footer remains a small shared strip; Quick Attendance is excluded.
- Home leads with live registers and direct Quick Attendance entry, followed by
  the next eight scheduled dates in the installation timezone. The record title
  opens the full register. The former shortcut-card grid is removed.
- Sessions has lifecycle tabs, retained search/class filters, date ordering, and
  server-side pages of 50. Out-of-range pages return to the filtered first page.
- Participant, activity, membership and Reporting collections share search, counts,
  local alphabetical sorting and 50-row presentation pages where applicable.
  Local participant searches are not added to URLs or browser storage. Activity
  discovery now includes description search. Linked identities make the principal
  navigation explicit. Shared Bootstrap row menus contain contextual actions and
  retain existing POST forms and destructive confirmation.
- The attendance register has All / Pending / Present / Absent filters which are
  reapplied after live status refresh. Quick mode leads the header; editing,
  summaries and closure are secondary. The arrival-time modal is unchanged.
- Quick Attendance retains its separate shell, polling, concurrency guards,
  mutual Search/QR modes and secondary Undo. Its count now says “present,” touch
  targets remain usable, and its close link is wired to the already-existing
  scanner cleanup handler. Manual success still clears and refocuses search.
- Reporting opens with a filtered global preview and an export of the same
  selection. Both use `getGlobalReport`, the central privacy context and global
  business-output language. The preview carries its own `lang` attribute when it
  differs from the viewer's interface. The existing detailed reports remain linked.
- Settings is grouped into Workspace, Access and privacy, and Operations. All
  eleven sections share searchable navigation and a mobile section chooser.
  The Settings entry point now opens Language and region, previously E-mail.
- Class/session forms progressively disclose language, tolerance and summary
  configuration while preserving submitted values and explicit saves. Validation
  errors reopen the disclosure. Participant first/last names share a desktop row.
- Shared error pages include recovery navigation in the current UI language.
  Classes now uses the canonical error renderer. The service-worker cache advances
  from v15 to v16; the allowlist and online-only write boundary are unchanged.

The design skills informed the restrained palette, compact hierarchy, reusable
components and mobile validation. They were deliberately adapted to Bootstrap;
no frontend framework, runtime dependency, schema or migration was added.

### Validation results

| Check | Result |
| --- | --- |
| `npm test` | 108 passed, zero failures |
| `npm run test:integration` | 14 passed, including two new nested HTTP/database scenarios |
| Desktop browser sweep | 29 routes at 1440px; no page-level overflow or JavaScript errors |
| Mobile browser sweep | 21 routes at each of 360, 390 and 430px; drawer/menu focus, settings chooser and table scrolling checked |
| Operational browser scenarios | Manual attendance, count updates, refocus, stable search position, Undo, mutually exclusive modes, app-generated QR decoding, duplicate and unknown QR handling |
| Complete workflow scenarios | Create/edit class, participant and session; open, record, close, add later member, reopen historical roster, correct arrival, reclose |
| Import/output scenarios | CSV matching preserves QR image; export excludes later members from historical roster; French session output preserved |
| Privacy and authorization | Manager without PII receives pseudonymized reports; operator denied management/Reporting/Settings; manager denied Settings |
| PWA runtime | v15 cache removed; unrelated cache retained; v16 contains public static assets only; offline writes remain network-required |
| Existing integrity coverage | Clean install, upgrade/rerun migrations, timezone/locale, terminology, anonymization races, audit rollback, logical backup/isolated restore |
| Local image/runtime | Docker image built; migrations up to date; normal Compose app updated; health reports database connected |
| Working tree | Experimental branch only; no commit or push; `git diff --check` passes |

New tests live in `test/workspace-ui.test.js`, the existing integration suite,
`integration/redesign-browser.cjs` and `integration/redesign-workflows.cjs`.
`integration/redesign-fixture.js` is an opt-in, database-guarded synthetic fixture.
The sole changed existing assertion tracks the intentional PWA cache version;
existing behavioral expectations were retained.

The browser checks found and fixed: incorrect active navigation on nested routes,
mobile overflow caused by absolutely positioned accessible table labels escaping
their scroll container, a vertical register summary caused by Bootstrap's card
direction, and the missing Quick Attendance close-control cleanup hook.

### Visual review

Review screenshots used synthetic names and `example.invalid` addresses only.

| Desktop | Mobile |
| --- | --- |
| Home | Home, 390px |
| Reporting | Quick Attendance, 390px |
| Settings | Settings, 390px |
| Attendance register | |

### Remaining risks and limits

- Browser validation used headless Chromium. Safari, Firefox, assistive-technology
  testing and physical phone keyboard/camera/audio/haptics remain unverified.
  A reduced-height viewport approximates keyboard space but is not a device test.
- QR image decoding and the real QR endpoint were exercised; these do not certify
  physical-camera acquisition in varied lighting or on-device feedback.
- SMTP delivery and live S3/Azure operations were not invoked. Their implementation,
  confirmations and provider configuration were retained. Backup/restore integrity
  was exercised by the existing isolated integration scenario, not a live cloud restore.
- Shared CSS has a wide reach. This is suitable for experimental review, with a
  separate Claude review still recommended before any merge or production release.
- Participant/activity/Reporting collection pagination limits visible rows, not
  the database query. Very large collections still warrant future server pagination.
  The new Reporting overview loads the existing global report dataset, so its
  performance should be measured against the largest production history.
- Existing polling refreshes registers already on the page; it does not discover
  newly opened registers automatically. Reloading Home remains necessary for that case.

### Reproducing browser validation

Run `npm ci` and `npm run test:integration` normally. Browser tests need a separate
Playwright installation (not an application dependency), with `PLAYWRIGHT_MODULE`
and `PLAYWRIGHT_BROWSERS_PATH` pointing to it. Start `redesign-fixture.js` only in
the exact disposable `attendance_log_test_redesign_20260913` database after normal
migrations, bind its port 3000 to loopback port 3001, and mount current `src`,
`public` and `integration`. The fixture refuses other database names, creates
synthetic users/records only, and does not start provider schedulers.

Run `node integration/redesign-browser.cjs` first, then
`node integration/redesign-workflows.cjs`. The latter creates additional synthetic
records, so use a fresh fixture before rerunning the first suite. Set
`REDESIGN_SCREENSHOTS` to an existing output directory to retain screenshots.
Remove only the temporary validation container and its exact test database afterward;
leave the normal development stack and both persistent volumes running.

## Pass 2 — Visual / product identity

### Direction and principles

The design is a **watch desk**: a calm place to identify the current register,
record arrivals and see the next planned dates. The recognizable element is not
a decorative nautical motif. It is a coordinated date marker, register identity,
explicit state and measured attendance progress. The palette and typography
support that working structure.

| Role | Choice |
| --- | --- |
| Navigation plane | Deep blue-gray `#203b49`, pale labels `#d7e5eb`, selected white text and a quiet inset marker |
| Working canvas / surfaces | Cool fog `#f4f7f8` / white `#ffffff`; boundaries `#d7e1e5` |
| Text | Ink `#203543`, secondary `#566b76` |
| Operational emphasis | Muted teal `#1c6470` for progress, focus and selected secondary navigation |
| States | Dark green / amber / red with restrained light surfaces; always text, with additional circles, squares, checks or minus marks |
| Type | Self-hosted IBM Plex Sans for titles, section headings, brand and counts; system sans for dense working text; system monospace for codes |
| Scale | Compact 20px page titles, 14–17px sections, 13–14px working text, 12px metadata; no display-sized marketing headers |
| Motion | Brief control-state feedback only; Bootstrap retains overlay mechanics; reduced motion respected |

The [official IBM Plex assets](https://github.com/IBM/plex/tree/bf260093582f04622aacc1e9f9ca604d7ccd0c42/packages/plex-sans/fonts/complete/woff2)
are pinned, unmodified and self-hosted with their SIL license. The two weights total
130,080 bytes (about 127 KiB); no font CDN, telemetry or runtime package was added.
The semibold face is preloaded and both use `font-display: swap`.

The frontend-design and dashboard skills influenced hierarchy, restraint and
shared primitives. Their framework-specific recipes were adapted to Bootstrap,
and their locked neutral-only palette was superseded by the user's explicit
creative brief. The [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines)
informed focus, target sizing, feedback and reduced-motion review. The security
skill kept the new Settings overview behind the existing permission gate. The
print-layout skill constrained the print-editor contrast fix to screen feedback;
physical geometry and PDF output were not changed.

### Product changes and reconsidered decisions

| Surface | Second-pass decision |
| --- | --- |
| Shell | Keep the rail and mobile drawer, but separate navigation from work through a blue-gray plane. Long terminology can wrap. Theme controls consistently, including formerly Bootstrap-blue secondary save buttons. |
| Home | Rename the title Home / Accueil. On wide screens, live registers and the upcoming agenda sit side by side; mobile presents live work first. Add calendar markers, live progress, an explicit not-yet-present count, and compact contextual shortcuts. No analytics or invented alerts. |
| Collections | Shared icon-led search, distinct toolbar/count rhythm, quieter metadata and contextual actions. Desktop participant identity and contact metadata use aligned columns; mobile retains a readable stack with larger link targets. Session dates reuse the Home markers. |
| Register | Counts and progress form one compact strip. Pending, present and absent states remain textual; present rows have a quiet surface treatment. Recording absence is visible but no longer repeated as a visually alarming destructive action. |
| Mobile register | Put status and direct attendance actions on one compact row for non-present participants. Hide only non-applicable arrival/punctuality cells; present rows retain their arrival details, including unknown timestamps, and correction controls. |
| Quick Attendance | Keep its dedicated shell, count and Undo, stable feedback space, Search/QR exclusivity and scanner cleanup. Add synchronized progress, stronger mode selection, explicit “+ Present” targets and restrained confirmation/error surfaces. Remove empty layout anchors and unused result-space padding. |
| Reporting | Keep the first-pass preview and exact export selection. Distinguish filter selection, result preview and report browsing. Wide layouts use a supporting browse column, not competing cards. Pseudonymized mode gets a clear identity-protected notice. |
| Report actions | Reverse the first-pass menu choice for session reports: View and Excel export are directly visible, including mobile. These are frequent, safe actions, not occasional administrative commands. |
| Settings landing | `/settings` now renders an administrator-only overview instead of redirecting to Language and region. No single infrequent configuration task deserves the default; the overview explains all eleven destinations in the existing three groups and shares their navigation definition. It does not load or reveal provider secrets. |
| Settings surfaces | Use quiet ruled sections, clearer headings and explicit save boundaries. The Privacy eligibility summary becomes a semantic flat metric strip instead of seven KPI cards. Reporting and Privacy share the strip renderer. Terminology blocks and form disclosures remain compact. |
| Empty / error / loading | No-match states provide a Clear action and restore search focus. Shared errors show a restrained status code and useful recovery; 403/404 no longer offer a futile retry. Native save forms show Saving… without interfering with validation or intercepted workflows; browser history restores their label. |

The architecture and actions remain server-rendered. No SPA, new frontend framework,
autosave, offline mutation queue, bulk anonymization or speculative business action
was introduced. Customizable business terminology still flows through the central
service, and entered names, descriptions and titles are never translated.

### Refactors and blast radius

| Primitive / change | Scope and risk | Evidence |
| --- | --- | --- |
| `renderDateMarker` | Home and session collection; low | Complete accessible date, installation locale, calendar date stays unshifted; unit and mobile checks |
| `renderAttendanceProgress` plus one client updater | Home, register, Quick Attendance; medium | Only reads existing counts; zero-total and bounds tests; live manual/Undo assertions |
| Shared Settings destination definition | Navigation and overview; low | Eleven destination unit check and real administrator/manager/operator requests |
| `renderMetricStrip` | Reporting summaries and Privacy eligibility summary; low | Semantic definition list, escaped labels/values, unchanged calculations; unit and browser coverage |
| Cached collection keys, collator and visible-page ordering | Existing collection client; medium | No data/query change; search, reset, ordering, pagination, focus and measured scaling |
| CSS tokens and control layer | All standard pages plus dedicated Quick Attendance; medium | Desktop/mobile route sweeps, EN/FR screenshots, automated accessibility and workflow checks |

No generic component framework was created. The new helpers represent actual
repeated concepts; Bootstrap continues to own menus, offcanvas, modals and controls.

### Performance observations

Measurements are local, synthetic, single-user observations, not production SLOs.
Browser interaction timing measures synchronous event handling, not the entire
input-to-paint interval. The 1,000/5,000-row collection cases expand the real DOM
fixture and exercise the shipped client script; they do not benchmark the database.

| Collection size | Pass-1 sorting / worst filtering | Pass-2 sorting / worst filtering |
| --- | --- | --- |
| 65 | 8.5 / 0.9 ms | 1.5 / 0.3 ms |
| 1,000 | 12.7 / 11.8 ms | 1.6 / 1.3 ms |
| 5,000 | 151.3 / 151.4 ms | 4.4 / 3.1 ms |

The client now caches search strings and names, constructs one locale-aware
collator, sorts lazily once, and moves at most the visible 50 rows when their order
or membership changes. It does not sort and reattach the full list per keystroke.
All rows are still loaded into HTML. Reassess server pagination above 5,000 rows,
on low-memory phones, or when actual input-to-paint exceeds 100 ms; this optimization
does not establish that arbitrarily large directories are cheap to load.

The small-fixture Reporting HTTP response measured about 4 ms median warm and
5.3 ms maximum warm, around 13 KB of HTML. Backend-only `getGlobalReport` measurements
used real synthetic historical rows with punctuality and both privacy contexts:

| Historical attendance records | Closed sessions | Identified warm | Pseudonymized warm |
| --- | --- | --- | --- |
| 10,010 | 154 | 52–62 ms | 56–59 ms |
| 50,050 | 770 | 292–331 ms | 312–324 ms |

The benchmark retained full report objects during repeated runs; sampled process
heap ranged up to 362 MiB in the 50,050-row private case, without forced GC. This
is not an incremental per-request allocation measurement. It is a reason to watch
memory and concurrent report requests. Keep the shared dataset at current small
scale; review an aggregate-only preview using shared calculation logic around
50,000 history rows, a >500 ms warm response, or constrained VPS memory. Do not add
a privacy-bypassing fast path. No report dataset/query was changed in this pass.

### Validation and accessibility

- `npm test`: **112 passed**. Four new second-pass tests cover calendar markers,
  bounded progress, Settings overview and the shared metric strip. Existing error
  recovery tests also check the intentional 403 behavior.
- `npm run test:integration`: **14 passed**. The Home/Accueil wording assertions
  and PWA v17 assertion were updated to their explicit new values, not weakened.
  Existing integrity, privacy, audit, migration and backup/restore assertions remain.
- Browser checks: 29-route desktop sweep at 1440px; 21-route mobile sweep at each
  of 360, 390 and 430px; Settings overview and direct report actions additionally
  checked. Eight key French routes were swept at all three mobile widths.
- Automated accessibility: 17 representative routes at desktop and mobile,
  **34 checks with zero WCAG A/AA tagged violations**. This includes WCAG 2.2
  target-size checks. It is not a conformance certification or screen-reader test.
- Fixed findings: destructive outline-button contrast, mobile name/e-mail target
  spacing, and disabled print-editor element contrast. Disabled editor elements
  remain selectable and visually distinct; no print/PDF geometry changed.
- Keyboard/runtime checks cover drawer/menu Escape and focus restoration,
  search-clear focus, manual-attendance refocus, arrival dialog, stable Quick
  Attendance search position, reduced-height viewport and reduced-motion rendering.
- Full workflow checks passed: create/edit class, participant and session; open,
  manual/QR attendance, duplicate idempotency, invalid QR, Undo, close, reject closed
  writes, add a later member, reopen the unchanged historical roster, correct arrival,
  reclose, CSV identity matching, QR identity preservation and French XLSX output.
- PWA v17 explicitly includes only the two additional public font assets. Stale
  v15/v16 caches are removed, unrelated caches survive, authenticated resources
  remain uncached and offline writes remain network-required.

### Current visual review

Nineteen review screenshots used synthetic records and `example.invalid` addresses only.
The binary review artifacts are not retained in the repository.
English UI with French-Belgian regional formatting is deliberate. The private
French Reporting screenshot deliberately retains English business-output language
inside the preview: interface language does not override business language.

| Desktop | Mobile |
| --- | --- |
| Home | Home |
| Students | Students |
| Classes | French Home |
| Sessions | Sessions |
| Attendance | Attendance |
| Reporting | Quick Attendance |
| Private Reporting, French | Quick Attendance, French |
| Settings overview | Settings overview |
| Language and region | Settings overview, French |
| Privacy Center | |

### Files changed in pass 2

- Renderers: `src/ui.js`, `src/server.js`, `src/course-sessions.js`,
  `src/reporting.js`, `src/privacy-settings.js`.
- Catalogs: `src/i18n/en.js`, `src/i18n/fr.js`.
- Presentation/runtime: `public/css/styles.css`, `public/js/classes.js`,
  `public/js/live-attendance.js`, `public/service-worker.js`,
  `public/manifest.webmanifest`.
- Font assets: `public/fonts/plex/IBMPlexSans-Regular.woff2`,
  `IBMPlexSans-SemiBold.woff2`, `LICENSE.txt`, `README.md`.
- Tests: `test/workspace-ui.test.js`, `test/i18n-output.test.js`,
  `integration/reporting-punctuality.integration.js`,
  `integration/redesign-browser.cjs`, `integration/redesign-workflows.cjs`.
- New diagnostics: `integration/redesign-accessibility.cjs`,
  `integration/redesign-performance.cjs`, `integration/redesign-report-performance.js`.
- Handoff: this document; screenshot binaries removed after design acceptance.

The existing uncommitted pass-1 changes in `src/classes.js`, `src/students.js`
and `integration/redesign-fixture.js` remain preserved; those files were not
rewritten in pass 2.

### Reproduction, boundaries and shipping judgment

Use the opt-in synthetic fixture instructions above. Run the main browser suite
before `redesign-workflows.cjs`, since the latter creates additional records.
Run the performance and accessibility scripts with the same `PLAYWRIGHT_MODULE`
and `PLAYWRIGHT_BROWSERS_PATH`; accessibility additionally accepts `AXE_MODULE` for
the isolated `@axe-core/playwright` installation. Run the backend performance script
inside the guarded fixture container. It creates and removes its own benchmark
class and historical rows, never normal application data.

Hard invariants remain intact: RBAC and View PII; GDPR/retention/anonymization;
participant exports; audit accountability; backup/restore; attendance persistence,
historical rosters and QR idempotence; business-language inheritance; independent
language, locale and timezone; UTC instant storage; Reporting calculations and
the existing schema/migration history. No production data, credentials, secrets,
recovery files or generated databases are included in the changes. Licensed font
files are the only retained new binary visual assets.

The normal local Compose app is updated and remains running, with both persistent
volumes preserved. Temporary validation data is removed at handoff. No commit or
push was made during either design pass; branch finalization is a separate task.

Remaining release checks: physical phones and camera acquisition in real lighting;
hardware audio/haptics and the virtual keyboard; Safari/Firefox; screen-reader
review; live SMTP/S3/Azure operations; largest-production-history and concurrency
measurements. Existing polling still requires a Home reload to discover a newly
opened register. Both design passes have since passed independent Claude review.

**If Attendance Log were my own product, is this the design I would ship? Yes.**
This is the visual and interaction direction I would ship: clear, recognizable,
compact and operational. The remaining work is release validation on real devices
and infrastructure, not another redesign or an unresolved design compromise.

### Follow-up — compact status sizing

The French attendance badge exposed an intrinsic-width regression: `En attente`
needs about 88.44px including padding, dot and gap, while the desktop register
allocated 5.5rem (88px) and the 360px mobile register allocated about 83.42px.
The shared badge's `white-space: normal` and `max-width: 100%` split the label,
increasing its height from about 23.59px to 39.19px.

Status badges now use max-content width and nowrap. The existing register tracks
respect the status's intrinsic minimum on mobile and desktop. Names, descriptions,
long contextual actions and dropdown items retain their existing wrapping rules.
No translations, attendance logic or permissions change. The static stylesheet
continues to refresh through the existing network-first PWA asset policy; the
service-worker allowlist and cache version are unchanged.

Run `node integration/redesign-status-controls.cjs` with the same isolated browser
tooling and fixture described above. It checks real text fragments, chip height,
clipping, column containment and page overflow across 17 routes in both languages
at 360/390/430/768/992/1024/1440px, plus applicable status variants. It fails on the
old stylesheet's two-line French badge. Review screenshots are temporary only.
