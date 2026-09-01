# Do / Don’t (dashboard)

## Do

- Apply only on dashboard/admin routes
- Cool neutral canvas (`#fafafa` family)
- Compact nav: **icon + label** (13px), `h-8` rows
- Page title `text-lg` / `text-xl`, one optional description line
- Table-first pages; actions in `DropdownMenu`
- shadcn for every control
- Quiet active states (`bg-canvas-hover`)

## Don’t

| Don’t | Why |
| --- | --- |
| Warm cream + terracotta/orange brochure theme | Reads as marketing, not tool |
| Nav subtitles under every item | Kills hierarchy |
| 30–36px page titles + long blurbs | Marketing header |
| Card-wrapping the primary table | Toy chrome |
| Always-on red Delete buttons per row | Noise |
| Uppercase mono labels everywhere | Shouty |
| Accent-colored primary buttons / thick active rails | Wrong signal |
| Marketing heroes in admin | Wrong surface |
| Raw hex in components | Drift |

## Visual test

Squint test: you should see **sidebar destinations** and a **dense data surface**
first — not a large title block and a padded card.
