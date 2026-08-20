# CIA Smart Menu Demo

Mobile-first QR restaurant menu for CIA SOFT. The menu can load restaurant data from Firestore while preserving the same frontend model used by the static demo.

## Current MVP flow

```text
Poster POS
   ↓
GitHub Actions
   ↓
scripts/sync-poster-to-firestore.cjs
   ↓
Firestore
   ↓
CIA Smart Menu
   ↓
?restaurant=<restaurant-id>
```

The Poster sync imports products, categories, prices, photos and (optionally) product recipe/ingredient data. Restaurant-specific enrichment such as allergens, translations and overrides is kept separately and reapplied after every Poster sync.

## Poster → Firestore sync

The manual workflow is:

`.github/workflows/sync-poster-menu.yml`

It accepts:

- `restaurant_id` — Firestore restaurant slug, for example `poster-demo`
- `restaurant_name` — display name for the first sync
- `spot_id` — optional Poster spot ID; blank uses the first visible spot
- `sync_recipes` — loads `menu.getProduct` recipe data
- `publish_menu` — makes the restaurant public in the Smart Menu

### Required GitHub Actions secrets

Add these repository secrets before running the workflow:

1. `POSTER_ACCESS_TOKEN`
2. `FIREBASE_SERVICE_ACCOUNT_CIA_SMART_MENU`

`FIREBASE_SERVICE_ACCOUNT_CIA_SMART_MENU` must contain the Firebase service-account JSON for the `cia-smart-menu` Firebase project.

Do **not** put either secret into source files, `data/`, the frontend, or commit history.

### First real sync

After the secrets are configured:

1. Open GitHub → **Actions**.
2. Select **Sync Poster menu to Firestore**.
3. Click **Run workflow**.
4. Start with:
   - restaurant ID: `poster-demo`
   - recipe sync: enabled
   - publish menu: enabled
   - spot ID: blank unless the restaurant has a specific spot to test
5. Wait for all workflow steps to finish successfully.
6. Open the deployed menu with:

```text
?restaurant=poster-demo
```

## Important safety model

Poster is the source of truth for operational menu data. The sync should update Poster-owned fields without destroying CIA-owned data such as reviewed allergens, translations, descriptions and restaurant-specific overrides.

## Local/static fallback

The frontend still contains static JSON data so the UI can be developed without Poster credentials or Firebase. This makes it possible to work on the customer experience independently from the integration.

## Next milestone

Do not add more AI features yet. First prove this complete path with one real/test Poster restaurant:

**Poster → Firestore → QR menu on a phone.**

Once that works, we will validate the ingredient/recipe data and only then enable AI-assisted allergen classification and review.