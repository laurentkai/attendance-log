---
name: dashboard-design-system
description: >-
  Apply the locked dashboard design system: cool neutral tokens, dense
  typography, spacing, and mandatory shadcn/ui primitives for Linear-class
  admin density. Use when theming or styling admin dashboards and ops
  consoles—not marketing sites.
---

# Dashboard Design System

Foundations for **dashboard / admin UI only**: cool neutrals, tight type, shadcn
primitives. Target **Linear-class density and hierarchy** — not brochure admins.

For shell, nav rules, and page recipes, also apply
`dashboard-product-design-standard`.

## Non-negotiables

1. **Dashboard scope only**
2. **Tokens** from [tokens.md](tokens.md) — cool gray canvas, quiet accent
3. **shadcn only** for interactive controls — [shadcn.md](shadcn.md)
4. **Dense type** — [typography.md](typography.md); page titles ≤ `text-xl`
5. **Lucide only**
6. **No warm cream + orange ops kit** look; no uppercase mono chrome

## Agent workflow

1. Confirm surface is dashboard/admin — else stop.
2. Apply [tokens.md](tokens.md) + [typography.md](typography.md).
3. Map shadcn per [shadcn.md](shadcn.md).
4. Compose primitives per [components.md](components.md).
5. Check [do-dont.md](do-dont.md).

## Token cheat sheet

| Role | Token | Hex |
| --- | --- | --- |
| Background | `--canvas` | `#fafafa` |
| Hover | `--canvas-hover` | `#f4f4f5` |
| Text | `--ink` | `#18181b` |
| Secondary | `--ink-2` | `#52525b` |
| Meta | `--ink-3` | `#a1a1aa` |
| Border | `--hairline` | `#e4e4e7` |
| Focus | `--accent` | `#3f3f46` |
| Success | `--ok` | `#16a34a` |
| Danger | `--err` | `#dc2626` |

Primary buttons = **ink fill**. Active nav = **hover fill**, not a loud rail.

## Resources

- [tokens.md](tokens.md)
- [typography.md](typography.md)
- [shadcn.md](shadcn.md)
- [components.md](components.md)
- [do-dont.md](do-dont.md)
