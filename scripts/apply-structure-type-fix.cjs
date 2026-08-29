const fs = require('node:fs');

function patchFile(path, patches) {
  let text = fs.readFileSync(path, 'utf8');
  let changed = false;
  for (const { oldText, newText, marker } of patches) {
    if (text.includes(newText)) continue;
    if (!text.includes(oldText)) {
      throw new Error(`${path}: expected patch source not found (${marker})`);
    }
    text = text.replace(oldText, newText);
    changed = true;
  }
  if (changed) fs.writeFileSync(path, text, 'utf8');
  console.log(`[structure-type-fix] ${path}: ${changed ? 'patched' : 'already patched'}`);
}

patchFile('scripts/sync-poster-to-firestore.cjs', [
  {
    marker: 'preserve recipe structure_type',
    oldText: "posterRecipeIngredients: recipeIngredients.map((ingredient) => ({ ingredientId: ingredient?.ingredient_id ?? null, name: ingredient?.ingredient_name ?? '', unit: ingredient?.structure_unit ?? ingredient?.ingredient_unit ?? '', brutto: toNumber(ingredient?.structure_brutto), netto: toNumber(ingredient?.structure_netto), locked: String(ingredient?.structure_lock ?? '0') === '1' }))",
    newText: "posterRecipeIngredients: recipeIngredients.map((ingredient) => ({ ingredientId: ingredient?.ingredient_id ?? null, structureType: toNumber(ingredient?.structure_type, 1), name: ingredient?.ingredient_name ?? '', unit: ingredient?.structure_unit ?? ingredient?.ingredient_unit ?? '', brutto: toNumber(ingredient?.structure_brutto), netto: toNumber(ingredient?.structure_netto), locked: String(ingredient?.structure_lock ?? '0') === '1' }))"
  }
]);

patchFile('scripts/build-ingredient-catalog.cjs', [
  {
    marker: 'type-aware catalog doc id',
    oldText: "function ingredientDocId(ingredientId, name) {\n  if (ingredientId !== null && ingredientId !== undefined && String(ingredientId).trim()) return `poster_${String(ingredientId).trim()}`;\n  return `name_${hash(normalizeText(name).toLowerCase()).slice(0, 20)}`;\n}",
    newText: "function ingredientDocId(ingredientId, name, structureType = 1) {\n  if (ingredientId !== null && ingredientId !== undefined && String(ingredientId).trim()) {\n    const prefix = Number(structureType) === 2 ? 'poster_prep_' : 'poster_';\n    return `${prefix}${String(ingredientId).trim()}`;\n  }\n  return `name_${hash(normalizeText(name).toLowerCase()).slice(0, 20)}`;\n}"
  },
  {
    marker: 'read structure type in catalog loop',
    oldText: "      const posterIngredientId = ingredient?.ingredientId ?? null;\n      const docId = ingredientDocId(posterIngredientId, name);",
    newText: "      const posterIngredientId = ingredient?.ingredientId ?? null;\n      const posterStructureType = Number(ingredient?.structureType ?? 1);\n      const docId = ingredientDocId(posterIngredientId, name, posterStructureType);"
  },
  {
    marker: 'store structure type in catalog accumulator',
    oldText: "        catalog.set(docId, { docId, posterIngredientId, names: new Set(), units: new Set(), occurrences: 0, totalNetto: 0, totalBrutto: 0, productIds: new Set(), samples: [] });",
    newText: "        catalog.set(docId, { docId, posterIngredientId, posterStructureType, names: new Set(), units: new Set(), occurrences: 0, totalNetto: 0, totalBrutto: 0, productIds: new Set(), samples: [] });"
  },
  {
    marker: 'include structure type in catalog hash',
    oldText: "    const sourceHash = hash(JSON.stringify({ posterIngredientId: entry.posterIngredientId, names, units }));",
    newText: "    const sourceHash = hash(JSON.stringify({ posterIngredientId: entry.posterIngredientId, posterStructureType: entry.posterStructureType, names, units }));"
  },
  {
    marker: 'write structure type to catalog document',
    oldText: "        posterIngredientId: entry.posterIngredientId,\n        primaryName,",
    newText: "        posterIngredientId: entry.posterIngredientId,\n        posterStructureType: entry.posterStructureType,\n        primaryName,"
  },
  {
    marker: 'catalog version bump',
    oldText: "ingredientCatalog: { uniqueIngredients: catalog.size, activePosterProducts, recipeRows, pendingReview, needsReview, unchanged, lastBuildAt: now, version: 2 }",
    newText: "ingredientCatalog: { uniqueIngredients: catalog.size, activePosterProducts, recipeRows, pendingReview, needsReview, unchanged, lastBuildAt: now, version: 3 }"
  }
]);

