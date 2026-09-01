# Product decisions

Use this template for every significant pattern:

```
### Decision
What we chose.

### Rationale
Why, tied to a user problem.

### Advantages
What improves.

### Disadvantages
What we give up.

### Trade-offs
The explicit exchange.

### Use when
Conditions that favor this choice.

### Avoid when
Conditions that forbid or weaken it.

### Generalization
How it applies beyond this product.
```

---

## Catalog of durable decisions

### 1. Opinionated atomic model, flexible org model

**Decision:** Fix the meaning of core objects and fields; allow teams to shape higher-level structure.

**Rationale:** Chaos emerges when every team reinvents status, priority, and ownership. Orgs still differ in team topology.

**Advantages:** Shared language; faster onboarding; consistent automation; coherent UI.

**Disadvantages:** Some enterprises can’t map exotic processes without adaptation.

**Trade-offs:** Expressive range vs coherence.

**Use when:** Multi-team product work with recurring workflows.

**Avoid when:** The product’s job is literally to be a fully programmable database UI.

**Generalization:** Opinions belong at the frequency of daily interaction; flexibility belongs at the frequency of org redesign.

---

### 2. Defaults over configuration

**Decision:** Ship strong defaults; hide advanced settings.

**Rationale:** Users shouldn’t maintain the tool.

**Advantages:** Time-to-value; fewer support modes; less QA matrix.

**Disadvantages:** Power users may feel constrained until escape hatches exist.

**Trade-offs:** Immediate clarity vs eventual niche fit.

**Use when:** 80% of customers share a workflow.

**Avoid when:** Regulatory or industry variance makes one default harmful.

**Generalization:** Configuration is apology for missing opinion—or a deliberate enterprise layer added late.

---

### 3. Speed as a product requirement

**Decision:** Treat interaction latency as a user-facing feature with budgets.

**Rationale:** Daily tools accumulate fatigue from small waits.

**Advantages:** Flow state; emotional quality; differentiation.

**Disadvantages:** Engineering investment; harder offline/conflict cases.

**Trade-offs:** System complexity vs perceived simplicity.

**Use when:** Users perform dozens/hundreds of actions per day.

**Avoid when:** Actions are rare and heavy (e.g. overnight batch). Still optimize feedback, but budgets differ.

**Generalization:** Any high-frequency interface should invert “wait for server” to “sync later.”

---

### 4. Keyboard-first, pointer-complete

**Decision:** Design keyboard paths first; ensure mouse/touch completeness.

**Rationale:** Experts need velocity; beginners need affordances.

**Advantages:** Mastery curve; accessibility synergy; command unification.

**Disadvantages:** Shortcut conflict management; teaching cost.

**Trade-offs:** Learning investment vs long-term speed.

**Use when:** Professional tools, dense UIs, desktop-class usage.

**Avoid when:** Purely casual mobile-first consumer apps (still support a11y keys).

**Generalization:** Progressive skill: discover in UI → palette → direct shortcut.

---

### 5. Command palette as universal index

**Decision:** One searchable overlay for navigation, entities, and actions.

**Rationale:** Hierarchical nav doesn’t scale to expert vocabularies.

**Advantages:** Discoverability; reduced hunting; teaches shortcuts.

**Disadvantages:** Can become a junk drawer without ranking/UX discipline.

**Trade-offs:** Global power vs curated simplicity.

**Use when:** Action/entity count exceeds what menus can sanely hold.

**Avoid when:** App has <10 actions and shallow structure—palette may be overkill (search may still help).

**Generalization:** Any large object graph needs a fuzzy index with execution, not just retrieval.

---

### 6. Separate triage from active work

**Decision:** Inbound/unreviewed items land in a dedicated inbox, not the active backlog.

**Rationale:** Protect focus; prevent priority pollution.

**Advantages:** Cleaner planning; clearer ownership of intake; reduced Zeigarnik noise.

**Disadvantages:** Extra step before work is “real.”

**Trade-offs:** Friction at intake vs calm at execution.

**Use when:** Multiple sources create work (customers, integrations, other teams).

**Avoid when:** Solo users with tiny volume—intake can equal backlog.

**Generalization:** Buffers beat infinite backlogs for human attention systems.

