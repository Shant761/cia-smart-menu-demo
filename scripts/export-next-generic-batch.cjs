const fs = require('node:fs');
const path = require('node:path');

const input = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'cia-nutrition-research-queue.json'), 'utf8'));
const entries = Array.isArray(input?.entries) ? input.entries : [];
const candidates = entries
  .filter((entry) => entry?.kind === 'generic_ingredient' && entry?.verified !== true)
  .slice(0, 50)
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

const output = {
  version: '1.0.0',
  source: 'data/cia-nutrition-research-queue.json',
  remainingGenericCount: entries.filter((entry) => entry?.kind === 'generic_ingredient' && entry?.verified !== true).length,
  count: candidates.length,
  candidates
};
fs.writeFileSync(path.join(process.cwd(), 'data', 'cia-nutrition-next-generic.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`[next generic] remaining=${output.remainingGenericCount}; exported=${candidates.length}`);
