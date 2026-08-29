const fs = require('fs');
const path = require('path');

const input = path.join(__dirname, '..', 'data', 'cia-nutrition-research-queue.json');
const output = path.join(__dirname, '..', 'data', 'cia-nutrition-next-branded.json');
const data = JSON.parse(fs.readFileSync(input, 'utf8'));

const candidates = (data.entries || [])
  .filter((entry) => !entry.verified && entry.kind === 'branded_product')
  .map((entry) => ({
    priority: entry.priority,
    id: entry.id,
    posterIngredientId: entry.posterIngredientId,
    name: entry.name,
    aliases: entry.aliases || [],
    units: entry.units || [],
    usedInProductCount: entry.usedInProductCount || 0,
    searchQueries: entry.searchQueries || []
  }));

const payload = {
  version: '1.0.0',
  source: 'data/cia-nutrition-research-queue.json',
  count: candidates.length,
  candidates
};

fs.writeFileSync(output, JSON.stringify(payload, null, 2) + '\n');
console.log(`[CIA Nutrition] remaining branded candidates: ${candidates.length}`);
