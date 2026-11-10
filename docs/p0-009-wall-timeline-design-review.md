# Family wall timeline — design review draft

**Status:** proposed, not an implementation brief or Product acceptance. Product input: `PRODUCT.md` → Immediate wall follow-up. The immediate all-lists recovery is P0-009C r1; this design remains a separate bounded follow-up.

## Composition to review

One compact person header stays anchored. Everything below it is one independently scrollable timeline: quiet completed named lists above, one expanded current checklist, then named later lists. No duplicate pinned task/status stack and no Earlier / Coming up / More toolbar. A deliberate non-control header tap enlarges the same person's timeline; checkbox and disclosure controls have distinct targets. Back restores the person's safe reading position and sibling panes remain independent.

### Six-person overview — candidate at both 1920×1080 and 3840×2160 CSS pixels

Use the **same fictional household and workload** at each size; 3×2 is a candidate to judge, not a fixed decision. Each box represents a person pane, and `⋮` indicates that the interior, not the page, scrolls.

```text
┌ Morgan ──────────────────┐ ┌ Avery ───────────────────┐ ┌ Jordan ──────────────────┐
│ ▸ Morning checklist ✓   │ │ ▸ Morning checklist ✓   │ │ ▸ Morning checklist ✓   │
│ ▾ Cat maintenance 1/3   │ │ ▾ After school 2/5      │ │ ▾ House cleaning 1/3    │
│   ☑ Feed cats            │ │   ☑ Put lunch away       │ │   ☑ Clear table           │
│   ☐ Water                │ │   ☐ Pack library books   │ │   ☐ Wipe counters        │
│ ▸ Dinner cleanup · later │ │ ▸ Bedtime · later        │ │ ▸ Cat maintenance · later│
│ ⋮                        │ │ ⋮                        │ │ ⋮                        │
└──────────────────────────┘ └──────────────────────────┘ └──────────────────────────┘
┌ Casey ───────────────────┐ ┌ Taylor ──────────────────┐ ┌ Rowan ───────────────────┐
│ ▾ Morning checklist 0/3 │ │ ▾ Dinner cleanup 0/3    │ │ No assigned work today   │
│   ☐ Breakfast            │ │   ☐ Put leftovers away   │ │                         │
│   ☐ Brush teeth          │ │   ☐ Rinse dishes         │ │                         │
│ ▸ Bedtime · later        │ │ ▸ Bedtime · later        │ │                         │
│ ⋮                        │ │ ⋮                        │ │                         │
└──────────────────────────┘ └──────────────────────────┘ └──────────────────────────┘
```

### Expanded Avery — candidate at both target viewports

```text
‹ Family                                       Avery
┌────────────────────── one scroll surface ──────────────────────┐
│ ▸ Morning checklist                              Complete       │
│ ▾ After school                                   2 of 5 done    │
│   ☑ Put lunch away                                              │
│   ☑ Put shoes away                                              │
│   ☐ Pack library books and the signed permission slip           │
│   ☐ Get water bottle                                            │
│   ☐ Check backpack                                               │
│ ▸ Cat maintenance                               Later          │
│ ▸ Bedtime                                       Later          │
│ ⋮ scroll for more                                               │
└─────────────────────────────────────────────────────────────────┘
```

Disclosure selects one list in place; earlier/later headers remain in that same scroll area. Completed work remains reopenable. The long instruction wraps, never requires a tooltip. Calm, rounded controls and legible text must remain practical at both targets; do not simply scale a bitmap or shrink type to retain 3×2.

## What the next proof must demonstrate

- A real fixed-viewport rendering at **1920×1080 and 3840×2160**, each showing both the same six-person overview and expanded Avery, with comparable current/proposed captures and target/scale labels. This text wireframe establishes intent; it is **not** the requested visual proof or an assertion that a layout fits.
- Crowded long lists, completed and later headers, an empty person, rotating chore identity, pending/error cue, direct actions and independent sibling scrolling; deliberate enlargement/back and safe tap versus drag. Fictional data only in a disposable proof.
- A Project Lead checkpoint on hierarchy, usable scroll height, control size and expanded navigation **before** Architecture locks the visual implementation brief. Record what was shown, viewport/scale and the decision; physical touch/readability remain separate observations.
- Preserve D-061 and P0-009B's authority, privacy, sync, execution, history and recovery semantics. The recovery bridge is temporary and may be removed after the timeline is approved. Personal-work visibility follows the existing deliberate-access boundary; exact presentation is to be resolved in the next brief.
