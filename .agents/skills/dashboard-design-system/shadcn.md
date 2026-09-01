# shadcn/ui (mandatory, dashboard)

All interactive dashboard primitives come from shadcn. Hand-rolled controls are
defects.

## Init

```bash
npx shadcn@latest init
```

`components.json` expectations:

- `rsc: true`, `tsx: true`
- `tailwind.css` → project `globals.css`
- `cssVariables: true`
- `baseColor: "neutral"`
- `iconLibrary: "lucide"`
- aliases: `@/components`, `@/components/ui`, `@/lib/utils`

Style: match the repo (`radix-nova` or `new-york`). Do not mix styles mid-project.

## CSS variable mapping

After tokens exist, map shadcn aliases in `:root`:

```css
:root {
  --background: var(--canvas);
  --foreground: var(--ink);
  --card: var(--canvas);
  --card-foreground: var(--ink);
  --popover: var(--canvas);
  --popover-foreground: var(--ink);
  --primary: var(--ink);
  --primary-foreground: var(--canvas);
  --secondary: var(--canvas-hover);
  --secondary-foreground: var(--ink);
  --muted: var(--canvas-hover);
  --muted-foreground: var(--ink-2);
  --destructive: var(--err);
  --border: var(--hairline);
  --input: var(--hairline);
  --ring: var(--accent);
  --sidebar: var(--canvas);
  --sidebar-foreground: var(--ink);
  --sidebar-primary: var(--ink);
  --sidebar-primary-foreground: var(--canvas);
  --sidebar-accent: var(--canvas-hover);
  --sidebar-accent-foreground: var(--ink);
  --sidebar-border: var(--hairline);
  --sidebar-ring: var(--accent);
}
```

Primary button = **ink on canvas**, not orange. Accent drives ring/focus only.

## Required primitives

Install as needed (do not reimplement):

```bash
npx shadcn@latest add button input textarea select checkbox switch label
npx shadcn@latest add dialog sheet dropdown-menu popover tooltip
npx shadcn@latest add table tabs badge separator scroll-area alert card
```

| Need | Component |
| --- | --- |
| Actions | `Button` |
| Text | `Input`, `Textarea` |
| Enums | `Select` |
| Boolean | `Checkbox`, `Switch` |
| Labels | `Label` |
| Modal | `Dialog` |
| Drawer / mobile nav | `Sheet` |
| Menus | `DropdownMenu` |
| Hints | `Tooltip` |
| Anchored panels | `Popover` |
| Tabs | `Tabs` |
| Data grids | `Table` |
| Chips / counts | `Badge` |
| Rules | `Separator` |
| Independent scroll | `ScrollArea` |
| Inline callouts | `Alert` |

## Button matrix

| Intent | `variant` | `size` |
| --- | --- | --- |
| Primary | `default` | `sm` in chrome |
| Secondary | `outline` | `sm` |
| Quiet / row menus | `ghost` | `sm` or `icon` |
| Danger | `destructive` | `sm` (prefer inside Dialog confirm) |
| Icon-only | `ghost` | `icon` + `aria-label` |

Labels: Title Case or sentence case — **not** uppercase tracked mono.

## Field styling

Prefer shared `className` on shadcn fields:

```
font-mono text-sm text-ink bg-canvas border-hairline rounded-md
focus-visible:border-ink focus-visible:ring-accent
placeholder:text-ink-3
```

## Governance

- Add missing pieces with the CLI — never paste a simplified fork.
- Theme changes happen in tokens, not by editing every component call site.
- Dashboard composites (`AdminShell`, etc.) wrap shadcn; they do not replace it.
- Ban parallel libraries (raw controls, Headless UI beside shadcn, custom modal stacks).
