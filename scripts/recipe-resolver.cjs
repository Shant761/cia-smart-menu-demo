/**
 * Recipe resolver foundation.
 *
 * This module intentionally does not call Poster and does not change the
 * existing sync behavior yet. It gives the sync pipeline a stable model for
 * direct ingredients and preparations before we wire in Poster-specific
 * preparation lookup.
 */

const DEFAULT_MAX_DEPTH = 12;

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function normalizeId(value) {
  const id = firstValue(value);
  return id == null ? '' : String(id).trim();
}

function normalizeName(value) {
  return String(firstValue(value) || '').trim();
}

function normalizeQuantity(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeComponent(raw, index = 0) {
  const source = raw || {};
  const id = normalizeId(
    source.ingredient_id,
    source.ingredientId,
    source.poster_ingredient_id,
    source.posterIngredientId,
    source.preparation_id,
    source.preparationId,
    source.product_id,
    source.productId,
    source.id
  );

  const name = normalizeName(
    source.ingredient_name,
    source.ingredientName,
    source.preparation_name,
    source.preparationName,
    source.product_name,
    source.productName,
    source.name
  );

  const explicitType = String(firstValue(
    source.type,
    source.component_type,
    source.componentType,
    source.item_type,
    source.itemType
  ) || '').trim().toLowerCase();

  const preparationId = normalizeId(
    source.preparation_id,
    source.preparationId,
    source.prep_id,
    source.prepId
  );

  const isPreparation = Boolean(preparationId) || explicitType === 'preparation' || explicitType === 'prep' || explicitType === 'semi_finished' || explicitType === 'semifinished';

  return {
    id,
    name,
    type: isPreparation ? 'preparation' : 'ingredient',
    quantity: normalizeQuantity(firstValue(source.quantity, source.qty, source.amount, source.count)),
    unit: normalizeName(firstValue(source.unit, source.unit_name, source.measure, source.measure_unit)),
    sourceIndex: index,
    raw: source
  };
}

function normalizeRecipe(recipe) {
  const ingredients = Array.isArray(recipe?.ingredients)
    ? recipe.ingredients.map(normalizeComponent)
    : [];

  return {
    directIngredients: ingredients.filter((component) => component.type === 'ingredient'),
    preparations: ingredients.filter((component) => component.type === 'preparation'),
    raw: recipe || null
  };
}

/**
 * Resolve nested preparations using a caller-provided async loader.
 *
 * loader(component) must return a Poster preparation recipe object or null.
 * The resolver protects against cycles and runaway nesting.
 */
async function resolveRecipe(recipe, loader, options = {}) {
  if (typeof loader !== 'function') throw new TypeError('recipe resolver loader must be a function');

  const maxDepth = Number.isInteger(options.maxDepth) && options.maxDepth > 0
    ? options.maxDepth
    : DEFAULT_MAX_DEPTH;

  const root = normalizeRecipe(recipe);
  const expandedIngredients = [];
  const preparations = [];
  const warnings = [];

  async function visitComponent(component, path, depth, ancestry) {
    if (component.type !== 'preparation') {
      expandedIngredients.push({
        id: component.id,
        name: component.name,
        quantity: component.quantity,
        unit: component.unit,
        path,
        source: 'direct'
      });
      return;
    }

    if (!component.id) {
      warnings.push({ type: 'missing_preparation_id', name: component.name, path });
      preparations.push({ ...component, path, status: 'unresolved' });
      return;
    }

    if (depth >= maxDepth) {
      warnings.push({ type: 'max_depth', id: component.id, name: component.name, path, maxDepth });
      preparations.push({ ...component, path, status: 'max_depth' });
      return;
    }

    if (ancestry.has(component.id)) {
      warnings.push({ type: 'cycle', id: component.id, name: component.name, path });
      preparations.push({ ...component, path, status: 'cycle' });
      return;
    }

    preparations.push({ ...component, path, status: 'resolving' });

    let childRecipe = null;
    try {
      childRecipe = await loader(component);
    } catch (error) {
      warnings.push({ type: 'loader_error', id: component.id, name: component.name, path, message: error.message });
    }

    if (!childRecipe) {
      warnings.push({ type: 'unresolved_preparation', id: component.id, name: component.name, path });
      const entry = preparations[preparations.length - 1];
      entry.status = 'unresolved';
      return;
    }

    const child = normalizeRecipe(childRecipe);
    const nextAncestry = new Set(ancestry);
    nextAncestry.add(component.id);

    for (const childComponent of [...child.directIngredients, ...child.preparations]) {
      await visitComponent(childComponent, `${path}/${childComponent.name || childComponent.id || 'component'}`, depth + 1, nextAncestry);
    }

    preparations[preparations.length - 1].status = 'resolved';
  }

  for (const component of [...root.directIngredients, ...root.preparations]) {
    await visitComponent(component, component.name || component.id || 'component', 0, new Set());
  }

  return {
    directIngredients: root.directIngredients,
    directPreparations: root.preparations,
    expandedIngredients,
    preparations,
    warnings,
    stats: {
      directIngredientCount: root.directIngredients.length,
      directPreparationCount: root.preparations.length,
      expandedIngredientCount: expandedIngredients.length,
      preparationCount: preparations.length,
      warningCount: warnings.length
    }
  };
}

module.exports = {
  DEFAULT_MAX_DEPTH,
  normalizeComponent,
  normalizeRecipe,
  resolveRecipe
};
