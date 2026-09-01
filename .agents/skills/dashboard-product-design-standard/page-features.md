# Mandatory page features

**Rule:** For each page type below, implement the listed features even if they do
not exist yet in the codebase. Missing search, selection, bulk actions, filters,
or empty states is a defect—not “out of scope.”

When redesigning or building a dashboard page:

1. Classify the page (table below).
2. Copy the feature checklist into the work plan.
3. Ship UI **and** working behavior (API/actions/state)—not placeholders that look real.
4. If a backend capability is truly impossible in-session, implement the UI wired
   to a clear stub/`TODO` path and say so—but still ship the interaction shell.

Use shadcn: `Input`, `Checkbox`, `DropdownMenu`, `Select`, `Button`, `Dialog`,
`Table`, `Badge`.

---

## Page types

| Type | Examples | Primary job |
| --- | --- | --- |
| **Overview** | `/admin` home | Health at a glance + jump to work |
| **Collection / table** | Product types, orders, users, drops | Find → select → act on many/few |
| **Inbox / queue** | Triage, needs attention | Process next item fast |
| **Detail** | Type detail, order detail, run detail | Inspect + mutate one entity |
| **Workflow / monitor** | Runs, pipelines | Track progress + recover |
| **Create / edit** | New type, settings form | Complete a short form |
| **Settings** | Workspace, integrations | Find and change config |

---

## Universal (every dashboard page)

Ship all of these on every page:

| Feature | Requirement |
| --- | --- |
| Clear title | Compact header; page purpose obvious in 1s |
| Primary action | One header CTA when the page can create/start work (omit only if truly read-only) |
| Empty state | Copy + next action when there is no data |
| Error state | Failed load shows retry; never a blank main |
| Loading | Skeletons or quiet progressive load — keep chrome stable |
| Deep link | URL identifies the page; filters/selection encoded when relevant |
| Auth gate | Respect admin auth; noindex admin routes |

---

## Collection / table pages (default for catalogs)

**Implement all of these** (this is the Product types / list pattern):

| Feature | Spec |
| --- | --- |
| **Search** | Toolbar `Input` (with search icon); filters the list by name/slug/id as the user types (debounce ~150–200ms). Show “No matches” empty state when query has zero hits. |
| **Filters** | At least status and/or category (domain-appropriate) via `Select` or filter chips. Cleared filters reset in one click. Reflect filters in the URL (`?q=&status=`). |
| **Sort** | Clickable column headers or a sort `Select` for the 1–2 key fields (name, updated). Persist in URL. |
| **Row selection** | Leading `Checkbox` column; header checkbox = select all **in the current filtered set**. |
| **Bulk action bar** | When `selection.size > 0`, show a sticky/toolbar bar: “N selected” + bulk verbs (same verbs as row menu: e.g. Refresh, Archive, Delete). Clear selection control. |
| **Bulk confirm** | Destructive bulk → `Dialog` confirm with count. |
| **Row actions** | Trailing `DropdownMenu` (⋯): Open, primary verbs, destructive last. |
| **Click-through** | Primary cell (name) links to detail or opens sheet. |
| **Counts** | Visible total and/or “showing X of Y” when filtered. |
| **Pagination or windowing** | If >100 rows: paginate **or** virtualize. Never dump unbounded DOM without a plan. |
| **Refresh data** | Explicit refresh control and/or soft revalidate; don’t rely only on full reload. |

### Bulk bar layout

```
[✓] N selected    [Refresh] [Archive] [Delete]              [Clear]
```

Use `Button` `sm` ghost/outline; Delete opens confirm `Dialog`.

### Selection rules

- Highlight (hover/focus) ≠ selected.
- Shift-click selects a range when practical.
- Bulk verbs call the same server actions as single-row verbs (batch endpoint or parallel), not a fake UI.

---

## Overview pages

| Feature | Spec |
| --- | --- |
| **Stat strip** | 3–4 compact metrics (only actionable/health signals) |
| **Needs attention** | List or cards of alerts / failing runs / blocked items with links |
| **Recent activity** | Short feed with timestamps |
| **Jump actions** | Shortcuts to primary collection create / inbox |
| **Auto-refresh** | Optional soft refresh while critical work is in flight (announce quietly) |

No vanity charts unless the metric drives an action.

---

## Inbox / queue pages

| Feature | Spec |
| --- | --- |
| Everything in **Collection** that applies | Search, filters, selection, bulk |
| **Peek or split** | Inspect item without losing list position |
| **Keyboard** | j/k or ↑/↓ move highlight; Enter open; keys for common verbs when not in an input |
| **Mark done / snooze / assign** | First-class bulk + single actions |
| **Unread / priority signal** | Calm badge or dot — not loud color spam |

---

## Detail pages

| Feature | Spec |
| --- | --- |
| **Identity header** | Name + status + key ids |
| **Primary actions** | Context actions in header (and overflow menu) |
| **Editable properties** | Inline or short form sections; save feedback |
| **Related list** | Child table with its own search if >10 rows |
| **Activity / audit** | Recent events for this entity |
| **Danger zone** | Isolated destructive actions with confirm |
| **Back to collection** | Preserves prior query string when possible |

---

## Workflow / monitor pages

| Feature | Spec |
| --- | --- |
| **Live status** | Stage/progress (`AdminStageBar` or equivalent) |
| **Filter by state** | running / failed / succeeded |
| **Search** | By run id, entity name |
| **Row/detail actions** | Cancel, retry, open run — in menu + confirm when destructive |
| **Bulk cancel/retry** | When multiple selectable |
| **Auto-refresh** | While any row is in-flight |
| **Error visibility** | Surface `lastError` / why — not just “failed” |

---

## Create / edit pages (Dialog, Sheet, or full page)

| Feature | Spec |
| --- | --- |
| **Minimal required fields** | Defaults for the rest |
| **Validation** | Inline errors; don’t wipe input |
| **Submit + cancel** | Primary/secondary buttons; Esc cancels when safe |
| **Create and continue** | Optional Cmd/Ctrl-Enter when creating many |
| **Success path** | Navigate to detail or collection with toast/feedback |

---

## Settings pages

| Feature | Spec |
| --- | --- |
| **Search settings** | Filter sections/fields when the page is long |
| **Grouped sections** | `AdminCard` per group |
| **Save affordance** | Explicit save or clear autosave indicator |
| **Danger zone** | Separated, confirmed |
| **Tables for people/resources** | Same collection features (search, bulk) when listing members/tokens |

---

## Implementation expectations for agents

When the user asks to rethink/redesign a dashboard page:

1. **Do not** only restyle existing controls.
2. **Add** missing mandatory features for that page type.
3. Prefer URL-encoded `q`, filters, and sort for collection pages.
4. Wire selection + bulk bar to real mutations (or shared action helpers).
5. Reuse one action module for single-row and bulk paths.
6. Call out in the summary which features were newly added.

### Product types page example (minimum)

Even if today’s page is “table + delete,” ship:

- Search by name/slug  
- Status (and/or coverage) filter  
- Sort by name / updated  
- Checkboxes + select all (filtered)  
- Bulk bar: Refresh, Delete (confirm)  
- Row `⋯` menu  
- Empty + no-results states  
- Count in header (“135” / “12 of 135”)  
