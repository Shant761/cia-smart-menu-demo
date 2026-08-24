const fs = require('fs');
const path = require('path');

const inputPath = path.join(__dirname, '..', 'data', 'cia-nutrition-review.json');
const outputPath = path.join(__dirname, '..', 'data', 'cia-nutrition-priority-top20.json');

if (!fs.existsSync(inputPath)) throw new Error(`Missing ${inputPath}`);
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const entries = Array.isArray(input.entries) ? input.entries : [];

const top20 = entries
  .map((entry) => ({
    ...entry,
    usageScore: Number(entry.usedInProductCount || 0) * 1000 + Number(entry.occurrences || 0)
  }))
  .sort((a, b) => b.usageScore - a.usageScore)
  .slice(0, 20)
  .map((entry, index) => ({
    priority: index + 1,
    id: entry.id,
    name: entry.name,
    aliases: entry.aliases || [],
    usedInProductCount: Number(entry.usedInProductCount || 0),
    occurrences: Number(entry.occurrences || 0),
    status: entry.status,
    source: entry.source || null,
    usda: entry.usda || null,
    nutrition: entry.nutrition || null
  }));

const output = {
  version: '1.0.0',
  restaurantId: input.restaurantId || 'poster-test',
  generatedFrom: 'cia-nutrition-review.json',
  ranking: 'usedInProductCount * 1000 + occurrences',
  total: top20.length,
  entries: top20
};

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
console.log(`[CIA Nutrition Priority] top entries: ${top20.length}`);
console.log(`[CIA Nutrition Priority] output: ${outputPath}`);
for (const entry of top20) {
  console.log(`#${entry.priority} ${entry.name} | products=${entry.usedInProductCount} | occurrences=${entry.occurrences} | status=${entry.status}`);
}
