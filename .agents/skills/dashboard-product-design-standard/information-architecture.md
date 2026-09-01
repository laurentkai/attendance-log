# Information architecture

## Shell anatomy

Implement with `AdminShell` + `AdminNav` + `AdminMobileNav` per
[components.md](components.md). Separate roles ruthlessly:

| Region | Owns | Does not own |
| --- | --- | --- |
| **Sidebar** (`AdminNav`) | Destinations: **icon + label only**, grouped by frequency | Long descriptions, filters, record fields |
| **Mobile nav** (`Sheet`) | Same compact destinations | A second IA |
| **View header** | Compact title, optional one-line desc, one primary CTA | Brochure subtitles, multi-CTA toolbars |
| **Main canvas** | **Table/list first** (flush); stats only on overview | Card-wrapping the primary dataset |
| **Context panel** | Metadata, properties, activity for the focused entity | Primary navigation |
| **Overlays** (shadcn Dialog/Sheet/Dropdown) | Commands, previews, confirmations | Permanent structure |

Users should feel hierarchy after a minute of use even if they cannot name it.
Do not ship top-nav-only admins or marketing “card dashboards.”

## Navigation hierarchy

1. **Workspace / org** — rare switches
2. **Team or partition** — primary membership boundary
3. **Collection views** — inbox, active, backlog, custom views
4. **Entity** — the record
5. **Sub-resources** — comments, attachments, history

Prefer **goto chords** (e.g. go-to team, go-to inbox) over deeply nested menus for power users. Keep mouse paths shallow (≤2 clicks to common destinations).

## Page hierarchy

- **Queue pages** (inbox, triage, notifications): optimize scan + act + next.
- **Work lists** (filtered collections): optimize sorting, grouping, bulk.
- **Entity pages**: optimize reading, commenting, deep edit.
- **Plan pages** (roadmaps, timelines): optimize orientation across many entities.
- **Settings**: optimize findability; use tables for people/resources, not nested maze forms.

## Resource hierarchy

Model a clear graph:

`Initiative / Goal → Project / Effort → Work item → Sub-item` (only if needed)

Rules:

- Every work item has a **single accountable owner**.
- Higher constructs exist to give **meaning and direction**, not to duplicate lists.
- Avoid parallel overlapping taxonomies (three ways to mean “priority”).

## Sidebar organization

- Each item: **lucide icon + short label** (+ optional count badge). **No subtitle.**
- Order groups by **daily operator frequency** (e.g. Inbox/Workflows before Settings).
- Keep primary items scannable (**≤7** persistent destinations).
- Push infrequent destinations into Settings or More.
- Unread: calm count badge; not a second description line.
- Active state: quiet background fill — not a thick accent rail.

## Settings organization

- Split **account** vs **workspace/team** vs **integration** clearly.
- Prefer searchable settings + command palette entry points.
- Represent people, teams, and resources as **filterable tables**, not endless stacked cards.
- Progressive complexity: defaults first; advanced sections collapsed.

## Search organization

Provide **layered search**, not one overloaded box:

| Layer | Trigger pattern | Behavior |
| --- | --- | --- |
| Workspace search | `/` or sidebar | Titles, bodies, comments; rank **active work before done/archived** |
| Find-in-view | Cmd/Ctrl-F | Ephemeral title/id filter of the current list/board; Esc clears |
| Recents / open | goto chord (e.g. open → issues) | Resume; partial title/id |
| Command palette | Cmd/Ctrl-K | Actions + navigation + entities; optional type prefixes (`i `, `p `, `u `) |

Unified ranking heuristics: exact id → recency/frequency → fuzzy title → command fallback (“create…”).

Support inline filter tokens in search (e.g. @assignee) that compile into real filters.

Search should highlight matched terms in titles. Cap result sets sanely; allow re-sort (relevance, updated, created).

## Filtering strategy

- Filters live in the **view header**, as a composable formula users can click to edit.
- Support include/exclude, any/all, and field-specific operators.
- **Saving a filter set creates a view**—views are durable; ad-hoc filters are ephemeral.
- URL should reflect active filters for shareability.
- Default views should already exclude “not ready” states (e.g. untriaged) unless explicitly included.

## Command palette behavior

The palette is the **universal index**:

- Opens instantly; input focused; focus trapped
- Mixed results: recent, entities, commands
- Shows keyboard accelerators beside commands
- Arrow navigate; Enter run; Esc close; restore prior focus
- Preview/peek of highlighted entity when safe
- Inline create patterns (“New … matching query”) when creation is common

## Breadcrumbs & deep linking

- Breadcrumbs for deep entity hierarchies; omit when the view header already states location.
- Every meaningful state needs a URL: entity, view, filters, selected tab.
- Prefer shareable links that do not grant access implicitly—authz remains server-side.
- Support opening a **explicit set of entities** via link when collaboration needs a temporary working set without creating a saved view.

## Entity relationships in UI

- Show relationship chips sparingly in lists; full graph on entity page.
- Bidirectional links should be obvious (blocking, parent, related).
- Don’t force users to remember ids—surface titles with ids as secondary.
