const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'nutrition-database.json');
const customPath = path.join(__dirname, '..', 'data', 'cia-nutrition-custom.json');

if (!fs.existsSync(dbPath)) throw new Error(`Missing ${dbPath}`);
if (!fs.existsSync(customPath)) throw new Error(`Missing ${customPath}`);

const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const custom = JSON.parse(fs.readFileSync(customPath, 'utf8'));
const entries = Array.isArray(db.entries) ? db.entries : [];
const customEntries = Array.isArray(custom.entries) ? custom.entries : [];

const normalize = value => String(value || '').toLowerCase().trim().replace(/\s+/g, ' ');
const byName = new Map(entries.map(entry => [normalize(entry.name), entry]));
let applied = 0;

for (const customEntry of customEntries) {
  const key = normalize(customEntry.name);
  if (!key) continue;
  const target = byName.get(key);
  if (!target) continue;

  const values = ['kcalPer100g', 'proteinPer100g', 'fatPer100g', 'carbsPer100g'];
  if (!values.every(field => Number.isFinite(Number(customEntry[field])))) continue;

  for (const field of values) target[field] = Number(customEntry[field]);
  target.source = customEntry.source || 'CIA manual';
  target.verified = customEntry.verified === true;
  target.status = target.verified ? 'verified' : 'estimated';
  target.customNutrition = true;
  if (customEntry.notes) target.nutritionNotes = customEntry.notes;
  applied++;
}

fs.writeFileSync(dbPath, JSON.stringify(db, null, 2) + '\n');
console.log(`[CIA Custom Nutrition] custom entries: ${customEntries.length}`);
console.log(`[CIA Custom Nutrition] applied: ${applied}`);
console.log(`[CIA Custom Nutrition] database entries: ${entries.length}`);
