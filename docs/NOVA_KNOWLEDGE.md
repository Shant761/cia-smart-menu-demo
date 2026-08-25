# NOVA Knowledge — CIA Smart Menu

This file is the project memory/reference for NOVA when working on CIA Smart Menu.

## Project separation

CIA Smart Menu is a separate context from CIA Game Studio. Do not mix the Smart Menu project with Unity/game development context.

## Canonical GitHub secrets

Use exactly these GitHub Actions secret names:

- `FIREBASE_SERVICE_ACCOUNT_CIA_SMART_MENU`
- `OPENAI_API_KEY`
- `POSTER_ACCESS_TOKEN`
- `POSTER_TEST_ACCESS_TOKEN` — test account `CIASIFT` / `poster-test`
- `USDA_API_KEY`

Never store secret values in this repository or in chat.

`USDA_DATA_API_KEY` is deprecated and must not be used. Use `USDA_API_KEY`.

## Nutrition work in progress

The current nutrition pipeline is intentionally incremental.

Current known data:

- Poster sync provides restaurant product/recipe data.
- The ingredient catalog currently contains about 437 unique ingredients from the tested Poster data.
- The nutrition database contains 3766 nutrition records. 3766 is the number of records, not a calorie value.
- `Build ingredient catalog` has already completed successfully for `poster-test`.
- Nutrition matching should first be tested on a small sample (for example 10 ingredients) before scaling to all ingredients.
- Beluga is a control test: matching must avoid false matches such as whale oil and prefer the appropriate beverage/food match.

## Current nutrition workflow

`.github/workflows/calculate-nutrition.yml` is named `Build verified nutrition`.

It uses:

- `FIREBASE_SERVICE_ACCOUNT_CIA_SMART_MENU`
- `USDA_API_KEY`

The workflow rebuilds the ingredient catalog, matches ingredients against USDA FoodData Central, then calculates product nutrition.

For tests use:

- restaurant: `poster-test`
- small `lookup_limit` first (10 is the current preferred test size)
- `force: true` when a fresh matching run is required

## Development rule

Do not add unnecessary API layers or redesign Poster synchronization before the basic nutrition matching works. Prefer small, isolated changes and verify the result before expanding the scope.
