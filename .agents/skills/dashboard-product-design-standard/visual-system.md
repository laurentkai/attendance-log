# Visual system (dashboard)

Foundations: `dashboard-design-system` ([tokens](../dashboard-design-system/tokens.md),
[typography](../dashboard-design-system/typography.md),
[shadcn](../dashboard-design-system/shadcn.md)).

## Density target

| Region | Target |
| --- | --- |
| Sidebar width | ~240px (`15rem`) |
| Nav row | 32px (`h-8`) |
| Page padding | 16–24px |
| Page title | 18–20px semibold |
| Table row | ~40px |
| Header → table | 12–16px gap |

If the page looks “airy” or brochure-like, tighten until the table dominates the viewport.

## Shell silhouette

```
┌─ ~240px ──────┬─ main ──────────────────────────────────┐
│ Krekib Admin  │ Product types              [New type]   │
│               │ optional one-line description           │
│ Monitor       │─────────────────────────────────────────│
│  ○ Inbox      │ Type              Coverage    Status  ⋯ │
│  ○ Workflows  │ Accent Table…     home/…      ● active  │
│ Catalog       │ Air Fryer         home/…      ● …       │
│  ● Types      │ …                                        │
│ Distribution  │                                          │
│  ○ Channels   │  ← table flush, not inside a big card    │
│ ───────────── │                                          │
│ user · out    │                                          │
└───────────────┴──────────────────────────────────────────┘
```

Nav = icon + label only. Active = quiet fill. No description stack.

## Hierarchy

1. **Primary job** of the page is the table/list (most pixels).
2. **Chrome** (nav, header) is quiet and compact.
3. **One** primary button in the header.
4. Row actions hidden in `⋯` until needed.

Element specs: [components.md](components.md).
