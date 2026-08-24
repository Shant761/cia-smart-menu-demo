const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const manualPath = path.join(root, 'data', 'cia-nutrition-manual-top20.json');
const dbPath = path.join(root, 'data', 'nutrition-database.json');
const outPath = path.join(root, 'data', 'cia-nutrition-database.json');

const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const manualById = new Map((manual.entries || []).map(e => [String(e.id), e]));

const entries = (db.entries || []).map(entry => {
  const m = manualById.get(String(entry.id));
  if (!m || m.verified !== true) return entry;
  return {
    ...entry,
    nutrition: {
      kcalPer100g: Number(m.kcalPer100g),
      proteinPer100g: Number(m.proteinPer100g),
      fatPer100g: Number(m.fatPer100g),
      carbsPer100g: Number(m.carbsPer100g)
    },
    source: m.source || 'CIA manual',
    sourceReference: m.sourceReference || null,
    verified: true,
    status: 'verified'
  };
});

const result = {
  ...db,
  version: db.version || '1.0.0',
  entries,
  manualVerifiedCount: entries.filter(e => e.verified === true).length
};

fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
console.log(`[CIA Nutrition] merged database entries: ${entries.length}`);
console.log(`[CIA Nutrition] verified entries: ${result.manualVerifiedCount}`);
console.log(`[CIA Nutrition] output: ${outPath}`);
