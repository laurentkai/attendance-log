# Examples — before / after

## 0. Failed skill output (catalog admin)

**Before (reject)**  
Warm cream shell; sidebar items with title + description (“Coverage and refreshes”);
“CATALOG” kicker + 36px “Product types” + two-line blurb; body inside a large
rounded “Catalog (135)” card; columns `TYPE`/`COVERAGE` screaming uppercase;
always-visible `REFRESH` + red `DELETE` on every row; orange active rail.

**Why it fails**  
Chrome and copy compete with the data. Nav has no importance hierarchy. Density
is brochure-level. Destructive actions dominate.

**After (required)**  
Cool neutral shell (~240px sidebar). Nav: icon + “Inbox”, “Workflows”, “Product
types”, … only. Header: `text-xl` “Product types” + count + `Button` “New type”.
Toolbar: search + status filter. Flush `Table` with checkboxes; bulk bar on
selection (Refresh / Delete); row `⋯` menu; no-results empty state; URL `?q=`.

---

## 1. Issue / ticket list

**Before**  
Every row shows description snippet, 6 tags, avatars, dates; card chrome; Edit button per row.

**After**  
shadcn `Table`: identity · title · 2–4 props · `AdminStatusMark`. Actions in
`DropdownMenu`. Click title to open; peek/split if triage-heavy.

---

## 2. Settings people page

**Before**  
Stacked profile cards, buried role controls.

**After**  
Dense `Table` in content (or single settings `AdminCard` only if needed): name,
email, role, last active. Bulk via selection + same menu verbs.

---

## 3. Create flow

**Before**  
Full-page wizard, 12 required fields.

**After**  
`Dialog` or `Sheet`: title required; defaults from context; `Button` sm submit.

---

## 4. Review queue

**Before**  
Click → full page → lose list context.

**After**  
Split list + detail; j/k moves selection; Esc back to list.

---

## 5. Filters

**Before**  
Modal of 20 checkboxes; URL unchanged.

**After**  
Toolbar chips / `Select`s above table; URL encodes state.

---

## 6. Nav hierarchy

**Before**  
Flat list of 12 links all with paragraphs.

**After**  
Groups by frequency; icon+label; Settings last; tooltips for extra help.
