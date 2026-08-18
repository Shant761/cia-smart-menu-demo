const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PROJECT_ID = 'cia-smart-menu';
const OPENAI_URL = 'https://api.openai.com/v1/responses';
const ALLOWED_ALLERGENS = new Set([
  'gluten', 'crustaceans', 'egg', 'fish', 'peanuts', 'soy', 'milk',
  'nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs'
]);

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function intEnv(name, fallback, min, max) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

const serviceAccount = JSON.parse(requiredEnv('FIREBASE_SERVICE_ACCOUNT'));
const openAiKey = requiredEnv('OPENAI_API_KEY');
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const model = (process.env.OPENAI_MODEL || 'gpt-5.6').trim();
const limit = intEnv('AI_LIMIT', 25, 1, 500);
const batchSize = intEnv('AI_BATCH_SIZE', 10, 1, 25);
const force = String(process.env.AI_FORCE || 'false').toLowerCase() === 'true';

initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function snakeCase(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function stripCodeFence(text) {
  return String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function responseText(payload) {
  const chunks = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join('\n').trim();
}

function buildPrompt(items) {
  return `You are the CIA Smart Menu ingredient normalization engine for restaurant data in Armenia.

TASK
For every input ingredient:
1. Detect the source language (hy, ru, en, mixed, unknown).
2. Produce natural restaurant-quality translations in Armenian, Russian and English.
3. Normalize it to a stable English canonical food identity and snake_case canonicalId.
4. Classify the food/component.
5. Mark whether it appears to be a prepared component such as a sauce, dough, marinade, cream, stock, mixture or semi-finished recipe.
6. Suggest allergen CANDIDATES only. These are not medically confirmed facts and must later be checked against the real recipe / restaurant data.
7. Produce a short English nutritionLookupQuery suitable for matching this ingredient to a verified nutrition database later.
8. Give confidence 0..1 and whether restaurant review is needed.

IMPORTANT RULES
- Do NOT invent calories, protein, fat or carbohydrates.
- Do NOT claim an allergen is confirmed.
- Allowed allergen ids only: gluten, crustaceans, egg, fish, peanuts, soy, milk, nuts, celery, mustard, sesame, sulphites, lupin, molluscs.
- Preserve brand/product meaning where relevant.
- If an item is ambiguous (e.g. house sauce), set needsRestaurantReview=true and lower confidence.
- Context from sampleProducts may help disambiguate, but do not invent recipe ingredients.
- Return JSON only, no markdown.

OUTPUT SHAPE
{
  "items": [
    {
      "id": "same input id",
      "sourceLanguage": "hy|ru|en|mixed|unknown",
      "canonicalId": "snake_case_english_id",
      "names": {"hy":"...","ru":"...","en":"..."},
      "foodCategory": "short English category",
      "isPreparedComponent": false,
      "allergenCandidates": [
        {"id":"milk","confidence":0.95,"reason":"short reason"}
      ],
      "nutritionLookupQuery": "short English food lookup phrase",
      "confidence": 0.95,
      "needsRestaurantReview": false,
      "notes": ""
    }
  ]
}

INPUT
${JSON.stringify(items)}`;
}

async function callOpenAI(items) {
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openAiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input: buildPrompt(items)
    }),
    signal: AbortSignal.timeout(120000)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `HTTP ${response.status}`;
    throw new Error(`OpenAI request failed: ${message}`);
  }

  const text = responseText(payload);
  if (!text) throw new Error('OpenAI returned no output text');

  let parsed;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch (error) {
    throw new Error(`OpenAI returned invalid JSON: ${error.message}`);
  }

  if (!Array.isArray(parsed?.items)) {
    throw new Error('OpenAI JSON does not contain items[]');
  }
  return parsed.items;
}

