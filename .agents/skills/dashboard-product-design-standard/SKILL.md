---
name: dashboard-product-design-standard
description: >-
  Build Linear-class admin dashboards with compact hierarchy, dense tables,
  icon+label nav, mandatory page features (search, filters, bulk actions), and
  shadcn/ui. Use when designing, building, or reviewing admin apps, ops
  dashboards, SaaS consoles, internal tools, or settings—not marketing pages.
---

# Dashboard Product Design Standard

Locked standard for admin/dashboard software. Target **Linear-class density and
hierarchy**: compact sidebar, quiet chrome, table-first pages.

Read [components.md](components.md) before inventing layout.  
Foundations: sibling skill `dashboard-design-system`.

## Non-negotiables

1. **shadcn/ui** for all interactive primitives (`@/components/ui/*`).
2. **Nav = icon + short label only** — never a description line under each item.
3. **Compact page header** — title `text-lg`/`text-xl`; optional one-line
   description; one primary button.
4. **Table-first** — do not wrap the main list in a large padded card.
5. **Row actions in `DropdownMenu`** — no always-visible Delete buttons.
6. **Tokens** from `dashboard-design-system` — cool neutrals, not warm cream/orange brochure.
7. **Admin composites** from [components.md](components.md).
8. **Mandatory page features** — for each page type, implement search, filters,
   selection, bulk actions, empty/error states, etc. per
   [page-features.md](page-features.md) **even if they do not exist yet**.
   Restyling alone is incomplete.

## When to apply

Ops dashboards, CMS/admin, billing admin, support, developer portals, settings,
workflow monitors.

Do **not** use for marketing / landing pages.

## Agent workflow

1. Apply `dashboard-design-system` tokens + type + shadcn mapping.
2. Rebuild shell/nav per [components.md](components.md) (reject verbose nav).
3. Map IA by **operator frequency** — [information-architecture.md](information-architecture.md).
4. **Classify each page** and implement the full feature set in
   [page-features.md](page-features.md) (add missing search/bulk/filters/etc.).
5. Page recipe: compact header → toolbar (search/filters) → flush `Table` →
   bulk bar when selected.
6. Interaction/feel — [interaction.md](interaction.md), [engineering.md](engineering.md).
7. Pass the checklist below (especially anti-patterns + features).

## Product rules

| Rule | Meaning |
| --- | --- |
| Hierarchy | Daily work top-left in nav; settings demoted |
| Density | Table owns the viewport |
| Quiet chrome | Sidebar and header take little vertical space |
| One primary action | Header CTA; row verbs in menus |
| Speed | Optimistic / local-first where safe |
| shadcn | No hand-rolled controls |

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js App Router |
| Styling | Tailwind v4 + CSS variables |
| Primitives | shadcn/ui |
| Icons | lucide-react |
| Composites | `@/components/admin/*` |

## Page recipe (collection)

```
AdminShell
├── sidebar: brand (h-12) · AdminNav (icon+label) · footer
└── main
    ├── header: title + count · primary Button
    ├── toolbar: search Input · filter Select(s) · sort
    ├── bulk bar (if selection): N selected · verbs · clear
    └── Table (flush) + checkboxes + row ⋯ menu
```

Full feature matrices: [page-features.md](page-features.md).

## Quality checklist

```
- [ ] Nav items are icon + label only (no subtitles)
- [ ] Nav ordered by daily importance; settings last
- [ ] Page title ≤ text-xl; no brochure subtitle block
- [ ] Main list/table not wrapped in a big card
- [ ] Row actions via DropdownMenu (⋯)
- [ ] Collection pages have search + filters + URL state
- [ ] Collection pages have row selection + bulk action bar
- [ ] Bulk/single verbs share the same actions
- [ ] Empty, no-results, error, loading states exist
- [ ] Cool neutral tokens (not cream + orange rail)
- [ ] All controls are shadcn
- [ ] Squint test: data surface dominates, not chrome
- [ ] Newly required features were implemented, not only restyled
```

## Resources

- [components.md](components.md) — shell + element catalog
- [page-features.md](page-features.md) — **mandatory features per page type**
- `dashboard-design-system` — tokens, type, shadcn
- [visual-system.md](visual-system.md) — density + silhouette
- [information-architecture.md](information-architecture.md)
- [interaction.md](interaction.md)
- [engineering.md](engineering.md)
- [examples.md](examples.md)
- [decisions.md](decisions.md)