patchFile('scripts/calculate-product-nutrition.cjs', [
  {
    marker: 'add type-aware nutrition catalog helper',
    oldText: "function hash(v) { return crypto.createHash('sha256').update(v).digest('hex'); }\nfunction mlDensity(ingredient) {",
    newText: "function hash(v) { return crypto.createHash('sha256').update(v).digest('hex'); }\nfunction catalogDocId(ingredient) {\n  if (ingredient?.ingredientId == null || !String(ingredient.ingredientId).trim()) return null;\n  const prefix = Number(ingredient?.structureType ?? 1) === 2 ? 'poster_prep_' : 'poster_';\n  return `${prefix}${String(ingredient.ingredientId).trim()}`;\n}\nfunction mlDensity(ingredient) {"
  },
  {
    marker: 'type-aware lookup in recipe loop',
    oldText: "      const id = ingredient?.ingredientId != null && String(ingredient.ingredientId).trim() ? `poster_${String(ingredient.ingredientId).trim()}` : null;",
    newText: "      const id = catalogDocId(ingredient);"
  },
  {
    marker: 'type-aware lookup in hash input',
    oldText: "      const id = x?.ingredientId != null && String(x.ingredientId).trim() ? `poster_${String(x.ingredientId).trim()}` : null;",
    newText: "      const id = catalogDocId(x);"
  },
  {
    marker: 'record structure type in ingredient results',
    oldText: "        ingredientId: ingredient?.ingredientId ?? null,\n        name: ingredient?.name || '',",
    newText: "        ingredientId: ingredient?.ingredientId ?? null,\n        structureType: Number(ingredient?.structureType ?? 1),\n        name: ingredient?.name || '',"
  },
  {
    marker: 'record structure type in calculation input',
    oldText: "        ingredientId: x?.ingredientId ?? null,\n        name: x?.name || '',",
    newText: "        ingredientId: x?.ingredientId ?? null,\n        structureType: Number(x?.structureType ?? 1),\n        name: x?.name || '',"
  },
  {
    marker: 'structure type in recipe hash',
    oldText: "recipeHash: hash(JSON.stringify(recipe.map((x) => ({ ingredientId: x.ingredientId ?? null, name: x.name || '', unit: x.unit || '', netto: x.netto ?? null })))),",
    newText: "recipeHash: hash(JSON.stringify(recipe.map((x) => ({ ingredientId: x.ingredientId ?? null, structureType: Number(x.structureType ?? 1), name: x.name || '', unit: x.unit || '', netto: x.netto ?? null })))),"
  }
]);

patchFile('scripts/lookup-nutrition-local.cjs', [
  {
    marker: 'prevent preparation auto-match',
    oldText: "    const names = [item.primaryName, ...(item.sourceNames || [])].filter(Boolean);\n    const collision = hasSourceNameCollision(names);\n    const ranked = entries.map((entry) => ({ entry, score: score(entry, names) })).sort((a, b) => b.score - a.score);\n    const top = ranked[0];\n    const second = ranked[1];\n    const verified = !collision && top && top.entry.verified === true && top.score >= 70 && (!second || top.score > second.score);",
    newText: "    const names = [item.primaryName, ...(item.sourceNames || [])].filter(Boolean);\n    const collision = hasSourceNameCollision(names);\n    const isPreparation = Number(item.posterStructureType ?? 1) === 2 || doc.id.startsWith('poster_prep_');\n    const ranked = entries.map((entry) => ({ entry, score: score(entry, names) })).sort((a, b) => b.score - a.score);\n    const top = ranked[0];\n    const second = ranked[1];\n    const verified = !isPreparation && !collision && top && top.entry.verified === true && top.score >= 70 && (!second || top.score > second.score);"
  },
  {
    marker: 'count preparations as review',
    oldText: "    if (collision) collisions += 1;\n    if (!top) missing += 1;\n    else if (verified) matched += 1;\n    else review += 1;",
    newText: "    if (collision) collisions += 1;\n    if (isPreparation) review += 1;\n    else if (!top) missing += 1;\n    else if (verified) matched += 1;\n    else review += 1;"
  },
  {
    marker: 'preparation nutrition review payload',
    oldText: "    let nutrition;\n    if (top) {",
    newText: "    let nutrition;\n    if (isPreparation) {\n      nutrition = {\n        status: 'review',\n        source: 'Poster preparation recipe required',\n        databaseVersion: database.version,\n        sourceHash: item.sourceHash,\n        reviewReason: 'poster_preparation_requires_recipe'\n      };\n    } else if (top) {"
  }
]);

console.log('[structure-type-fix] complete');
