const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'nutrition-database.json');
const outPath = path.join(__dirname, '..', 'data', 'cia-nutrition-review.json');

if (!fs.existsSync(dbPath)) throw new Error(`Missing ${dbPath}`);
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const entries = Array.isArray(db.entries) ? db.entries : [];

const review = entries
  .filter(e => e.status === 'needs_review' || e.status === 'not_found' || e.status === 'api_error')
  .map(e => ({
    id: e.id,
    name: e.name,
    aliases: e.aliases || [],
    occurrences: Number(e.occurrences || 0),
    usedInProductCount: Number(e.usedInProductCount || 0),
    status: e.status,
    usda: e.usda || null,
    usdaError: e.usdaError || null,
    nutrition: e.nutrition || null,
    source: e.source || null,
    priority: Number(e.usedInProductCount || 0) * 1000 + Number(e.occurrences || 0)
  }))
  .sort((a, b) => b.priority - a.priority);

const output = {
  version: '1.0.0',
  restaurantId: db.restaurantId || 'poster-test',
  total: review.length,
  instructions: 'Fill only confirmed values. Do not invent nutrition data. Values are per 100g.',
  fields: ['kcalPer100g', 'proteinPer100g', 'fatPer100g', 'carbsPer100g', 'source', 'verified'],
  entries: review
};

fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
console.log(`[CIA Nutrition Review] entries: ${review.length}`);
console.log(`[CIA Nutrition Review] output: ${outPath}`);
