# Interaction design

## Principles

1. **Act where you are** — change properties without leaving the list when possible.
2. **Same verbs everywhere** — status/assignee/priority actions identical from row, peek, page, bulk bar, context menu, palette.
3. **Highlight ≠ select** — keyboard focus/highlight enables action; explicit selection enables multi-act.
4. **Overlays are rented attention** — dismissible, trapped focus, Esc-consistent.
5. **Preview before commit to navigation** — peek/quicklook patterns for triage.

## Tables & lists

- Rows are the atomic interactive unit.
- Columns ordered by: identity → title → critical state → people → time.
- Virtualize long lists; keep row height stable to avoid scroll jump.
- Hover reveals secondary affordances (checkbox, drag) without shifting layout.
- Empty states explain the next action, not a witty dead-end.

## Boards & timelines

- Boards: columns = primary workflow state; drag is sugar over the same state mutation as keyboard.
- Timelines: denser; prioritize legibility of dates and ownership over ornamental swimlanes.
- Display options (grouping, ordering, layout) are view-level, keyboard-reachable, and saved with views.

## Forms

- Prefer **property editors** over multi-field forms for existing entities.
- Create flows: minimal required fields; defaults for the rest; expand on demand.
- Validate inline; don’t clear user input on error.
- Autofocus the primary field; Enter submits where safe; Cmd/Ctrl-Enter for create-and-continue patterns.

## Drawers, dialogs, sheets

| Pattern | Use when | Avoid when |
| --- | --- | --- |
| **Peek / quicklook** | Scanning details while keeping list position | Deep editing sessions |
| **Split view** | Review queues (inbox, triage, support) | Tiny viewports without collapse strategy |
| **Slide-over / drawer** | Medium edit keeping page context | Tasks needing full canvas |
| **Modal dialog** | Destructive confirm, rare multi-step, blocking choice | Routine property edits |
| **Sheet (mobile)** | Same as drawer on small screens | Desktop-dense workflows |

## Quick actions & context menus

- Right-click / long-press shows **contextual** actions for the target + selection.
- Always mirror accelerators in the menu.
- Group: open · mutate fields · copy/share · destructive.
- Never hide the only path to a critical action exclusively in a context menu—pointer users need a visible path too.

## Hover interactions

- Hover may reveal, highlight, or preview—never be the **only** way to discover an essential action.
- Tooltips for truncated text and shortcut hints.
- Delay tooltips slightly to avoid noise; show shortcut tooltips faster for icon-only controls.

## Selection model

| Mode | How | Purpose |
| --- | --- | --- |
| Highlight | Hover or ↑/↓ / j/k | Single-item keyboard actions |
| Select | `x`, shift-click, checkbox | Multi-item membership |
| Range select | Shift+move | Contiguous bulk |
| Select all | Cmd/Ctrl-A on filtered set | Operate on working set |
| Clear | Esc | Exit multi mode |

Bulk bar appears on selection with the **same field mutations** as single-item shortcuts.

## Keyboard navigation

- Global **goto chords** for destinations (two-key sequences with a short timeout).
- **Mnemonic single keys** for field edits when a row is highlighted and focus is not in an input.
- **Modifiers** for global concerns (palette, shortcuts sheet, find-in-view).
- Shortcut cheat sheet in-app (`?` and/or Cmd/Ctrl-/).
- Do **not** steal keys while focus is in text inputs, contenteditable, or selects.
- Sequential shortcuts need visible or audible failure modes only if chords are ambiguous—prefer forgiving timeouts.
- Skip links / landmarks for assistive tech; roving tabindex or `aria-activedescendant` for lists.

## Focus management

- Opening overlay → focus primary input or first actionable item.
- Closing overlay → restore previously focused element.
- Route changes → focus main landmark or view title, not random chrome.
- Focus rings must be visible; never `outline: none` without a replacement.

## Inline & contextual editing

- Click label/value → editor in place.
- Esc cancels; Enter commits (for single-line); blur commits if changes are safe/optimistic.
- Rich text: explicit save or debounced autosave with clear dirty/saved state—avoid ambiguous dual modes.

## Command execution

- Commands are data: `{ id, title, shortcut?, keywords, canExecute, run }`.
- Palette, menus, and shortcuts all bind to the same registry.
- Disable with reason when `canExecute` is false; don’t silently no-op.

## Optimistic updates

- Apply local mutation immediately for reversible changes.
- Queue sync; surface offline quietly.
- On rejection: rollback, toast with undo/retry when possible.
- Destructive actions: confirm first **or** soft-delete with undo window—pick one and be consistent.

## Progressive disclosure patterns

- **Peek**: space to toggle; hold-space for temporary; arrows move peek target.
- **Expand row / nested**: for short subordinate lists only.
- **“More properties”**: collapse rare fields on create.
