# Typography (dashboard only)

## Families

| Role | Stack | Where |
| --- | --- | --- |
| Sans | Geist Sans → system ui-sans | Almost all UI |
| Mono | Geist Mono → ui-monospace | IDs, slugs, timestamps, code, pure numbers |
| Serif | — | **Never** in dashboard |

## Locked roles

| Role | Spec | Use |
| --- | --- | --- |
| Page title | `text-lg sm:text-xl font-semibold tracking-tight text-ink` | Page H1 — **not** 30–36px |
| Section title | `text-sm font-medium text-ink` | Panel headers |
| Body | `text-[13px] leading-5 text-ink` | Primary UI copy |
| Body muted | `text-[13px] leading-5 text-ink-2` | Optional one-line description |
| Nav label | `text-[13px] font-medium` | Sidebar |
| Group label | `text-[11px] font-medium text-ink-3` | Nav groups |
| Table head | `text-xs font-medium text-ink-3` | Columns |
| Table cell | `text-[13px] text-ink` | Data |
| Meta / slug | `text-xs text-ink-3` | Secondary line under title |
| Stat value | `text-xl font-semibold tabular-nums` | Overview metrics |
| Helper / error | `text-xs text-ink-3` / `text-err` | Forms |

## Rules

- **Sans by default.** Mono is the exception (IDs, numbers that must align).
- No uppercase + wide tracking as a global style (kickers, buttons, table heads).
- Prefer weight + color for hierarchy; keep sizes few.
- Truncate with `Tooltip` for overflow.
- Never use display/marketing sizes in admin.
