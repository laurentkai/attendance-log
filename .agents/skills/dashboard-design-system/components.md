# Component look (dashboard primitives)

shadcn primitives in a **dense** dashboard. Shell/nav/table recipes:
`dashboard-product-design-standard` → `components.md`.

## Surfaces

| Element | Look |
| --- | --- |
| Page | `bg-canvas text-ink` |
| Sidebar | `bg-sidebar border-r border-hairline` |
| Panel (rare) | `rounded-lg border border-hairline p-4` — no shadow |
| Primary data | **Flush table** — not inside a padded card |
| Mobile bar | `h-12 border-b` |

## Button

- Primary: ink fill; label Title Case / sentence case
- Ghost for toolbar and `⋯` triggers
- No uppercase tracking labels

## Input / Select

- Compact `h-8` / `h-9` where possible
- Hairline border; placeholder `text-ink-3`
- Focus via ring → accent

## Badge

Quiet `secondary` / `outline`. Counts small. No rainbow.

## Table

- Head: `text-xs font-medium text-ink-3` (not screamed uppercase mono)
- Cell: `text-[13px]`
- Row hover: `bg-canvas-hover`
- Actions column: icon `DropdownMenu`, not button stacks

## Dialog / Sheet / Menu

Default shadcn on canvas; destructive confirm in Dialog only.
