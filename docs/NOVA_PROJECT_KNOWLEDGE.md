# NOVA Project Knowledge — CIA Smart Menu

Last updated: 2026-08-29

## Current focus

Primary project: CIA Smart Menu / CIA Nutrition Engine for Poster POS.

Goal: calculate dish calories/macros from Poster tech cards, keep allergen/menu data useful, avoid false precision, and minimize Firestore quota usage.

## Nutrition status

- Nutrition catalog currently covers 437 priority ingredients.
- 172 entries are verified in the local nutrition knowledge base.
- Meat audit and recalculation are active.
- Public menu snapshot for `poster-test` is recalculated directly from live Poster recipes without using Firestore.
- Firestore sync remains optional and should not be used unless explicitly needed.

## Important meat fixes

- `Свиной чалагач на гриле` (Poster product 139) has 450 g pork rack/loin meat in the Poster tech card.
- Meat alone contributes about 765 kcal.
- Current public result is `≥800 kcal` because 6/8 recipe rows are known; satsebeli sauce and thyme still require verification.
- Old `85 kcal` result was invalid and must never be restored.
- Partial nutrition values must be displayed as a minimum (`≥`), never as a fully verified exact result.
- The `Лёгкое` badge must only appear for fully calculated dishes, never for partial/needs_review values.

## Verified meat-related base values

Verified ordinary meat ingredients include pork, pork rack/ribs, lamb cuts, beef loin/tenderloin, chicken breast, chicken/whole bird references, cooked hearts, and related clean meat entries.

Newly added:
- Beef `մեջքամիս` / loin-back section: 191 kcal/100 g, protein 22 g, fat 12 g, carbs 0.
- Pork backfat / `сало`: 812 kcal/100 g, protein 2.92 g, fat 88.7 g, carbs 0.

Do not guess exact values for recipe-dependent preparations such as kavurma, pâté, khinkali filling, dolma filling, cooked beef preparation, sauces, rolls, or other Poster preparations. These must be calculated from their own Poster tech cards where possible.

## Meat recalculation workflow

Files:
- `scripts/recalculate-meat-snapshot.cjs`
- `.github/workflows/recalculate-poster-test-meat-snapshot.yml`
- `data/poster-test-meat-nutrition-summary.json`
- `data/public-menus/poster-test.json`

Logic:
1. Pull live Poster product recipes.
2. Match verified local nutrition records.
3. Calculate exact nutrition only when all recipe rows are resolved.
4. If some rows are unresolved, store known nutrition as a partial minimum.
5. Never let an old exact result survive when the current recipe is only partially known.

## Current meat audit result

Latest audit after meat batch 04:
- 64 candidate products inspected.
- 4 fully calculated.
- 39 partially calculated.
- 11 still have no reliable known calorie total.

Examples:
- `Свиной чалагач на гриле`: ≥800 kcal; meat-only 765 kcal.
- `Мясной микс`: known minimum ≈4487 kcal; most of its mass is already resolved.
- `Борщ`: known minimum increased after adding pork backfat; remaining preparation rows still need tech-card resolution.

## Data-quality rule: Poster ID collisions

Poster numeric IDs can collide between regular ingredients and preparations if `structure_type` is lost.

Safety rule already in place: incompatible `sourceNames` must not be auto-matched.

Root fix still needed:
- preserve `structure_type` during Poster sync;
- use type-aware keys such as `poster_ingredient_<id>` and `poster_preparation_<id>`;
- update catalog and product calculator accordingly;
- then rebuild/re-sync.

Do not remove collision protection before this structural fix.

## UI / cache

- `app.js` cache version was bumped for the meat nutrition UI fix.
- Partial dishes must not receive the `Лёгкое` badge.
- Latest public meat snapshot was explicitly redeployed after recalculation.

## Next recommended work

1. Continue meat preparations using Poster tech cards, especially high-impact preparations used in multiple dishes.
2. Resolve `structure_type` at the data-model level to eliminate ingredient/preparation ID collisions.
3. Continue ordinary unambiguous nutrition entries after meat.
4. Keep Firestore reads/writes low; prefer static/public snapshots and local nutrition database where possible.

## Working rule for Nova

When the user says `продолжай калории` or asks to check meat/calories:
- inspect current GitHub HEAD first;
- continue from the current nutrition database instead of rebuilding solved work;
- prefer official/USDA sources for ordinary ingredients;
- use Poster tech cards as authority for preparations;
- never fabricate exact calories for unresolved recipe components;
- commit actual changes and verify the workflow result.