---

### 7. Cadence objects (cycles) over eternal backlogs

**Decision:** Timebox execution; auto-roll unfinished work; keep backlogs intentionally small.

**Rationale:** Open loops tax cognition; stale lists pretend to be plans.

**Advantages:** Momentum; realistic scope; healthier planning.

**Disadvantages:** Poor fit for interrupt-driven ops without adaptation.

**Trade-offs:** Ritual overhead vs focus.

**Use when:** Builders plan in weeks.

**Avoid when:** Work is pure continuous queue (support tickets)—use SLAs instead of cycles.

**Generalization:** Pair “what we’re doing now” with an explicit time boundary.

---

### 8. Inspect without leaving (peek / split)

**Decision:** Provide preview and split-review before full navigation.

**Rationale:** Context switching destroys triage speed.

**Advantages:** Faster review; less back-stack thrash.

**Disadvantages:** More layout states to design and test.

**Trade-offs:** Engineering surface vs operator speed.

**Use when:** High-volume review queues.

**Avoid when:** Every item requires deep multi-minute work—go straight to entity page.

**Generalization:** Email-client patterns belong in any review-heavy dashboard.

---

### 9. Inline property editing

**Decision:** Edit fields in place; reserve modals for rare/destructive flows.

**Rationale:** Modal tax breaks flow for high-frequency edits.

**Advantages:** Speed; fewer lines of chrome; consistency with bulk edits.

**Disadvantages:** Harder multi-field validation stories; discoverability of editability.

**Trade-offs:** Flow vs guided form completeness.

**Use when:** Properties are independent and reversible.

**Avoid when:** Legal forms, multi-step wizards, or tightly coupled fields needing atomic commit UI.

**Generalization:** Match interaction cost to change frequency.

---

### 10. Views as saved questions

**Decision:** Filters compose into durable, shareable views with owners.

**Rationale:** Teams re-ask the same questions; personal ad-hoc filters don’t scale collaboration.

**Advantages:** Shared truth; less duplicate hunting; notification hooks.

**Disadvantages:** View sprawl without ownership/hygiene.

**Trade-offs:** Flexibility vs navigation clutter (mitigate with favorites + owners).

**Use when:** Multiple stakeholders monitor slices of the same corpus.

**Avoid when:** Data is tiny or purely personal.

**Generalization:** Saved queries are first-class product objects, not browser bookmarks.

---

### 11. Optimistic UI with quiet sync

**Decision:** Paint success immediately; reconcile asynchronously.

**Rationale:** Network latency is not a UX metaphor users should feel.

**Advantages:** Native feel; offline resilience; habit formation.

**Disadvantages:** Conflict/edge-case complexity; harder mental model for “saved.”

**Trade-offs:** Consistency timing vs responsiveness.

**Use when:** Mutations are small and mostly conflict-free.

**Avoid when:** Money movement, inventory reservation, or strong consistency domains without careful design.

**Generalization:** Separate **interaction commit** from **authoritative commit**.

---

### 12. Density with progressive disclosure

**Decision:** Show identity + few critical fields in lists; reveal rest on peek/hover/page.

**Rationale:** Enterprise UIs fail by showing everything always.

**Advantages:** Scanability; calm; more rows per decision.

**Disadvantages:** Hidden data can frustrate analysts who want wide grids.

**Trade-offs:** Daily operator UX vs occasional power-analyst UX (offer display options).

**Use when:** Primary job is prioritize/act.

**Avoid when:** Primary job is spreadsheet analysis—offer a true table layout mode.

**Generalization:** Information diet by zoom level.

---

### 13. No plugin marketplace for core workflow

**Decision:** Implement essential workflows natively; integrate outward via APIs.

**Rationale:** Plugins fragment UX, security, and performance.

**Advantages:** Coherent product; controlled quality; simpler support.

**Disadvantages:** Slower niche coverage; some customers blocked.

**Trade-offs:** Platform extensibility vs product integrity.

**Use when:** Quality and coherence are the wedge.

**Avoid when:** Your strategic position is being an extension platform.

**Generalization:** First-class or out-of-band—avoid half-integrated appendages on the critical path.

---

### 14. Design system as acceleration, not ceremony

