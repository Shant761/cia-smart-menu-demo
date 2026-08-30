const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const sourcePath = path.join(root, 'data', `${restaurantId}-dish-nutrition-summary.json`);
const outputPath = path.join(root, 'data', `${restaurantId}-unresolved-dishes.json`);
const compactPath = path.join(root, 'data', `${restaurantId}-unresolved-dishes.txt`);

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
  version: '1.1.0',
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
const compact = products.map((product, index) => {
  const name = product.name?.ru || product.name?.hy || product.name?.en || product.productId;
  const missing = product.unresolved.map((row) => {
    const qty = row.structureUnit === 'p' ? `; шт=${row.rawBrutto ?? '?'}` : '';
    return `${row.name} [${row.reason}${qty}]`;
  }).join('; ');
  return `${index + 1}\t${product.productId}\t${name}\t${product.displayedCalories ?? 'нет'}\t${missing}`;
}).join('\n');
fs.writeFileSync(compactPath, `${compact}\n`);
console.log(`[unresolved dishes] total=${products.length} ${JSON.stringify(byStatus)}`);
