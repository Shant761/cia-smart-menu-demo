const fs = require('fs');
const path = require('path');

const topPath = path.join(__dirname, '..', 'data', 'cia-nutrition-priority-top20.json');
const outPath = path.join(__dirname, '..', 'data', 'cia-nutrition-manual-top20.json');

if (!fs.existsSync(topPath)) throw new Error(`Missing ${topPath}`);
const top = JSON.parse(fs.readFileSync(topPath, 'utf8'));
const entries = Array.isArray(top.entries) ? top.entries : [];

const manual = {
  version: '1.0.0',
  restaurantId: top.restaurantId || 'poster-test',
  description: 'CIA manual nutrition records. Fill only confirmed values. Values are per 100g.',
  calculationBasis: 'per 100g',
  entries: entries.map((e) => ({
    priority: e.priority,
    id: e.id,
    name: e.name,
    aliases: e.aliases || [],
    usedInProductCount: e.usedInProductCount || 0,
    occurrences: e.occurrences || 0,
    kcalPer100g: null,
    proteinPer100g: null,
    fatPer100g: null,
    carbsPer100g: null,
    source: null,
    sourceReference: null,
    verified: false,
    status: 'needs_review'
  }))
};

fs.writeFileSync(outPath, JSON.stringify(manual, null, 2) + '\n');
console.log(`[CIA Nutrition Manual] templates created: ${manual.entries.length}`);
console.log(`[CIA Nutrition Manual] output: ${outPath}`);
