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
  'Energy (Atwater General Factors)': 'kcalPer100g',
  'Protein': 'proteinPer100g',
  'Total lipid (fat)': 'fatPer100g',
  'Carbohydrate, by difference': 'carbsPer100g'
};

const substitutions = [
  [/\/шт\.?/gi, ''], [/\/кг/gi, ''], [/\/г/gi, ''], [/\/л/gi, ''],
  [/\/чищен(?:ный|ная|ное|ые)?/gi, ''], [/\/тесто/gi, ' dough'],
  [/\/начинка/gi, ' filling'], [/\/измельчен(?:ный|ная|ное|ые)?/gi, ''],
  [/\/нарезан(?:ный|ная|ное|ые)?/gi, ''], [/\s+/g, ' ']
];

const translations = new Map([
  ['ананас', 'pineapple'], ['броколли', 'broccoli'], ['брокколи', 'broccoli'],
  ['лимон', 'lemon'], ['лайм', 'lime'], ['петрушка', 'parsley'], ['тархун', 'tarragon'],
  ['арбуз', 'watermelon'], ['дыня', 'melon'], ['яблоко', 'apple'], ['банан', 'banana'],
  ['апельсин', 'orange'], ['мандарин', 'mandarin orange'], ['груша', 'pear'],
  ['клубника', 'strawberry'], ['малина', 'raspberry'], ['черника', 'blueberry'],
  ['виноград', 'grape'], ['персик', 'peach'], ['абрикос', 'apricot'],
  ['морковь', 'carrot'], ['картофель', 'potato'], ['помидор', 'tomato'],
  ['огурец', 'cucumber'], ['лук', 'onion'], ['чеснок', 'garlic'], ['капуста', 'cabbage'],
  ['свекла', 'beet'], ['шпинат', 'spinach'], ['салат', 'lettuce'],
  ['курица', 'chicken'], ['куриное филе', 'chicken breast'], ['говядина', 'beef'],
  ['свинина', 'pork'], ['баранина', 'lamb'], ['рыба', 'fish'], ['лосось', 'salmon'],
  ['тунец', 'tuna'], ['креветка', 'shrimp'], ['яйцо', 'egg'], ['молоко', 'milk'],
  ['сливки', 'cream'], ['масло сливочное', 'butter'], ['масло растительное', 'vegetable oil'],
  ['сыр', 'cheese'], ['мука', 'flour'], ['рис', 'rice'], ['гречка', 'buckwheat'],
  ['макароны', 'pasta'], ['сахар', 'sugar'], ['мед', 'honey'], ['соль', 'salt'],
  ['орех', 'nut'], ['миндаль', 'almond'], ['грецкий орех', 'walnut'],
  ['арахис', 'peanut'], ['шоколад', 'chocolate'], ['какао', 'cocoa']
]);

function normalize(s) {
  let value = String(s || '').toLowerCase();
  for (const [re, replacement] of substitutions) value = value.replace(re, replacement);
  return value.replace(/[^a-z0-9а-яё]+/gi, ' ').replace(/\s+/g, ' ').trim();
}

function translatedVariants(value) {
  const clean = normalize(value);
  const variants = new Set([clean]);
  for (const [ru, en] of translations) {
    if (clean.includes(ru)) variants.add(clean.replaceAll(ru, en));
  }
  const words = clean.split(' ');
  const translatedWords = words.map(w => translations.get(w) || w);
  variants.add(translatedWords.join(' '));
  return [...variants].filter(Boolean);
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
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: String(query).trim(), pageSize: 10, dataType: ['Foundation', 'SR Legacy'] })
  });
  if (!res.ok) {
    const body = await res.text();
    const error = new Error(`USDA search failed: ${res.status}`);
    error.status = res.status; error.response = body.slice(0, 500); throw error;
  }
  return res.json();
}

async function getFood(fdcId) {
  const res = await fetch(`https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${encodeURIComponent(API_KEY)}`);
  if (!res.ok) {
    const body = await res.text();
    const error = new Error(`USDA food fetch failed: ${res.status}`);
    error.status = res.status; error.response = body.slice(0, 500); throw error;
  }
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
  let matched = 0, review = 0, notFound = 0, apiErrors = 0;

  for (const entry of entries) {
    if (entry.verified) continue;
    const queries = [...new Set([
      entry.name,
      ...(entry.aliases || []),
      ...translatedVariants(entry.name),
      ...translatedVariants((entry.aliases || [])[0] || '')
    ])].filter(Boolean).slice(0, 8);

    let best = null;
    let hadApiError = false;

    for (const query of queries) {
      try {
        const result = await searchFood(query);
        for (const food of result.foods || []) {
          const s = Math.max(score(entry.name, food.description), score(query, food.description));
          if (!best || s > best.score) best = { food, score: s, query };
        }
      } catch (error) {
        hadApiError = true;
        apiErrors++;
        entry.status = 'api_error';
        entry.usdaError = { stage: 'search', status: error.status || null, message: error.message, response: error.response || null };
        console.log(`[USDA] API error for "${entry.name}" using "${query}": ${error.message}`);
        break;
      }
    }

    if (hadApiError) continue;
    if (!best) { entry.status = 'not_found'; notFound++; continue; }

    if (best.score < 0.8) {
      entry.status = 'needs_review';
      entry.usda = { fdcId: best.food.fdcId, description: best.food.description, matchScore: best.score, query: best.query };
      review++;
      continue;
    }

    try {
      const food = await getFood(best.food.fdcId);
      const values = extract(food);
      const complete = ['kcalPer100g', 'proteinPer100g', 'fatPer100g', 'carbsPer100g'].every(k => Number.isFinite(values[k]));
      if (!complete) {
        entry.status = 'needs_review';
        entry.usda = { fdcId: food.fdcId, description: food.description, matchScore: best.score, query: best.query };
        review++;
        continue;
      }
      Object.assign(entry, values);
      entry.source = `USDA FoodData Central FDC ${food.fdcId}`;
      entry.usda = { fdcId: food.fdcId, description: food.description, matchScore: best.score, query: best.query };
      entry.verified = true; entry.status = 'verified'; delete entry.usdaError; matched++;
    } catch (error) {
      apiErrors++;
      entry.status = 'api_error';
      entry.usdaError = { stage: 'food', status: error.status || null, message: error.message, response: error.response || null };
      console.log(`[USDA] API error fetching "${entry.name}": ${error.message}`);
    }
  }

  fs.writeFileSync(inputPath, JSON.stringify(db, null, 2) + '\n');
  console.log(`USDA enrichment complete: verified=${matched}, needs_review=${review}, not_found=${notFound}, api_errors=${apiErrors}, total=${entries.length}`);
})();
