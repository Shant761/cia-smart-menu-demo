# CIA Smart Menu — GitHub Secrets

These are the canonical GitHub Actions secret names used by the project.

- `FIREBASE_SERVICE_ACCOUNT_CIA_SMART_MENU` — Firebase Admin service account.
- `OPENAI_API_KEY` — OpenAI API key.
- `POSTER_ACCESS_TOKEN` — Poster production/access token.
- `POSTER_TEST_ACCESS_TOKEN` — test Poster account (`CIASIFT` / `poster-test`).
- `USDA_API_KEY` — USDA FoodData Central API key.

## Security

- Secret values must never be committed to the repository.
- Secret values must not be pasted into chat.
- Workflows should reference these exact names.
- `USDA_DATA_API_KEY` is deprecated; use `USDA_API_KEY` instead.
