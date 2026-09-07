---
name: print-layout
description: Design, implement, and review print-ready PDF layouts for labels, badges, QR sheets, Avery A4 templates, calibration sheets, and other fixed-geometry printed output.
---

# Print Layout

Use this skill for work involving:
- PDF generation intended for physical printing
- Avery or equivalent label sheets
- badges, cards, inserts, tickets, QR sheets
- fixed-size A4 layouts
- physical dimensions in mm
- printer calibration and alignment

## Core rules

1. Treat physical geometry as authoritative.

Do not approximate print layouts with browser CSS sizing.

Use exact:
- page size
- margins
- label width/height
- horizontal pitch/gap
- vertical pitch/gap
- rows
- columns

For A4, use exact physical dimensions:
- 210 mm × 297 mm

2. Profiles must be verified.

Do not invent Avery dimensions.

Every built-in Avery profile must be based on a verified manufacturer specification or template.

Keep profile geometry centralized in one catalog.

Do not duplicate dimensions across PDF code, UI code, or tests.

3. Keep data and layout separate.

The print engine should receive:
- selected template/profile
- ordered printable records
- starting label position
- content options

Do not make business logic depend on print geometry.

4. Generate deterministic PDF output.

Given the same:
- profile
- records
- starting position
- options

the generated PDF geometry must be identical.

Avoid printer- or browser-dependent layout behavior.

5. QR codes

Reuse the application's existing QR-generation logic.

Do not create a second QR-token or QR-payload implementation.

Preserve:
- quiet zone
- square aspect ratio
- sufficient physical size
- high contrast

Do not stretch, crop, or distort QR codes.

Prefer vector QR output where the chosen PDF library supports it reliably; otherwise use sufficiently high-resolution raster output.

6. Attendance Log label composition

For rectangular labels/badges, the default Attendance Log layout is:

- narrow participant-code area on the far left
- participant code rendered as one string rotated 90 degrees
- large square QR immediately to its right
- participant information in the remaining area on the right

Do not repeat the participant code in the information area.

The participant name is the primary text.

Optional secondary content may include the activity name when explicitly enabled.

7. Typography

Prioritize readability at actual printed size.

Do not rely on screen appearance alone.

Avoid text that becomes unreadable below practical print sizes.

Long names must be handled predictably:
- wrap
- shrink within a bounded range
- or truncate only when unavoidable

Do not allow text to overlap QR codes or neighboring labels.

8. Starting position

Support partially-used sheets.

The user may specify the first available label position.

Blank preceding positions must remain physically empty in the PDF.

Use a clear, human-readable 1-based position in the UI.

9. Calibration

Provide a calibration/test-sheet mode.

Calibration output should:
- use the exact selected profile geometry
- show label boundaries and/or alignment marks
- avoid QR/business data where unnecessary
- allow printing on plain A4 paper before consuming label stock

10. Print instructions

Generated output is designed for:
- A4
- 100% scale / Actual Size
- no Fit to Page
- no browser margin adjustment

Do not rely on PDF viewer scaling.

11. Security/privacy

QR/label PDFs may contain personal data.

Apply appropriate:
- authentication
- authorization
- no-store/private download headers

Do not expose QR tokens in logs.

Do not put internal numeric IDs, secrets, passwords, authentication tokens, or encryption keys into the PDF.

12. PDF filenames

Use safe predictable filenames.

Do not interpolate uncontrolled raw user text into Content-Disposition filenames.

13. Avery catalog

Keep Avery templates declarative.

A template should contain only profile metadata and geometry such as:
- manufacturer
- reference
- category
- page width/height
- label width/height
- rows/columns
- margins
- horizontal/vertical pitch or gap

The PDF renderer must not contain Avery-reference-specific branches unless a genuinely unique layout requires one.

14. Custom formats

Do not add a generic custom-template editor unless explicitly requested.

Prefer a small verified catalog first.

15. Validation

For every new template:
- verify rows × columns against manufacturer specification
- verify label dimensions
- verify margins/pitch
- generate a real PDF
- inspect page size
- inspect label coordinates
- verify first and last label bounds
- verify no element crosses its label box
- verify partially-used-sheet starting positions
- verify calibration output

For QR layouts:
- verify QR remains square
- verify adequate quiet zone
- verify rotated code remains inside bounds
- verify representative short/long participant names

16. Review expectations

When reviewing print-layout work, actively look for:
- mm/pt conversion mistakes
- cumulative pitch errors across rows/columns
- incorrect margins
- off-by-one label positions
- printer scaling assumptions
- clipping
- overflow
- QR distortion
- text collision
- template-specific hardcoding
- mismatch between documented and implemented Avery geometry

Do not approve a print profile solely because the PDF looks visually plausible on screen.