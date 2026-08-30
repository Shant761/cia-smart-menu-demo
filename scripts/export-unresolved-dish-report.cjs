const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const sourcePath = path.join(root, 'data', `${restaurantId}-dish-nutrition-summary.json`);
const snapshotPath = path.join(root, 'data', 'public-menus', `${restaurantId}.json`);
const rulesPath = path.join(root, 'data', 'cia-nutrition-unit-rules.json');
const outputPath = path.join(root, 'data', `${restaurantId}-unresolved-dishes.json`);
const compactPath = path.join(root, 'data', `${restaurantId}-unresolved-dishes.txt`);

const summary = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const snapshot = fs.existsSync(snapshotPath) ? JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) : { products: [] };
const rules = fs.existsSync(rulesPath) ? JSON.parse(fs.readFileSync(rulesPath, 'utf8')) : { excludedCategoryIds: {} };
const excludedCategoryIds = new Set(Object.keys(rules.excludedCategoryIds || {}).map(String));

function categoryIdOf(product) {
  const value = product?.categoryId ?? product?.category_id ?? product?.menuCategoryId ?? product?.menu_category_id ?? product?.category?.id ?? product?.category;
  return value == null ? '' : String(value);
}

const snapshotById = new Map((snapshot.products || []).map((product) => [String(product.posterProductId ?? product.id), product]));
const recipeProducts = (summary.products || []).filter((product) => product?.recipeRows > 0);
const scopedRecipeProducts = recipeProducts.filter((product) => {
  const sourceProduct = snapshotById.get(String(product.productId));
  return !excludedCategoryIds.has(categoryIdOf(sourceProduct));
});
const excludedProducts = recipeProducts.filter((product) => {
  const sourceProduct = snapshotById.get(String(product.productId));
  return excludedCategoryIds.has(categoryIdOf(sourceProduct));
}).map((product) => {
  const sourceProduct = snapshotById.get(String(product.productId));
  const categoryId = categoryIdOf(sourceProduct);
  return {
    productId: String(product.productId),
    name: product.name,
    categoryId,
    reason: rules.excludedCategoryIds?.[categoryId]?.reason || 'out_of_scope'
  };
});

const products = scopedRecipeProducts
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
const scopedFullyCalculatedCount = scopedRecipeProducts.filter((product) => product.status === 'calculated').length;
const scopedCoveragePercent = scopedRecipeProducts.length > 0
  ? Math.round((scopedFullyCalculatedCount / scopedRecipeProducts.length) * 1000) / 10
  : 0;

const output = {
  version: '1.2.0',
  restaurantId,
  sourceGeneratedAt: summary.generatedAt,
  generatedAt: new Date().toISOString(),
  rawProductsWithRecipe: recipeProducts.length,
  excludedFromNutritionScopeCount: excludedProducts.length,
  nutritionScopeProductsWithRecipe: scopedRecipeProducts.length,
  fullyCalculatedCount: scopedFullyCalculatedCount,
  coveragePercent: scopedCoveragePercent,
  unresolvedCount: products.length,
  byStatus,
  excludedProducts,
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
console.log(`[nutrition scope] rawRecipes=${recipeProducts.length}; excluded=${excludedProducts.length}; scopedRecipes=${scopedRecipeProducts.length}; calculated=${scopedFullyCalculatedCount}; unresolved=${products.length}; coverage=${scopedCoveragePercent}%`);
