# NOVA Project Knowledge — CIA Smart Menu

Last updated: 2026-08-30

## Current focus

Primary project: CIA Smart Menu / CIA Nutrition Engine for Poster POS.

Goal: calculate dish calories/macros from Poster tech cards, keep allergen/menu data useful, avoid false precision, and minimize Firestore quota usage.

## Nutrition status

- Nutrition catalog currently covers 437 priority ingredients.
- 172 entries are verified in the local nutrition knowledge base.
- Poster `menu.getPrepacks` export currently contains 219 preparations and 1030 ingredient rows.
- After the piece-weight safety fix, 212 preparations are fully calculated and 7 remain `needs_review`.
- All 8 priority preparation targets are calculated.
- Full dish recalculation covers 422 public products; 407 have Poster recipes.
- Current dish result: 330 fully calculated, 41 partial minimums, 36 `needs_review` without a reliable known total.
- 150 dishes contain preparation rows; 273 preparation rows resolve and 10 remain unresolved.
- Current anomaly scan reports 0 dishes above the 10,000 kcal safety threshold.
- Public menu snapshot for `poster-test` is recalculated directly from live Poster recipes without using Firestore.
- Firestore sync remains optional and should not be used unless explicitly needed.

## Poster unit safety fixes

Poster piece rows must not be calculated as `structure_netto × ingredient_weight`.

Observed live example:
- `Яйца` in `Английский завтрак`: `structure_brutto = 2`, `structure_netto = 120`.
- Correct interpretation is 120 g net weight.
- The old multiplication produced 720,000 g and more than 1,000,000 kcal for the dish.

Current rules:
- for piece rows, positive `structure_netto` is used directly as net grams;
- piece rows without a positive net weight remain unresolved instead of being guessed;
- dish volume rows use explicit density conversion where supported;
- calculated preparation values above 1000 kcal/100 g are rejected as physically implausible and become `needs_review`;
- the dish calculator also refuses impossible preparation values above this guard.

After this correction, `Английский завтрак` changed from more than 1,000,000 kcal to a safe partial minimum of `≥541 kcal`; toast and bacon sausages still lack usable piece weights, so the dish is intentionally not marked exact.

## Preparation nutrition

Files:
- `scripts/export-poster-test-preparations.cjs`
- `scripts/calculate-prepack-nutrition.cjs`
- `.github/workflows/export-poster-test-preparations.yml`
- `data/poster-test-preparations.json`
- `data/poster-test-prepack-nutrition.json`

Rules:
1. `menu.getPrepacks` is the authoritative source for Poster preparation tech cards.
2. Ordinary ingredient rows resolve from verified `poster_<id>` nutrition.
3. Nested `structure_type=2` rows recursively resolve through preparation IDs.
4. Empty tech cards never become fake `0 kcal` calculated preparations.
5. Piece rows use Poster net weight, not piece-weight multiplication.
6. Values above 1000 kcal/100 g are blocked as unit/conversion errors.
7. Firestore is not used by this calculation.

## Full dish nutrition recalculation

Files:
- `scripts/recalculate-snapshot-with-prepacks.cjs`
- `.github/workflows/recalculate-poster-test-dishes-with-prepacks.yml`
- `data/poster-test-dish-nutrition-summary.json`
- `data/public-menus/poster-test.json`

Logic:
1. Pull every public product recipe from live Poster.
2. Resolve ordinary ingredients only from verified local nutrition.
3. Resolve `structure_type=2` rows from calculated Poster preparation nutrition.
4. Calculate exact nutrition only when every recipe row resolves.
5. Otherwise expose only a known minimum with `≥` when a partial total exists.
6. Keep unresolved rows visible in the summary for the next research batch.
7. Run anomaly tracing so unit errors cannot silently become public calorie values.

Latest successful result:
- 422 products fetched, 0 fetch errors.
- 407 products have recipe rows.
- 330 fully calculated.
- 41 partial.
- 36 review without known total.
- 273 preparation rows resolved.
- 10 preparation rows unresolved.
- 0 suspicious >10,000 kcal products.

## Important meat fixes

- `Свиной чалагач на гриле` (Poster product 139) has 450 g pork rack/loin meat in the Poster tech card.
- Meat alone contributes about 765 kcal.
- Partial nutrition values must be displayed as a minimum (`≥`), never as a fully verified exact result.
- Old `85 kcal` result was invalid and must never be restored.
- The `Лёгкое` badge must only appear for fully calculated dishes, never for partial/needs_review values.

## Verified meat-related base values

Verified ordinary meat ingredients include pork, pork rack/ribs, lamb cuts, beef loin/tenderloin, chicken breast, chicken/whole bird references, cooked hearts, and related clean meat entries.

Newly added:
- Beef `մեջքամիս` / loin-back section: 191 kcal/100 g, protein 22 g, fat 12 g, carbs 0.
- Pork backfat / `сало`: 812 kcal/100 g, protein 2.92 g, fat 88.7 g, carbs 0.

Do not guess exact values for unresolved recipe components. Preparations must be calculated from their own Poster tech cards where possible.

## Data-quality rule: Poster ID collisions

Poster numeric IDs can collide between regular ingredients and preparations if `structure_type` is lost.

Current type-aware rule:
- ordinary ingredient key: `poster_<id>`;
- preparation key/semantic: `poster_prep_<id>` / preparation lookup by preparation ID;
- never let a preparation overwrite an ordinary ingredient with the same numeric ID.

Do not remove collision protection.

## UI / cache

- Partial dishes must not receive the `Лёгкое` badge.
- Partial nutrition is displayed as a minimum (`≥`).
- Public static snapshots are preferred over repeated Firestore reads.

## Next recommended work

1. Resolve the remaining 10 unresolved preparation rows first; this is now the highest-impact preparation backlog.
2. Review the 41 partial dishes and 36 no-total dishes, prioritizing repeated missing ingredients/piece weights.
3. Keep automatic anomaly checks for impossible calorie totals and per-100-g preparation values.
4. Continue ordinary unambiguous nutrition entries after high-impact recipe gaps.
5. Keep Firestore reads/writes low; prefer static/public snapshots and local nutrition data.

## Working rule for Nova

When the user says `продолжай калории` or asks to check meat/calories:
- inspect current GitHub HEAD first;
- continue from the current nutrition database instead of rebuilding solved work;
- prefer official/USDA sources for ordinary ingredients;
- use Poster tech cards as authority for preparations;
- never fabricate exact calories for unresolved recipe components;
- treat Poster piece `structure_netto` as the net weight when positive;
- reject physically impossible preparation kcal/100 g values;
- commit actual changes and verify the workflow result.