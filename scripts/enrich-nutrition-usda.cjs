const fs = require('fs');
const path = require('path');

const API_KEY = process.env.USDA_API_KEY;
const inputPath = path.join(__dirname, '..', 'data', 'nutrition-database.json');

if (!API_KEY) throw new Error('USDA_API_KEY is required');
if (!fs.existsSync(inputPath)) throw new Error(`Missing ${inputPath}`);

const db = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const entries = Array.isArray(db.entries) ? db.entries : [];

const nutrientMap = {
  'Energy': 'kcalPer100g',
  'Protein': 'proteinPer100g',
  'Total lipid (fat)': 'fatPer100g',
  'Carbohydrate, by difference': 'carbsPer100g'
};

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9а-яё]+/gi, ' ').trim();
}

function score(query, desc) {
  const q = normalize(query).split(/\s+/).filter(Boolean);
  const d = normalize(desc);
  if (!q.length || !d) return 0;
  let hits = 0;
  for (const token of q) if (d.includes(token)) hits++;
  return hits / q.length;
}

async function searchFood(query) {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(API_KEY)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, pageSize: 10, dataType: ['Foundation', 'SR Legacy'] })
  });
  if (!res.ok) throw new Error(`USDA search failed: ${res.status}`);
  return res.json();
}

async function getFood(fdcId) {
  const res = await fetch(`https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${encodeURIComponent(API_KEY)}`);
  if (!res.ok) throw new Error(`USDA food fetch failed: ${res.status}`);
  return res.json();
}

function extract(food) {
  const out = {};
  for (const n of food.foodNutrients || []) {
    const name = n.nutrient?.name || n.name;
    const target = nutrientMap[name];
    if (!target) continue;
    const value = Number(n.amount);
    if (Number.isFinite(value)) out[target] = value;
  }
  return out;
}

(async () => {
  let matched = 0;
  let review = 0;

  for (const entry of entries) {
    if (entry.verified) continue;

    const candidates = [entry.name, ...(entry.aliases || [])].filter(Boolean);
    let best = null;

    for (const query of candidates.slice(0, 3)) {
      const result = await searchFood(query);
      for (const food of result.foods || []) {
        const s = score(entry.name, food.description);
        if (!best || s > best.score) best = { food, score: s };
      }
    }

    if (!best || best.score < 0.8) {
      entry.status = 'needs_review';
      review++;
      continue;
    }

    const food = await getFood(best.food.fdcId);
    const values = extract(food);
    const complete = ['kcalPer100g', 'proteinPer100g', 'fatPer100g', 'carbsPer100g'].every(k => Number.isFinite(values[k]));

    if (!complete) {
      entry.status = 'needs_review';
      entry.usda = { fdcId: food.fdcId, description: food.description };
      review++;
      continue;
    }

    Object.assign(entry, values);
    entry.source = `USDA FoodData Central FDC ${food.fdcId}`;
    entry.usda = { fdcId: food.fdcId, description: food.description };
    entry.verified = true;
    entry.status = 'verified';
    matched++;
  }

  fs.writeFileSync(inputPath, JSON.stringify(db, null, 2) + '\n');
  console.log(`USDA enrichment complete: verified=${matched}, needs_review=${review}, total=${entries.length}`);
})();
