# Element catalog + shadcn mapping

**Rule:** Interactive = shadcn (or Admin composite on shadcn).  
**Quality bar:** Compact, hierarchical, table-first — like a serious ops tool (Linear-class density), not a marketing admin mock.  
**Features:** Every page type must ship the mandatory capabilities in
[page-features.md](page-features.md) (search, bulk actions, filters, …)—add them
if missing.

Install missing primitives:

```bash
npx shadcn@latest add button input textarea select checkbox switch label
npx shadcn@latest add dialog sheet dropdown-menu popover tooltip
npx shadcn@latest add table tabs badge separator scroll-area alert
```

Do **not** default to wrapping every page in `Card`. Prefer hairline regions and tables.

---

## Critical anti-patterns (reject these)

These match common bad agent output — **never ship them**:

| Bad | Why | Do instead |
| --- | --- | --- |
| Nav item = title + 2-line description | Destroys hierarchy; everything looks equal-important | Icon + short label only; optional `Tooltip` |
| Page title ~32–36px + long paragraph subtitle | Marketing layout | Title ~20–24px; one optional line ≤80 chars or omit |
| Whole page body inside a padded rounded card | Double chrome; feels toy | Table/list flush in content; card only for true panels |
| Always-visible `DELETE` / `REFRESH` buttons per row | Noise; scary destructive chrome | Row `DropdownMenu` (⋯); destructive inside menu |
| Uppercase mono everywhere (kickers, buttons, columns) | Shouty “ops kit” aesthetic | Sans for UI; mono only for IDs/numbers/timestamps |
| Wide airy gaps (`py-10`, `space-y-6` everywhere) | Low density | Tight shell padding; row ~36px |
| Orange/thick active rail + cream brochure look | Wrong hierarchy signal | Quiet active fill; cool neutral canvas |

---

## 1. Primitives → shadcn (mandatory)

| Need | Use |
| --- | --- |
| Action | `Button` |
| Text | `Input`, `Textarea` |
| Enum | `Select` |
| Boolean | `Checkbox`, `Switch` |
| Label | `Label` |
| Modal | `Dialog` |
| Drawer / mobile nav | `Sheet` |
| Menus | `DropdownMenu` |
| Hint | `Tooltip` |
| Anchored panel | `Popover` |
| Tabs | `Tabs` |
| Data | `Table` |
| Count / tag | `Badge` |
| Rule | `Separator` |
| Icons | `lucide-react` (`size-4`) |

### Button matrix

| Intent | variant | size |
| --- | --- | --- |
| Primary (one per view) | `default` | `sm` |
| Secondary | `outline` | `sm` |
| Toolbar / quiet | `ghost` | `sm` |
| Destructive (confirm flows) | `destructive` | `sm` |
| Icon-only | `ghost` | `icon` + `aria-label` |

No uppercase tracking on buttons. Plain sentence or Title Case labels (“New type”, not “NEW TYPE”).

---

## 2. Shell

### `AdminShell`

```
Desktop: grid [15rem | 1fr]  (sidebar ~240px)
Sidebar: sticky h-screen border-r border-hairline bg-sidebar
Main:    min-w-0 flex flex-col
Content: px-4 py-4 sm:px-6  (NOT py-8/py-10)
Max width: none for list/table pages; max-w-5xl only for settings/forms
```

**Sidebar stack (compact)**

1. **Brand** — `h-12` flex items-center `px-3`
   - Wordmark `text-sm font-semibold` + optional muted “Admin”
   - **No** tagline (“Operations workspace”)
2. **`AdminNav`** — `flex-1 overflow-y-auto px-2 py-2`
3. **Footer** — `border-t px-2 py-2`  
   - Email truncated `text-xs text-ink-3`  
   - `Button` ghost sm: View site / Sign out (icon+label or icon with tooltip)

### Page header (compact)

```
Row: [ title + optional one-line description ] ........ [ toolbar actions ]
```

| Part | Spec |
| --- | --- |
| Title | `text-lg` or `text-xl` font-semibold tracking-tight — **not** 30–36px |
| Description | Optional `text-sm text-ink-2`; **max one line**; omit if redundant with title |
| Kicker | Optional; if used, `text-xs text-ink-3` — **not** required mono uppercase block |
| Actions | One primary `Button` sm; rest ghost/outline; no mono uppercase |

Header padding: `pb-3 mb-3` + optional `border-b border-hairline`.  
**No** huge `pb-7 mb-10` brochure headers.

### Mobile

`Sheet` left, same compact nav (icon + label). Sticky top bar `h-12`.

---

## 3. Navigation — hierarchy rules

### What is important vs not

