const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dbPath = path.join(root, 'data', 'nutrition-database.json');
const manualPath = path.join(root, 'data', 'cia-nutrition-manual-top20.json');

const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFKC').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

const verified = (manual.entries || []).filter(e => e.verified === true);

for (const entry of db.entries || []) {
  const names = [entry.name, ...(entry.aliases || [])].map(normalize).filter(Boolean);
  const match = verified.find(m => {
    const candidates = [m.name, ...(m.aliases || [])].map(normalize).filter(Boolean);
    return candidates.some(c => names.includes(c));
  });

  if (!match) continue;

  entry.kcalPer100g = Number(match.kcalPer100g);
  entry.proteinPer100g = Number(match.proteinPer100g);
  entry.fatPer100g = Number(match.fatPer100g);
  entry.carbsPer100g = Number(match.carbsPer100g);
  entry.calories = Number(match.kcalPer100g);
  entry.protein = Number(match.proteinPer100g);
  entry.fat = Number(match.fatPer100g);
  entry.carbohydrates = Number(match.carbsPer100g);
  entry.source = match.source || 'CIA manual';
  entry.sourceReference = match.sourceReference || null;
  entry.verified = true;
  entry.status = 'verified';
}

fs.writeFileSync(dbPath, JSON.stringify(db, null, 2) + '\n');
console.log(`[CIA Nutrition] merged verified manual entries: ${verified.length}`);
console.log(`[CIA Nutrition] nutrition database updated: ${dbPath}`);
