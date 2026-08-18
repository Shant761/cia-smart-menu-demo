# Poster → Firestore sync

This stage imports one Poster restaurant into CIA Smart Menu without exposing the Poster access token to the browser.

## Security model

- `POSTER_ACCESS_TOKEN` lives only in GitHub Actions Secrets.
- The token is never written to Firestore, HTML, JavaScript, logs, QR codes, or public repository files.
- Firebase service account credentials stay in the existing `FIREBASE_SERVICE_ACCOUNT_CIA_SMART_MENU` GitHub secret.
- Browser clients can only read published restaurant/menu documents according to `firestore.rules`.

## One-time setup

In GitHub open:

`Settings → Secrets and variables → Actions → New repository secret`

Create:

- Name: `POSTER_ACCESS_TOKEN`
- Secret: the Poster API access token for the restaurant/account being tested.

Do not commit the token to the repository.

## Run an import

Open:

`Actions → Sync Poster menu to Firestore → Run workflow`

Inputs:

- `restaurant_id`: stable CIA slug, e.g. `poster-test` or `my-cafe`.
- `restaurant_name`: display name used only when the restaurant is first created.
- `spot_id`: optional Poster location/spot. Blank selects the first visible spot.
- `sync_recipes`: if enabled, calls `menu.getProduct` for each product and stores recipe ingredient metadata.
- `publish_menu`: if enabled, the restaurant is publicly readable by Smart Menu rules.

The menu can then be tested with:

`https://cia-smart-menu.web.app/?restaurant=<restaurant_id>`

## Data mapping

Poster remains the source of truth for:

- product/category IDs;
- names;
- menu category;
- visibility;
- spot price;
- photos;
- recipe/tech-card ingredient metadata when available.

CIA fields are kept separately/preserved where possible:

- allergens and confirmation status;
- calorie/nutrition enrichment;
- manual descriptions/translations;
- removability rules;
- ordering/table configuration.

Products removed from Poster are not deleted from Firestore; Poster-sourced documents are marked `active: false` so historical/custom CIA metadata is not destroyed.

## Next production step

GitHub Actions is only the first integration test. Once the first real Poster restaurant sync is validated, move the same sync module to CIA Server and run it automatically on a schedule/webhook strategy for multiple restaurants.
