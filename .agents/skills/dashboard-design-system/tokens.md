# Tokens (dashboard only)

Cool, neutral, dense product surface — not warm brochure cream, not marketing paper.

Copy into the dashboard app’s `globals.css` and expose via `@theme inline`.

## Color

```css
:root {
  --canvas: #fafafa;
  --canvas-hover: #f4f4f5;
  --sidebar: #fafafa;
  --ink: #18181b;
  --ink-2: #52525b;
  --ink-3: #a1a1aa;
  --hairline: #e4e4e7;
  --accent: #3f3f46; /* quiet signal; active nav uses hover fill, not loud chrome */
  --accent-text: #27272a;
  --ok: #16a34a;
  --err: #dc2626;
  --radius: 0.5rem;
  color-scheme: light;
}
```

### Semantic roles

| Role | Token | Use |
| --- | --- | --- |
| Base background | `canvas` | App + main |
| Sidebar | `sidebar` | Same family as canvas (optional slight shift later) |
| Hover / muted | `canvas-hover` | Active nav, row hover |
| Primary text | `ink` | Body, titles, primary button |
| Secondary text | `ink-2` | Idle nav, descriptions |
| Tertiary / meta | `ink-3` | Group labels, slugs, placeholders |
| Border | `hairline` | Sidebar edge, table rules |
| Focus ring | `accent` | Focus only — **not** thick orange nav rails |
| Success | `ok` | Live/healthy |
| Danger | `err` | Errors / destructive |

### Rules

- No raw hex in components.
- No second gray scale.
- Primary **buttons = ink fill**, not accent fill.
- Active nav = `bg-canvas-hover`, not a bright accent bar.
- Status color never alone — pair with text.

## Tailwind `@theme` bridge

```css
@theme inline {
  --color-canvas: var(--canvas);
  --color-canvas-hover: var(--canvas-hover);
  --color-sidebar: var(--sidebar);
  --color-ink: var(--ink);
  --color-ink-2: var(--ink-2);
  --color-ink-3: var(--ink-3);
  --color-hairline: var(--hairline);
  --color-accent: var(--accent);
  --color-accent-text: var(--accent-text);
  --color-ok: var(--ok);
  --color-err: var(--err);

  --color-background: var(--canvas);
  --color-foreground: var(--ink);
  --color-card: var(--canvas);
  --color-card-foreground: var(--ink);
  --color-popover: var(--canvas);
  --color-popover-foreground: var(--ink);
  --color-primary: var(--ink);
  --color-primary-foreground: var(--canvas);
  --color-secondary: var(--canvas-hover);
  --color-secondary-foreground: var(--ink);
  --color-muted: var(--canvas-hover);
  --color-muted-foreground: var(--ink-2);
  --color-destructive: var(--err);
  --color-border: var(--hairline);
  --color-input: var(--hairline);
  --color-ring: var(--accent);

  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 10px;

  --ease-out: cubic-bezier(0.2, 0, 0, 1);
  --duration-micro: 120ms;
  --duration-standard: 200ms;
}
```

## Spacing (dense)

4px base: `2, 4, 8, 12, 16, 24, 32`.

| Use | Value |
| --- | --- |
| Nav row | `h-8`, `px-2`, `gap-2` |
| Page padding | `px-4 py-4` → `sm:px-6` |
| Header → content | `mb-3` / `gap-3` |
| Table cell | `py-2` |
| Section stack | `gap-3` or `gap-4` — not `space-y-6` by default |

## Radius

| Token | Value | Use |
| --- | --- | --- |
| sm | 6px | Inputs |
| md | 8px | Buttons, nav items |
| lg | 10px | Dialogs/sheets |

No pill buttons for primary actions.

## Elevation

Flat: borders only. Overlays use default shadcn shadow. No card glow.

## Motion

Micro 120ms, standard 200ms, ease `cubic-bezier(0.2, 0, 0, 1)`.  
Opacity/transform only. Honor `prefers-reduced-motion`.

## Focus

```css
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```