| Priority | Examples | Treatment |
| --- | --- | --- |
| **Primary** (daily) | Inbox, Issues, Workflows, Catalog | Top groups; always visible; icon + label |
| **Secondary** | Channels, Integrations | Lower group; same compact row |
| **Tertiary** | Settings, Billing, Audit | Bottom group or below separator; never compete with Inbox |

Order groups by **operator frequency**, not org-chart completeness.

### `AdminNav` item (locked)

```
height:   h-8 (32px)
layout:   flex items-center gap-2 px-2 rounded-md
icon:     lucide size-4 text-ink-3 (active: text-ink)
label:    text-[13px] font-medium truncate
badge:    optional count Badge secondary, right-aligned
```

**Forbidden on nav items:** description/subtitle lines under the label.

Optional: `Tooltip` with the longer explanation on hover/focus.

**Active:** `bg-canvas-hover text-ink` (quiet). No thick accent border rail required.  
**Idle:** `text-ink-2 hover:bg-canvas-hover hover:text-ink`.  
**Group label:** `px-2 pb-1 pt-3 text-[11px] font-medium text-ink-3` — sentence or small caps, not shouty tracking.

```tsx
// Shape
{ label: "Monitor", items: [
  { id: "inbox", href: "/admin", label: "Inbox", icon: Inbox },
  { id: "workflows", href: "/admin/workflows", label: "Workflows", icon: Workflow },
]}
// description?: never rendered in the row
```

Keep **≤7** primary destinations visible. Push the rest under “More” or Settings.

---

## 4. Page body patterns

### List / catalog / table pages (default)

**Required features** (not optional): search, filters, sort, checkboxes,
bulk bar, row `⋯` menu, counts, empty/no-results — see
[page-features.md](page-features.md).

```
AdminShell
└─ header (compact) + count + primary CTA
└─ toolbar: search Input | filter Select(s) | sort
└─ bulk bar when selection non-empty
└─ Table full width of content column
   - checkbox column + header select-all (filtered set)
   - NOT wrapped in AdminCard
```

### `AdminStat` strip (overview only)

Use a **tight** grid on overview dashboards only: `grid gap-2 sm:grid-cols-4`.  
Compact: `p-3`, label `text-xs text-ink-3`, value `text-xl font-semibold tabular-nums`.  
Do not lead every page with four vanity stats.

### `AdminCard`

Use **only** for:

- Grouped settings blocks
- True side panels
- Alert/empty callouts that need a boundary

Do **not** wrap the primary table in a card titled “Catalog (N)” — put the count in the page header or table caption.

### Rows & tables

| Part | Spec |
| --- | --- |
| Head | `text-xs font-medium text-ink-3` — Title Case or short labels, not `TYPE` scream |
| Cell | `text-[13px] text-ink` |
| Secondary line in cell | `text-xs text-ink-3` (slug, path) |
| Row | `h-10` / py-2; `hover:bg-canvas-hover` |
| Status | Dot + lowercase label OR `Badge` outline — quiet |
| Actions | Last column: `DropdownMenu` trigger `Button` ghost icon (`MoreHorizontal`) |

Row actions:

- Primary navigation = click row / title link
- Refresh, delete, archive → menu items
- Destructive menu item uses destructive text; confirm with `Dialog`

### Empty / loading

- Empty: one sentence + optional single outline button — no illustration
- Loading: keep table chrome; skeleton rows — no full-page spinner

---

## 5. Status & progress

### `AdminStatusMark`

`inline-flex items-center gap-1.5 text-xs text-ink-2`  
Dot `size-1.5 rounded-full`: live=`bg-ok`, alert=`bg-err`, else `bg-ink-3`.  
Label lowercase/sentence (“researching”, “active”) — not `RESEARCHING`.

### `AdminStageBar`

Only on workflow detail / in-flight cards. Thin segments `h-1`. Hide on catalog tables.

### `AdminAlert`

Rare. `border-err` + short title. Prefer inline error text in forms.

---

## 6. Forms & overlays

- Short create/edit → `Dialog`
- Longer create → `Sheet`
- Labels above fields; `space-y-3` (tight)
- Confirm delete → `Dialog` with destructive confirm

---

## 7. Reference composite API

```tsx
AdminShell({ title, description?, active, children, actions?, adminEmail? })
AdminNav({ active })           // icon + label rows only
AdminMobileNav({ active, adminEmail? })
AdminStat({ label, value, hint?, alert? })      // overview only
AdminCard({ title, description?, action?, children }) // non-table panels
AdminStatusMark({ status, live?, alert? })
AdminStageBar({ stages, stageIndex })           // workflow surfaces
```

Page files: data + these composites + shadcn `Table` / `DropdownMenu` / `Button`.
