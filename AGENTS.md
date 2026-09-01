# Attendance Log Project Rules

## Project purpose

Attendance Log is a lightweight, mobile-first attendance application for a navigation school.

## Architecture

- Node.js and Express provide the HTTP application.
- PostgreSQL is the only persistent application data store.
- The user interface uses vanilla HTML, CSS, and JavaScript.
- The application is packaged with Docker for Amazon Lightsail Container Service.
- Lightsail terminates production HTTPS; the container listens on plain HTTP internally.
- The container filesystem is ephemeral and must never hold persistent application data.

## V1 functional scope

### Authentication

- Provide one generic administrator account.
- Do not provide public registration.
- Federated authentication may be considered later but is outside V1.

### Students

- Support manual creation, editing, and deletion.
- Students have an `active` status.
- Normal student deletion in V1 means deactivation (`active = false`) so historical references can be preserved.
- Inactive students must not appear in normal active student, class, or attendance workflows.
- Do not implement hard-delete behavior unless explicitly requested later.
- Support CSV import.
- Use email as the functional unique key for matching students during imports.
- Allow one student to belong to multiple classes.
- Re-importing the same email must reuse the existing student and QR code.
- Assign each student a randomly generated, unique `student_code` that is exactly seven uppercase alphanumeric characters.
- Exclude the visually ambiguous characters `0`, `O`, `1`, and `I`.
- Store only this `student_code` directly in the QR code; never embed personal data.

### Classes

- A class has a name and description.
- Students may belong to multiple classes.

### Course sessions

- Associate each course session with a class.
- Store its date, title, instructor, and optional notes.

### Attendance workflow

- A session can be open or closed.
- While a session is open, unscanned students are pending.
- Scanning a student's QR code marks that student present.
- Attendance must also be manually correctable.
- Closing a session converts all remaining `pending` students to `absent`.
- A closed session can be reopened.
- Reopening does not reset attendance statuses: students marked `present` remain `present`, and students automatically or manually marked `absent` remain `absent`.
- Reopening simply allows the administrator to scan or manually correct attendance again.
- The session may then be closed again.
- Show `present count / total students`.
- While open, the count reflects the current state; while closed, it shows the final count.

### QR handling

- An administrator must be able to display a student's QR code.
- The QR image must be easy to download or share manually through apps such as WhatsApp or email.
- Do not integrate WhatsApp or email sending in V1.

### Exports

- When a session is closed, provide a downloadable `.xlsx` attendance export.
- Do not integrate Google Drive or OneDrive in V1.
- Do not build a statistics dashboard in V1.

## UI requirements

- Design mobile-first because Attendance Log is primarily operated from a smartphone during live attendance taking.
- Design and review phone-width layouts first; treat desktop as a responsive enhancement rather than the primary target.
- No workflow may require desktop-only interaction.
- Keep workflows short and clear, with primary actions reachable without excessive navigation.
- Use comfortable touch targets.
- Avoid horizontal scrolling and dense information on small screens when a simpler mobile layout is possible.
- Optimize camera and scanner workflows for phone screens and one-handed use where practical.
- Keep information density concise while retaining the details needed for the current task.
- Desktop support remains required as a responsive enhancement, but mobile usability takes priority.

## UI and design skills

For user-facing UI work, consult the relevant installed project skills under `.agents/skills/` when applicable:

- `frontend-design`: use for layout, visual hierarchy, component appearance, responsive mobile-first presentation, and avoiding generic or low-quality generated UI.
- `web-design-guidelines`: use for usability, accessibility, responsive behavior, forms, navigation, touch interaction, semantic HTML, and general web-interface quality.
- `dashboard-design-system`: use when building or refining recurring application patterns such as navigation, cards, forms, status indicators, buttons, lists, and administrative screens so the interface remains visually consistent.
- `dashboard-product-design-standard`: use for information architecture, workflow clarity, administrative UX, prioritizing primary and secondary actions, and keeping each screen focused on the user's task.

Apply these skills with the following precedence:

1. Requirements and validated product decisions in `AGENTS.md` take priority over skill guidance.
2. Explicit user instructions take priority over generic skill recommendations.
3. Apply skills proportionally to the task.
4. Do not introduce React, Vue, Tailwind, component libraries, build tooling, or other dependencies merely because a skill uses or recommends them.
5. Translate applicable design principles into the existing vanilla HTML, CSS, and JavaScript architecture.
6. Do not perform unrelated visual redesigns while implementing a targeted feature.

## Development rules

- Use the simplest solution that works and avoid unnecessary abstractions.
- Do not add a frontend framework.
- Do not add an ORM unless it is explicitly approved later.
- Do not perform unrelated refactoring.
- Use English for code, comments, variable names, commit messages, and technical documentation.
- Use French for user-facing UI.
- Supply secrets only through environment variables; never commit real credentials.
- Treat PostgreSQL as persistent and every application container filesystem as disposable.
- Validate changes before considering them complete.
- Do not create Git commits automatically.
