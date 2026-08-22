const { spawnSync } = require('node:child_process');

const scripts = [
  'scripts/sync-poster-to-firestore.cjs',
  'scripts/apply-product-title-translations.cjs',
  'scripts/enrich-products-from-ingredient-catalog.cjs',
  'scripts/apply-ingredient-nutrition.cjs',
  'scripts/enrich-ingredient-nutrition-from-usda.cjs',
  'scripts/calculate-product-nutrition.cjs',
  'scripts/apply-admin-reviews.cjs'
];

for (const script of scripts) {
  console.log(`\n=== ${script} ===`);
  const result = spawnSync(process.execPath, [script], {
    stdio: 'inherit',
    env: process.env
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log('\nPoster sync and menu enrichment completed successfully.');