**Decision:** Thin tokens + shared components; no heavyweight design-ops theater.

**Rationale:** Systems exist to ship consistent UI faster.

**Advantages:** Speed; themeability; coherence.

**Disadvantages:** Risk of under-documentation as team scales.

**Trade-offs:** Lightweight process vs formal governance.

**Use when:** Small/medium product teams with high taste overlap.

**Avoid when:** Many autonomous squads ship disconnected surfaces without shared ownership—then strengthen governance.

**Generalization:** The best system is the one people actually reuse.

---

### 15. Coordinated visual resets

**Decision:** Periodically rebalance the whole shell when product scope expands.

**Rationale:** Incremental features create design debt invisible to module owners.

**Advantages:** Restored hierarchy; room for next product chapter; renewed quality signal.

**Disadvantages:** Short-term user adjustment; opportunity cost.

**Trade-offs:** Continuity vs coherence.

**Use when:** Chrome no longer fits the product’s next stage.

**Avoid when:** Change is cosmetic churn without hierarchy problems.

**Generalization:** Holistic experiences need holistic resets; code can be modular, perception cannot.

---

### 16. Automate maintenance work

**Decision:** Auto-close or snooze stale items; auto-roll unfinished cadence work; rotate intake ownership.

**Rationale:** Humans are bad archivists; tools should prevent list rot.

**Advantages:** Smaller backlogs; less fake work; psychological relief.

**Disadvantages:** Fear of losing something important (mitigate with search/history).

**Trade-offs:** Perfect memory vs actionable memory.

**Use when:** Volume exceeds what humans will groom.

**Avoid when:** Legal retention requires eternal active lists (then separate archive UX).

**Generalization:** Attention is the scarce resource—software should garbage-collect it.

---

### 17. Layered search beats one omnibox

**Decision:** Separate workspace search, find-in-view, recents, and command execution.

**Rationale:** Different jobs (retrieve vs narrow vs resume vs act) need different ranking and scope.

**Advantages:** Faster resume; less false relevance; clearer mental model.

**Disadvantages:** More concepts to teach (mitigate with consistent shortcuts and palette).

**Trade-offs:** Slight learning cost vs precision.

**Use when:** Corpus is large and users both browse and command.

**Avoid when:** Tiny personal apps with <50 entities.

**Generalization:** Match retrieval UX to intent, not to a single search API.

---

### 18. Changelog as a product surface

**Decision:** Publish a steady, curated stream of user-visible changes with visuals; authors who ship write the note.

**Rationale:** Cadence communicates velocity and care; raw ticket dumps do neither.

**Advantages:** Trust, recruitment, retention, internal alignment.

**Disadvantages:** Writing time; discipline when weeks are “infra only.”

**Trade-offs:** Marketing polish vs engineering silence—prefer honest user-facing framing (including performance/feel wins).

**Use when:** You ship continuously to external users.

**Avoid when:** Strict stealth with no external audience (still keep an internal ship log).

**Generalization:** Quality culture is visible in how you narrate change, not only in pixels.

---

### 19. Asymmetric, origin-based motion

**Decision:** Instant or near-instant appearance; slightly longer dismiss; motion from the control; no list-nav animation.

**Rationale:** Users punish enter-delay more than exit-delay; spatial continuity teaches structure.

**Advantages:** Snappy feel without sterility; fewer vestibular issues if reduced-motion respected.

**Disadvantages:** Requires discipline against “delight” bloat.

**Trade-offs:** Expression vs speed.

**Use when:** High-frequency professional UIs.

**Avoid when:** Narrative/marketing storytelling where longer choreography is the point.

**Generalization:** Motion is pedagogy and confirmation, not entertainment, in tools.

---

## Anti-catalog (refuse by default)

- Settings that recreate the data model (“build your own tracker”)
- Modal forms for single field edits
- Spinners for local toggles
- Hover-only essential actions
- Duplicate concepts with synonyms (task vs issue vs ticket vs story without need)
- Card grids that reduce scan speed for textual work records
- Decorative dashboards that don’t answer an operational question
- Keyboard traps without Esc/restore focus
- Custom fields used to bypass missing first-class concepts (prefer model evolution)
