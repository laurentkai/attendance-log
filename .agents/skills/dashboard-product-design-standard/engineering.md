# Engineering philosophy

Quality of feel is an engineering property, not a coat of paint.

## Architecture for responsiveness

- Treat the **client store as the UI’s source of truth**; the server is a sync/authority target.
- Mutate local state first; persist/sync asynchronously.
- Use granular subscriptions so a field change re-renders a cell, not an entire page.
- Lazy-hydrate large graphs: load shells first, fill details on access.
- Virtualize large collections; paginate or window where hydration cost is high.

If a full local-first sync engine is out of scope, approximate with: cached queries + optimistic mutations + background revalidation. The UX contract stays the same: **don’t wait on the network to paint the result of a user gesture.**

## Optimistic UI

- Default for reversible field updates.
- Idempotent mutations; durable offline queue when possible.
- Conflict policy: last-writer-wins is acceptable for many field edits; escalate to merge UI for collaborative documents.
- Always design the failure path (toast, rollback, retry).

## Rendering & loading

- Prefer showing **last-known good data** over skeletons for revisit paths.
- Skeletons only for first paint of unknown structure.
- Spinners are a last resort for truly blocking operations.
- Route-level code splitting; preload likely next chunks after idle.
- Assume modern baselines when it materially cuts weight; document supported browsers.

## Animations

- GPU-friendly; interruptible; short.
- Co-design with interaction—animation confirms cause and effect under 100ms when possible.
- No animation tax on keyboard repeat navigation.

## Accessibility

- Full keyboard operation for all workflows; publish an in-app shortcut map.
- Correct roles: listbox/option, menu/menuitem, dialog, toolbar.
- Manage `aria-activedescendant` or tabindex carefully in lists and palettes.
- Visible focus; sufficient contrast; support a **contrast parameter** / high-contrast theme path—not only a dark/light toggle.
- When using translucent materials, mirror OS “increase contrast” by adding solid outlines/edges.
- Don’t rely on color alone for status—pair with shape/text/icon.
- Announce asynchronous updates modestly (avoid assertive spam).
- Honor `prefers-reduced-motion` for non-essential motion.

## Design system governance

- **shadcn/ui is the primitive layer.** All interactive controls come from
  `@/components/ui/*`. Do not fork a second button/input/dialog system.
- Add missing primitives with `npx shadcn@latest add <name>` — do not paste
  simplified reimplementations.
- Map shadcn CSS variables to the locked tokens in [visual-system.md](visual-system.md)
  once in `globals.css`; pages never set one-off hex.
- Admin composites (`AdminShell`, `AdminCard`, …) live in `@/components/admin/*`
  and wrap shadcn. Specs: [components.md](components.md).
- Prefer **rewriting a one-off** over expanding API surface with speculative variants.
- If a new element is needed, add it to `components.md` in the same change —
  undocumented one-offs are defects.
- Document behavior of shell components (sidebar, headers, tabs) as explicitly as visuals.

## Consistency & maintainability

- Single **command registry** drives shortcuts, menus, and palette.
- Single **property editor** components reused in row, panel, and bulk.
- Feature flags for internal dogfood before gradual rollout.
- Ban duplicate visual patterns that mean the same thing.
- Ban parallel primitive libraries (raw HTML controls, Headless UI + shadcn mix,
  custom modal stacks). One primitive source: shadcn.

## Performance budgets (suggested)

| Interaction | Target |
| --- | --- |
| Local keypress feedback | < 50ms |
| Optimistic field update paint | < 100ms |
| Open command palette | < 100ms |
| Route change to interactive | < 300ms warm; measure cold separately |
| Scroll list | sustained 60fps |

Budgets are product requirements. Misses are defects.

## Long-term scalability

- Partition heavy data server-side; sync groups/partial indexes client-side.
- Avoid plugin architectures for core workflow—extend the model intentionally.
- Pay down UX debt in coordinated resets when hierarchy breaks; continuous tiny visual patches without rebalancing create dissonance.
- Keep the team’s taste sharp: hire for craft, ownership, clarity; dogfood daily.
