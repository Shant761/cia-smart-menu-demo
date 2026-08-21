const assert = require('node:assert/strict');
const { normalizeComponent, normalizeRecipe, resolveRecipe } = require('./recipe-resolver.cjs');

async function main() {
  const ingredient = normalizeComponent({ ingredient_id: 10, ingredient_name: 'Milk', quantity: '0.2', unit_name: 'kg' });
  assert.equal(ingredient.id, '10');
  assert.equal(ingredient.type, 'ingredient');
  assert.equal(ingredient.quantity, 0.2);
  assert.equal(ingredient.unit, 'kg');

  const preparation = normalizeComponent({ preparation_id: 20, preparation_name: 'Sauce', quantity: 50, unit: 'g' });
  assert.equal(preparation.id, '20');
  assert.equal(preparation.type, 'preparation');

  const recipe = normalizeRecipe({ ingredients: [
    { ingredient_id: 1, ingredient_name: 'Bread' },
    { preparation_id: 2, preparation_name: 'Sauce' }
  ] });
  assert.equal(recipe.directIngredients.length, 1);
  assert.equal(recipe.preparations.length, 1);

  const resolved = await resolveRecipe(recipe.raw, async (component) => {
    if (component.id === '2') {
      return { ingredients: [
        { ingredient_id: 3, ingredient_name: 'Milk' },
        { preparation_id: 4, preparation_name: 'Mayonnaise' }
      ] };
    }
    if (component.id === '4') {
      return { ingredients: [{ ingredient_id: 5, ingredient_name: 'Egg' }] };
    }
    return null;
  });

  assert.deepEqual(resolved.expandedIngredients.map((item) => item.id), ['1', '3', '5']);
  assert.equal(resolved.stats.directPreparationCount, 1);
  assert.equal(resolved.stats.expandedIngredientCount, 3);
  assert.equal(resolved.warnings.length, 0);

  const cyclic = await resolveRecipe({ ingredients: [{ preparation_id: 9, preparation_name: 'Cycle' }] }, async () => ({ ingredients: [{ preparation_id: 9, preparation_name: 'Cycle' }] }));
  assert.equal(cyclic.warnings.some((warning) => warning.type === 'cycle'), true);

  const depthLimited = await resolveRecipe({ ingredients: [{ preparation_id: 1, preparation_name: 'A' }] }, async (component) => ({ ingredients: [{ preparation_id: Number(component.id) + 1, preparation_name: 'Next' }] }), { maxDepth: 2 });
  assert.equal(depthLimited.warnings.some((warning) => warning.type === 'max_depth'), true);

  console.log('recipe-resolver tests: OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
