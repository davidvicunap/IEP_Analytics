@AGENTS.md

# UI/UX Design Standards: Human-Crafted, Anti-AI-Slop

When designing or refactoring any interface in this codebase, reject generic AI/SaaS template defaults. Aim for the restraint, clarity, and tactile precision of tools like Linear, Stripe, Things 3, or editorial print design.

## 1. Hard Bans (Never Use Unless Explicitly Requested)
- **No purple/indigo/blue-to-pink gradients** on backgrounds, buttons, or hero text.
- **No gratuitous glassmorphism** (`backdrop-blur`), neon glows, or floating orbs.
- **No "bento grid" marketing layouts** with giant emoji/icon badges in rounded-2xl cards.
- **No decorative SaaS filler:** Do not add fake testimonials, unrequested "sparkle" icons (`✨`), pulsing status dots, or buzzword subtitles ("Supercharge your workflow with AI").
- **No uniform `rounded-xl` + `shadow-md` on everything.** Avoid wrapping every group of elements in a card.

## 2. Color & Surface Discipline
- **Use a restrained palette:** 90% neutral surfaces (warm off-whites like `#FAF9F6` or crisp slates, never harsh `#FFFFFF` on `#000000` unless brutalist), 1 primary brand accent used sparingly for the single most important action on screen, and semantic colors strictly for status (error, success, warning).
- **Prefer borders over shadows:** Use crisp `1px` hairline borders (`rgba(0,0,0,0.08)` in light mode, `rgba(255,255,255,0.08)` in dark mode) to define hierarchy. Reserve shadows only for truly elevated layers (dropdowns, modals, popovers).
- **Avoid pure black text:** Use deep charcoal (`#111827` or `#1A1A1A`) for primary text and muted neutrals for secondary metadata.

## 3. Typography & Hierarchy
- **Create contrast through weight, size, and color—not extra boxes.**
- **Pair intentionally:** Avoid defaulting blindly to Inter for everything. Use strong typographic hierarchy: tight tracking (`-0.02em` to `-0.03em`) on large headings, generous line-height (`1.5`–`1.6`) on body copy, and `tabular-nums` for any numbers, prices, dates, or tables.
- **Respect line length:** Cap readable body text at `60ch`–`68ch`.
- **Write human microcopy:** Use plain, direct labels ("Save changes", "No projects yet") instead of robotic or overly cheerful phrasing ("Oops! Looks like nothing is here yet! 🚀").

## 4. Layout & Whitespace
- **Let content breathe:** Use an explicit spacing scale (4px/8px grid) with generous outer padding and tighter internal grouping (Law of Proximity).
- **Eliminate redundant containers:** If whitespace and alignment already separate two sections, do not put a card border around them.
- **Asymmetry over rigid symmetry:** Left-align text and forms for natural scanning. Avoid centering everything by default.

## 5. Human-Centric Interaction & Craft
- **Design every state:** Never build only the "happy path." Always implement thoughtful empty states, inline validation errors, loading skeletons (matching the actual layout), and disabled states.
- **Subtle, physical motion:** Keep transitions fast (`150ms`–`200ms`) with natural easing (`cubic-bezier(0.2, 0, 0, 1)`). Never animate elements just for show.
- **Keyboard & accessibility first:** Every interactive element must have a clear `:focus-visible` ring, proper contrast ratios (WCAG AA minimum), and logical tab order.

## 6. Before Writing UI Code
Before generating a new page or major component, briefly state:
1. The **single primary action** the user is trying to complete.
2. The **visual hierarchy** (what the eye should hit 1st, 2nd, and 3rd).
3. Any **unnecessary elements** you are deliberately leaving out.