function normalizeResult(result, source) {
  const names = result?.names || {};
  const canonicalId = snakeCase(result?.canonicalId || names.en || source.primaryName) || `ingredient_${source.id}`;
  const candidates = Array.isArray(result?.allergenCandidates)
    ? result.allergenCandidates
        .filter((item) => ALLOWED_ALLERGENS.has(String(item?.id || '').toLowerCase()))
        .map((item) => ({
          id: String(item.id).toLowerCase(),
          confidence: clamp01(item.confidence),
          reason: String(item.reason || '').slice(0, 240)
        }))
    : [];

  return {
    canonicalId,
    translations: {
      hy: String(names.hy || source.primaryName || '').trim(),
      ru: String(names.ru || source.primaryName || '').trim(),
      en: String(names.en || source.primaryName || '').trim()
    },
    sourceLanguage: ['hy', 'ru', 'en', 'mixed', 'unknown'].includes(result?.sourceLanguage)
      ? result.sourceLanguage
      : 'unknown',
    foodCategory: String(result?.foodCategory || 'unknown').trim().slice(0, 120),
    isPreparedComponent: result?.isPreparedComponent === true,
    allergenCandidates: candidates,
    nutritionLookupQuery: String(result?.nutritionLookupQuery || names.en || source.primaryName || '').trim().slice(0, 180),
    confidence: clamp01(result?.confidence),
    needsRestaurantReview: result?.needsRestaurantReview === true,
    notes: String(result?.notes || '').trim().slice(0, 500)
  };
}

async function main() {
  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  if (!(await restaurantRef.get()).exists) {
    throw new Error(`Restaurant ${restaurantId} was not found`);
  }

  const snapshot = await restaurantRef.collection('ingredients_catalog').get();
  const candidates = snapshot.docs
    .map((doc) => ({ id: doc.id, ref: doc.ref, ...doc.data() }))
    .filter((item) => item.activeInMenu !== false)
    .filter((item) => force || item.analysisStatus === 'pending_ai' || item.ai?.sourceHash !== item.sourceHash)
    .sort((a, b) => (b.occurrences || 0) - (a.occurrences || 0))
    .slice(0, limit);

  console.log(`[AI ingredients] Restaurant: ${restaurantId}`);
  console.log(`[AI ingredients] Model: ${model}`);
  console.log(`[AI ingredients] Selected: ${candidates.length}/${snapshot.size}; limit=${limit}; batch=${batchSize}; force=${force}`);

  if (!candidates.length) {
    console.log('[AI ingredients] Nothing to analyze.');
    return;
  }

  let analyzed = 0;
  let review = 0;

  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    const batch = candidates.slice(offset, offset + batchSize);
    const input = batch.map((item) => ({
      id: item.id,
      primaryName: item.primaryName,
      sourceNames: item.sourceNames || [],
      units: item.units || [],
      occurrences: item.occurrences || 0,
      sampleProducts: (item.sampleProducts || []).slice(0, 5)
    }));

    console.log(`[AI ingredients] Batch ${offset + 1}-${offset + batch.length}...`);
    const results = await callOpenAI(input);
    const byId = new Map(results.map((item) => [String(item?.id || ''), item]));
    const writeBatch = db.batch();

    for (const source of batch) {
      const raw = byId.get(source.id);
      if (!raw) throw new Error(`AI result missing ingredient ${source.id}`);
      const result = normalizeResult(raw, source);
      if (result.needsRestaurantReview || result.confidence < 0.82) review += 1;

      writeBatch.set(source.ref, {
        canonicalId: result.canonicalId,
        translations: result.translations,
        sourceLanguage: result.sourceLanguage,
        foodCategory: result.foodCategory,
        isPreparedComponent: result.isPreparedComponent,
        allergenCandidates: result.allergenCandidates,
        nutritionLookupQuery: result.nutritionLookupQuery,
        analysisStatus: result.needsRestaurantReview || result.confidence < 0.82 ? 'needs_review' : 'ai_analyzed',
        ai: {
          provider: 'openai',
          model,
          sourceHash: source.sourceHash || null,
          confidence: result.confidence,
          needsRestaurantReview: result.needsRestaurantReview,
          notes: result.notes,
          analyzedAt: FieldValue.serverTimestamp()
        },
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      analyzed += 1;
    }

    await writeBatch.commit();
  }

  await restaurantRef.set({
    aiIngredientAnalysis: {
      provider: 'openai',
      model,
      lastRunAt: FieldValue.serverTimestamp(),
      analyzedThisRun: analyzed,
      needsReviewThisRun: review
    },
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(`[AI ingredients] Success: analyzed=${analyzed}, needsReview=${review}`);
}

main().catch((error) => {
  const safe = String(error?.message || error).replaceAll(openAiKey, '[REDACTED_OPENAI_KEY]');
  console.error(`[AI ingredients] FAILED: ${safe}`);
  process.exit(1);
});
