# Narration Console Ritual Controls Design

## Purpose

Whispbook already looks like a fantasy writing desk. This pass makes the right-side render controls speak the same language. The current controls still read like a technical settings form because they expose native-looking selects, ordinary sliders, visible advanced fields, and labels such as `CFG`, `Temperature`, and `Prompt Prefix`.

The goal is a calmer "book, ritual, narration console" experience without changing the underlying generation behavior.

## Scope

This design covers the React workbench in `src/App.tsx` and the fantasy desk styling in `src/writer-desk.css`.

In scope:

- Replace plain scrollbars in the book, render, and paragraph scroll areas with a themed bookmark or rail treatment.
- Restyle range controls as brass rune controls while keeping native range input semantics.
- Restyle selects as parchment tabs while keeping native select behavior.
- Rename technical UI labels into user-facing narration language.
- Collapse technical model, timing, prompt, and custom JSON controls into closed-by-default advanced drawers.
- Add stronger section dividers and more spacing in the render console.
- Reorder the render-control CSS so the most important styles are near the top of the stylesheet instead of buried near the bottom.

Out of scope:

- Changing backend TTS parameters, API payloads, storage, import behavior, or generation scripts.
- Building fully custom select/listbox or slider primitives.
- Replacing the existing desk assets or overall visual direction.

## Recommended Approach

Use themed semantic controls. Native `select`, `input[type="range"]`, `details`, and form labels stay in place for accessibility, keyboard behavior, and low implementation risk, but their wrappers and CSS make them feel like parchment tabs, brass rails, and ritual drawers.

This gives most of the visual transformation without taking on the accessibility and bug risk of fully custom widgets.

## Interaction Model

The render panel becomes a narration console with five readable zones:

1. **Spellbook**: saved custom narration styles and import controls.
2. **Narrator**: everyday choices for narration source, voice, and language.
3. **Ritual Runes**: closed-by-default advanced generation controls.
4. **Binding**: preview, export script, and audiobook generation actions.
5. **Downloads / Progress**: active generation state and finished files.

The first viewport should show Spellbook, Narrator, and Binding without making the user wade through every technical knob. Users who want fine control can open Ritual Runes.

## Label Language

Use narration-first labels while preserving accessible associations:

- `Voice` becomes `Narrator`.
- `Engine` becomes `Narration source`.
- `Saved style` becomes `Saved spellbook voice`.
- `Manual current settings` becomes `Current ritual`.
- `Import Style File` becomes `Import voice charm`.
- `Prompt Prefix` becomes `Opening incantation`.
- `Speed` becomes `Reading pace`.
- `Paragraph Pause` becomes `Chapter breath`.
- `Comma Pause` becomes `Comma hush`.
- `Expression` becomes `Dramatic color`.
- `CFG` becomes `Narrator discipline`.
- `Temperature` becomes `Creative spark`.
- `Top P` becomes `Focus circle`.
- `Output` becomes `Binding`.
- `Preview` becomes `Hear a passage`.
- `Export Script` becomes `Copy ritual script`.
- `Generate Audiobook` becomes `Bind the audiobook`.
- `Generation` becomes `Binding progress`.
- `Advanced style params` becomes `Deeper voice runes`.
- `Params JSON` becomes `Rune ledger`.
- `Start at` becomes `Begin charm at`.
- `Save Style` becomes `Save voice charm`.

Aria labels and titles should use the same user-facing language unless a clearer screen-reader phrase is needed.

## Component Changes

### Render Panel Structure

`src/App.tsx` should reorder the render panel so custom style controls appear above narrator controls. The custom style section should stay compact by default:

- Existing saved custom styles remain visible when present.
- Import button remains visible.
- JSON/reference-audio tuning moves under `Deeper voice runes`, closed by default after an import or name entry.

The main technical range controls move from always-visible `Timing` into a `Ritual Runes` details block. This block includes engine-specific range controls and any engine-specific prompt/incantation field.

### Range Controls

`RangeControl` remains a native range input wrapped in themed markup. The component should expose:

- A narrative label.
- A visible value badge.
- A CSS custom property for current progress, if useful for a filled rail.

The range input remains keyboard accessible and tied to its label.

### Select Controls

Selects remain native selects. CSS should set `appearance: none`, add parchment/brass styling, reserve space for a decorative chevron, and use a wrapper where needed so the control reads as a tab rather than a default browser field.

### Advanced Drawers

Use `details`/`summary` for collapsed areas:

- `Ritual Runes` is closed by default.
- `Deeper voice runes` is closed by default, even when a custom reference file is loaded.
- Summary rows should look like parchment divider tabs, with an icon or marker that rotates/changes when open.

## Styling Changes

The existing theme remains: parchment, brass, leather, plum, and desk textures.

Add or revise styles for:

- `.ritual-section` or equivalent section class with stronger top/bottom dividers.
- `.parchment-select` or equivalent select treatment.
- `.rune-range` or equivalent range treatment.
- `.settings-scroll` bookmark/rail scrollbars.
- Themed `details` summaries.

Avoid adding decorative orbs, gradients unrelated to the current materials, or a second color palette.

The render-control CSS that currently sits near the lower portion of `writer-desk.css` should be moved closer to the top-level control styles, before the manuscript-specific blocks. Media query overrides can remain in the responsive sections.

## Data Flow

No data contract changes are required.

All existing `styleDraft` updates, capability normalization, custom style creation, preview creation, script export, and generation calls continue to use the same field names and values. Only labels, grouping, order, and visual styling change.

## Accessibility

- Keep native form controls for keyboard and screen-reader support.
- Keep visible labels associated with controls.
- Preserve focus-visible outlines, with theme-aware colors.
- Ensure collapsed drawers are reachable by keyboard.
- Ensure select text, button text, and value badges fit on narrow viewports.
- Do not hide advanced controls from assistive technology when drawers are open.

## Testing

Update React tests that locate controls by old label text. The tests should verify:

- The narrator source, narrator voice, and opening incantation controls still update `styleDraft`.
- Stored voice configuration still restores with the renamed labels.
- The advanced rune drawers render collapsed by default.
- Saving a custom voice charm still passes the selected reference start point.

Run:

```bash
npm test
npm run build
```

For rendered verification, start the Vite dev server and use Playwright because the Browser plugin is not available in this session. The target flow is:

`app loads -> render console is opened -> themed narrator controls, collapsed rune drawers, parchment selects, brass range controls, and bookmark rails render without console errors.`

Check desktop and one mobile viewport.

## Risks

- Native select styling differs slightly by browser. The design accepts this as long as the field reads as parchment-themed and remains usable.
- Moving technical controls into a collapsed drawer may hide useful tuning from power users. The summary label should be clear enough that advanced users know where to look.
- Reordering CSS can accidentally change cascade behavior. Keep the move mechanical and verify with build plus browser screenshots.
