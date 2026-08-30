const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const sourcePath = path.join(root, 'data', `${restaurantId}-dish-nutrition-summary.json`);
const outputPath = path.join(root, 'data', `${restaurantId}-unresolved-dishes.json`);

const summary = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const products = (summary.products || [])
  .filter((product) => product.status !== 'calculated')
  .map((product) => ({
    productId: String(product.productId),
    name: product.name,
    status: product.status,
    displayedCalories: product.displayedCalories,
    displayedAsMinimum: product.displayedAsMinimum === true,
    recipeRows: product.recipeRows,
    resolvedRows: product.resolvedRows,
    unresolved: (product.unresolved || []).map((row) => ({
      id: String(row.id),
      type: row.type,
      name: row.name,
      reason: row.reason,
      structureUnit: row.structureUnit,
      ingredientUnit: row.ingredientUnit,
      rawNetto: row.rawNetto,
      rawBrutto: row.rawBrutto
    }))
  }));

const byStatus = products.reduce((acc, product) => {
  acc[product.status] = (acc[product.status] || 0) + 1;
  return acc;
}, {});

const output = {
  version: '1.0.0',
  restaurantId,
  sourceGeneratedAt: summary.generatedAt,
  generatedAt: new Date().toISOString(),
  productsWithRecipe: summary.productsWithRecipe,
  fullyCalculatedCount: summary.fullyCalculatedCount,
  unresolvedCount: products.length,
  byStatus,
  products
};

fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`[unresolved dishes] total=${products.length} ${JSON.stringify(byStatus)}`);
