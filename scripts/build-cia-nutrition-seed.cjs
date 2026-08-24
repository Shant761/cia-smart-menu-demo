const fs = require('fs');
const path = require('path');

const inputPath = path.join(__dirname, '..', 'data', 'nutrition-review-queue.json');
const outputPath = path.join(__dirname, '..', 'data', 'nutrition-database.json');

if (!fs.existsSync(inputPath)) {
  throw new Error(`Missing nutrition review queue: ${inputPath}`);
}

const queue = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const entries = Array.isArray(queue.entries) ? queue.entries : [];

const database = {
  version: '1.0.0',
  source: 'CIA Nutrition Database',
  policy: 'Only verified CIA nutrition values may be published.',
  entries: entries.map((item) => ({
    id: item.id,
    name: item.name,
    aliases: Array.isArray(item.aliases) ? item.aliases : [],
    kcalPer100g: null,
    proteinPer100g: null,
    fatPer100g: null,
    carbsPer100g: null,
    source: null,
    verified: false,
    status: 'needs_nutrition'
  }))
};

fs.writeFileSync(outputPath, JSON.stringify(database, null, 2) + '\n');
console.log(`[CIA nutrition stage 2B] Review entries prepared: ${database.entries.length}`);
console.log('[CIA nutrition stage 2B] No nutrition values were invented or assigned.');
