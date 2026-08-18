const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PROJECT_ID = 'cia-smart-menu';
const RULES_PATH = path.join(process.cwd(), 'data', 'ingredient-normalization-rules.json');

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const serviceAccount = JSON.parse(requiredEnv('FIREBASE_SERVICE_ACCOUNT'));
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();

if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(restaurantId)) {
  throw new Error('CIA_RESTAURANT_ID must contain only letters, numbers, _ or -');
}

const ruleConfig = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
const rules = Array.isArray(ruleConfig.ingredients) ? ruleConfig.ingredients : [];
const rulesVersion = Number(ruleConfig.version || 1);

initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

function cleanText(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ');
}

function matchKey(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[“”„«»"'`´]/g, '')
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/[.,;:!?/\\|+_=]/g, ' ')
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function strippedKey(value) {
  return matchKey(value)
    .replace(/\b\d+(?:[.,]\d+)?\s*%\b/g, ' ')
    .replace(/\b(свежий|свежая|свежее|свежие|замороженный|замороженная|замороженные|очищенный|очищенная|очищенные|сырой|сырая|сырые|fresh|frozen|peeled|raw)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectLanguage(value) {
  const text = cleanText(value);
  const hasHy = /[\u0530-\u058F]/.test(text);
  const hasRu = /[\u0400-\u04FF]/.test(text);
  const hasEn = /[A-Za-z]/.test(text);
  const count = Number(hasHy) + Number(hasRu) + Number(hasEn);
  if (count > 1) return 'mixed';
  if (hasHy) return 'hy';
  if (hasRu) return 'ru';
  if (hasEn) return 'en';
  return 'unknown';
}

const aliasIndex = new Map();
const searchableAliases = [];
const genericContainsAliases = new Set([
  'масло', 'oil', 'сыр', 'cheese', 'соус', 'sauce', 'мясо', 'meat',
  'рыба', 'fish', 'bread', 'хлеб', 'milk', 'молоко', 'cream', 'сливки',
  'лук', 'onion', 'перец', 'pepper', 'flour', 'мука'
]);

for (const rule of rules) {
  for (const alias of rule.aliases || []) {
    const key = matchKey(alias);
    if (!key) continue;
    if (!aliasIndex.has(key)) aliasIndex.set(key, rule);
    if (key.length >= 5 && !genericContainsAliases.has(key)) {
      searchableAliases.push({ key, rule });
    }
  }
}

searchableAliases.sort((a, b) => b.key.length - a.key.length);

const allergenKeywordRules = [
  { id: 'milk', terms: ['կաթ', 'սերուց', 'կարագ', 'պանիր', 'молок', 'сливк', 'сметан', 'сыр', 'butter', 'milk', 'cream', 'cheese'] },
  { id: 'egg', terms: ['ձու', 'яйц', 'egg', 'майонез', 'mayonnaise', 'mayo'] },
  { id: 'gluten', terms: ['ալյուր', 'ցորեն', 'мук', 'пшен', 'хлеб', 'сухар', 'паста', 'макарон', 'flour', 'wheat', 'bread', 'pasta', 'breadcrumbs'] },
  { id: 'fish', terms: ['ձուկ', 'սաղմոն', 'թունա', 'рыб', 'лосос', 'семг', 'тун', 'fish', 'salmon', 'tuna'] },
  { id: 'crustaceans', terms: ['ծովախեցգետ', 'кревет', 'shrimp', 'prawn'] },
  { id: 'molluscs', terms: ['կաղամար', 'միդիա', 'кальмар', 'миди', 'squid', 'mussel'] },
  { id: 'peanuts', terms: ['գետնանուշ', 'арахис', 'peanut'] },
  { id: 'nuts', terms: ['ընկույզ', 'նուշ', 'орех', 'миндал', 'walnut', 'almond', 'hazelnut', 'pistach'] },
  { id: 'soy', terms: ['սոյ', 'соев', 'соя', 'soy', 'tofu', 'тофу'] },
  { id: 'mustard', terms: ['մանանեխ', 'горчиц', 'mustard'] },
  { id: 'sesame', terms: ['քնջութ', 'кунжут', 'sesame'] },
  { id: 'celery', terms: ['նեխուր', 'сельдер', 'celery'] }
];

const preparedTerms = [
  'սոուս', 'կրեմ', 'մարինադ', 'խմոր', 'արգանակ',
  'соус', 'крем', 'маринад', 'тесто', 'бульон', 'заправка', 'пюре',
  'sauce', 'cream', 'marinade', 'dough', 'stock', 'broth', 'dressing', 'puree'
];

function containsTerm(key, term) {
  return key.includes(matchKey(term));
}

function findRule(name) {
  const exact = matchKey(name);
  const stripped = strippedKey(name);

  if (aliasIndex.has(exact)) return { rule: aliasIndex.get(exact), match: 'exact', matchedAlias: exact };
  if (stripped && aliasIndex.has(stripped)) return { rule: aliasIndex.get(stripped), match: 'stripped_exact', matchedAlias: stripped };

  const hits = [];
  for (const candidate of searchableAliases) {
    if (exact.includes(candidate.key)) hits.push(candidate);
    if (hits.length > 8) break;
  }

  if (!hits.length) return null;
  const canonicalIds = new Set(hits.map((hit) => hit.rule.canonicalId));
  if (canonicalIds.size !== 1) return null;
  return { rule: hits[0].rule, match: 'contained_alias', matchedAlias: hits[0].key };
}

function allergenHints(name) {
  const key = matchKey(name);
  const found = [];
  for (const rule of allergenKeywordRules) {
    if (rule.terms.some((term) => containsTerm(key, term))) {
      found.push({
        id: rule.id,
        confidence: 0.55,
        source: 'rule_keyword',
        reason: `Ingredient name matched ${rule.id} keyword; candidate only, not verified.`
      });
    }
  }
  return found;
}

function isPreparedComponent(name) {
  const key = matchKey(name);
  return preparedTerms.some((term) => containsTerm(key, term));
}

function exactAllergenCandidates(ids) {
  return (ids || []).map((id) => ({
    id,
    confidence: 0.92,
    source: 'rule_dictionary',
    reason: 'Deterministic ingredient dictionary match; still requires recipe/restaurant verification.'
  }));
}

async function commitWrites(writes) {
  const size = 400;
  for (let offset = 0; offset < writes.length; offset += size) {
    const batch = db.batch();
    for (const write of writes.slice(offset, offset + size)) {
      batch.set(write.ref, write.data, { merge: true });
    }
    await batch.commit();
  }
}

async function main() {
  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  if (!(await restaurantRef.get()).exists) throw new Error(`Restaurant ${restaurantId} was not found`);

  const snapshot = await restaurantRef.collection('ingredients_catalog').get();
  const active = snapshot.docs
    .map((doc) => ({ id: doc.id, ref: doc.ref, ...doc.data() }))
    .filter((item) => item.activeInMenu !== false)
    .sort((a, b) => (b.occurrences || 0) - (a.occurrences || 0));

  const writes = [];
  const unmatched = [];
  let matched = 0;
  let exact = 0;
  let contained = 0;
  let protectedCount = 0;
  let hinted = 0;

  for (const item of active) {
    const primaryName = cleanText(item.primaryName || (item.sourceNames || [])[0]);
    if (!primaryName) continue;

    const sourceLanguage = detectLanguage(primaryName);
    const protectedByRestaurant = item.restaurantVerified === true;
    const protectedByAi = item.ai?.sourceHash && item.ai.sourceHash === item.sourceHash;

    if (protectedByRestaurant || protectedByAi) {
      protectedCount += 1;
      continue;
    }

    const found = findRule(primaryName);
    const hints = allergenHints(primaryName);
    if (hints.length) hinted += 1;

    if (found) {
      const rule = found.rule;
      matched += 1;
      if (found.match === 'contained_alias') contained += 1;
      else exact += 1;

      writes.push({
        ref: item.ref,
        data: {
          canonicalId: rule.canonicalId,
          translations: rule.names,
          sourceLanguage,
          foodCategory: rule.category || 'unknown',
          isPreparedComponent: isPreparedComponent(primaryName) || rule.category === 'sauce',
          allergenCandidates: exactAllergenCandidates(rule.allergens),
          nutritionLookupQuery: rule.names?.en || rule.canonicalId,
          analysisStatus: 'rule_analyzed',
          normalizedSourceName: matchKey(primaryName),
          ruleNormalization: {
            version: rulesVersion,
            sourceHash: item.sourceHash || null,
            match: found.match,
            matchedAlias: found.matchedAlias,
            canonicalId: rule.canonicalId,
            analyzedAt: FieldValue.serverTimestamp()
          },
          updatedAt: FieldValue.serverTimestamp()
        }
      });
    } else {
      writes.push({
        ref: item.ref,
        data: {
          sourceLanguage,
          normalizedSourceName: matchKey(primaryName),
          isPreparedComponent: isPreparedComponent(primaryName),
          ruleAllergenCandidates: hints,
          ruleNormalization: {
            version: rulesVersion,
            sourceHash: item.sourceHash || null,
            match: hints.length ? 'keyword_only' : 'unmatched',
            analyzedAt: FieldValue.serverTimestamp()
          },
          updatedAt: FieldValue.serverTimestamp()
        }
      });

      unmatched.push({
        id: item.id,
        name: primaryName,
        occurrences: Number(item.occurrences || 0),
        hints: hints.map((hint) => hint.id)
      });
    }
  }

  await commitWrites(writes);

  await restaurantRef.set({
    ruleIngredientNormalization: {
      version: rulesVersion,
      lastRunAt: FieldValue.serverTimestamp(),
      activeIngredients: active.length,
      matched,
      unmatched: unmatched.length,
      protected: protectedCount
    },
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(`[Rules normalizer] Restaurant: ${restaurantId}`);
  console.log(`[Rules normalizer] Active ingredients: ${active.length}`);
  console.log(`[Rules normalizer] Matched: ${matched} (exact/stripped=${exact}, contained=${contained})`);
  console.log(`[Rules normalizer] Unmatched: ${unmatched.length}`);
  console.log(`[Rules normalizer] Allergen keyword hints on unmatched/matched names: ${hinted}`);
  console.log(`[Rules normalizer] Protected AI/restaurant records skipped: ${protectedCount}`);

  if (unmatched.length) {
    console.log('[Rules normalizer] Top unmatched ingredients:');
    for (const item of unmatched.slice(0, 120)) {
      const hintText = item.hints.length ? ` hints=${item.hints.join(',')}` : '';
      console.log(`- ${item.id} | uses=${item.occurrences} | ${item.name}${hintText}`);
    }
  }
}

main().catch((error) => {
  console.error(`[Rules normalizer] FAILED: ${error?.message || error}`);
  process.exit(1);
});
