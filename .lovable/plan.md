# MARY: slim side tracker + round logo-matching font

Two refinements, same calm light stage: shrink the captured-details tracker into a small side element, and switch the typeface to a smooth, round geometric sans that matches the OmniSuite logo's feel.

## 1. Side tracker — small, out of the way

The details tracker (name, email, phone, business, industry, operations) currently sits as a dot row at the top of the conversation. It becomes a slim floating rail pinned to the right edge of the screen, vertically centered:

- One small dot per detail, stacked vertically with generous gaps — the whole rail is about a thumb's width, so the conversation keeps the full stage.
- The label of each field sits beside its dot in tiny quiet type (always visible, no hover needed) — NAME, EMAIL, PHONE, BUSINESS, INDUSTRY, OPERATIONS — filling in with the captured value as MARY collects it.
- Uncollected: faint ink dot. Collected: lime dot with a soft spring pop, value fades in next to it.
- A thin count at the bottom ("2/6").
- On phones, where a side rail would crowd the screen, it collapses to a single small chip (the count with a lime ring) that expands on tap — or simply hides labels and keeps dots only.
- The rail never overlaps the conversation trail or the composer; it floats on the paper background with no card, no border — consistent with the de-boxed design.

On the landing and confirmation screens, nothing changes (no tracker on landing; the confirmation keeps its details list, since that's the moment the person wants to review them).

## 2. Round, smooth font matching the logo

- Headings and MARY's spoken lines switch from Space Grotesk to **Comfortaa** — a geometric sans with fully rounded terminals, the closest widely available match to the smooth, round character of the logo mark. Used at medium weight so it stays elegant, not cartoonish.
- Body copy, labels and the composer stay in DM Sans (already soft and readable) so long text doesn't tire.
- Loaded via Google Fonts link in the root route; the font tokens in the global styles are updated, so every heading and MARY line changes in one place.
- The logo lockup itself is untouched — the new type simply harmonizes with it.

## Technical details

- `src/components/progress-constellation.tsx` — rewritten as the vertical side rail: fixed-position right edge, vertically centered, motion-driven dot pops with the existing spring vocabulary; responsive collapse on small screens (dots only, or a tappable count chip).
- `src/components/mary-experience.tsx` — mount the rail only in the live stage; remove the top strip; conversation column keeps its max width and stays centered with the rail floating clear of it.
- `src/routes/__root.tsx` — add the Comfortaa font link (400/500/600).
- `src/styles.css` — update the display font token to Comfortaa; no color token changes.
- Reduced-motion users get instant dot fills without the pop.
- Verify: Playwright run through a full conversation checking the rail fills per field and stays clear of the composer on desktop (1280×1800) and mobile (390×844); typecheck and lint clean.
