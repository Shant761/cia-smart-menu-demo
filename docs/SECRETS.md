# CIA Smart Menu — GitHub Secrets

These are the canonical GitHub Actions secret names used by the project.

- `FIREBASE_SERVICE_ACCOUNT_CIA_SMART_MENU` — Firebase Admin service account.
- `OPENAI_API_KEY` — OpenAI API key.
- `POSTER_TOKEN` — Poster access token for the `poster-test` account.
- `POSTER_TEST_ACCESS_TOKEN` — Poster access token for `CIASIFT`.
- `USDA_API_KEY` — USDA FoodData Central API key.

## Poster account mapping

Keep the two Poster accounts strictly separated:

| Restaurant/account | GitHub secret |
| --- | --- |
| `poster-test` | `POSTER_TOKEN` |
| `CIASIFT` / `ciasift` | `POSTER_TEST_ACCESS_TOKEN` |

`POSTER_ACCESS_TOKEN` is an old ambiguous secret name and must not be referenced directly by GitHub workflows. A Node script may still read an environment variable named `POSTER_ACCESS_TOKEN`; in that case the workflow must explicitly map the correct account-specific secret into that runtime variable.

## Security

- Secret values must never be committed to the repository.
- Secret values must not be pasted into chat.
- Workflows should reference the account-specific secret names above.
- `USDA_DATA_API_KEY` is deprecated; use `USDA_API_KEY` instead.
