const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PROJECT_ID = 'cia-smart-menu';
const DATA_DIR = path.join(process.cwd(), 'data');

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clean(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function key(value) {
  return clean(value)
    .toLocaleLowerCase('und')
    .replace(/ё/g, 'е')
    .replace(/[“”„«»"'`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(value) {
  return key(value).replace(/\s+/g, '');
}

const GENERIC_TOKENS = new Set([
  'соус', 'крем', 'сыр', 'масло', 'свежий', 'свежая', 'свежее', 'свежие',
  'очищенный', 'очищенная', 'для', 'из', 'на', 'с', 'и', 'the', 'with', 'for',
  'sauce', 'cream', 'cheese', 'oil', 'fresh'
]);

function tokens(value) {
  return key(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !GENERIC_TOKENS.has(token));
}

function tokenCompatible(a, b) {
  const aa = tokens(a);
  const bb = tokens(b);
  if (!aa.length || !bb.length) return false;
  return aa.some((left) => bb.some((right) => {
    const min = Math.min(left.length, right.length);
    if (min < 4) return left === right;
    const stem = Math.min(5, min);
    return left.slice(0, stem) === right.slice(0, stem);
  }));
}

function textCompatible(source, expected) {
  const a = compact(source);
  const b = compact(expected);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 5 && (a.includes(b) || b.includes(a))) return true;
  return tokenCompatible(source, expected);
}

function sourceNames(item) {
  const values = [item.primaryName, ...(Array.isArray(item.sourceNames) ? item.sourceNames : [])]
    .map(clean)
    .filter(Boolean);
  return [...new Set(values)];
}

function validateRuleSource(item, rule) {
  const actual = sourceNames(item);
  const explicit = Array.isArray(rule.expectedSourceNames)
    ? rule.expectedSourceNames.map(clean).filter(Boolean)
    : rule.expectedSourceName ? [clean(rule.expectedSourceName)] : [];

  const expected = explicit.length
    ? explicit
    : [rule.names?.ru, rule.names?.hy, rule.names?.en].map(clean).filter(Boolean);

  for (const source of actual) {
    for (const target of expected) {
      if (textCompatible(source, target)) {
        return { valid: true, source, expected: target, mode: explicit.length ? 'explicit_source' : 'name_similarity' };
      }
    }
  }

  return {
    valid: false,
    source: actual[0] || '',
    expected: expected[0] || '',
    mode: explicit.length ? 'explicit_source_mismatch' : 'name_mismatch'
  };
}

function loadOverridePacks(restaurantId) {
  const safe = escapeRegex(restaurantId);
  const matcher = new RegExp(`^${safe}-ingredient-overrides(?:-v(\\d+))?\\.json$`);
  const files = fs.readdirSync(DATA_DIR)
    .map((name) => {
      const match = name.match(matcher);
      if (!match) return null;
      return { name, versionFromName: match[1] ? Number(match[1]) : 1 };
    })
    .filter(Boolean)
    .sort((a, b) => a.versionFromName - b.versionFromName || a.name.localeCompare(b.name));

  if (!files.length) return { files: [], entries: {}, version: 0 };

  const entries = {};
  let version = 0;
  for (const file of files) {
    const config = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file.name), 'utf8'));
    if (config.restaurantId && config.restaurantId !== restaurantId) {
      throw new Error(`${file.name} restaurantId=${config.restaurantId} does not match ${restaurantId}`);
    }
    version = Math.max(version, Number(config.version || file.versionFromName || 1));
    if (config.ingredients && typeof config.ingredients === 'object') Object.assign(entries, config.ingredients);
  }
  return { files: files.map((item) => item.name), entries, version };
}

const serviceAccount = JSON.parse(requiredEnv('FIREBASE_SERVICE_ACCOUNT'));
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const packs = loadOverridePacks(restaurantId);
if (!packs.files.length) {
  console.log(`[Ingredient overrides] No override files for ${restaurantId}; nothing to do.`);
  process.exit(0);
}

initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

function allergenCandidates(ids) {
  return (ids || []).map((id) => ({
    id,
    confidence: 0.95,
    source: 'restaurant_rule_override',
    reason: 'Source-name validated deterministic mapping; candidate until restaurant verification.'
  }));
}

async function commitWrites(writes) {
  for (let offset = 0; offset < writes.length; offset += 400) {
    const batch = db.batch();
    for (const write of writes.slice(offset, offset + 400)) batch.set(write.ref, write.data, { merge: true });
    await batch.commit();
  }
}

async function main() {
  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  if (!(await restaurantRef.get()).exists) throw new Error(`Restaurant ${restaurantId} was not found`);

  const catalog = await restaurantRef.collection('ingredients_catalog').get();
  const byPosterId = new Map();
  for (const doc of catalog.docs) {
    const data = doc.data();
    if (data.posterIngredientId !== null && data.posterIngredientId !== undefined) {
      byPosterId.set(String(data.posterIngredientId), { ref: doc.ref, id: doc.id, ...data });
    }
  }

  const writes = [];
  const rejected = [];
  let applied = 0;
  let missing = 0;
  let protectedCount = 0;
  let needsReview = 0;

  for (const [posterId, rule] of Object.entries(packs.entries)) {
    const item = byPosterId.get(String(posterId));
    if (!item) {
      missing += 1;
      continue;
    }

    if (item.restaurantVerified === true || (item.ai?.sourceHash && item.ai.sourceHash === item.sourceHash)) {
      protectedCount += 1;
      continue;
    }

    const validation = validateRuleSource(item, rule);
    const validationData = {
      valid: validation.valid,
      mode: validation.mode,
      rawSourceName: validation.source,
      expectedSourceName: validation.expected,
      sourceHash: item.sourceHash || null,
      overrideVersion: packs.version,
      checkedAt: FieldValue.serverTimestamp()
    };

    if (!validation.valid) {
      rejected.push({ posterId, raw: validation.source, intended: rule.names?.ru || rule.canonicalId || '' });
      writes.push({
        ref: item.ref,
        data: {
          sourceValidation: validationData,
          analysisStatus: 'source_mismatch',
          updatedAt: FieldValue.serverTimestamp()
        }
      });
      continue;
    }

    if (rule.needsReview === true) needsReview += 1;
    writes.push({
      ref: item.ref,
      data: {
        canonicalId: rule.canonicalId,
        translations: rule.names || {},
        foodCategory: rule.category || 'unknown',
        isPreparedComponent: rule.prepared === true,
        allergenCandidates: allergenCandidates(rule.allergens),
        nutritionLookupQuery: rule.names?.en || rule.canonicalId,
        analysisStatus: rule.needsReview === true ? 'needs_review' : 'rule_analyzed',
        sourceValidation: validationData,
        restaurantRuleOverride: {
          version: packs.version,
          sourceFiles: packs.files,
          posterIngredientId: String(posterId),
          sourceHash: item.sourceHash || null,
          needsReview: rule.needsReview === true,
          appliedAt: FieldValue.serverTimestamp()
        },
        updatedAt: FieldValue.serverTimestamp()
      }
    });
    applied += 1;
  }

  await commitWrites(writes);

  const refreshed = await restaurantRef.collection('ingredients_catalog').get();
  const active = refreshed.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((item) => item.activeInMenu !== false);
  const trusted = active.filter((item) => item.restaurantVerified === true || item.sourceValidation?.valid === true || (item.ai?.sourceHash && item.ai.sourceHash === item.sourceHash));

  await restaurantRef.set({
    restaurantIngredientOverrides: {
      version: packs.version,
      sourceFiles: packs.files,
      lastRunAt: FieldValue.serverTimestamp(),
      configured: Object.keys(packs.entries).length,
      applied,
      rejected: rejected.length,
      missing,
      protected: protectedCount,
      needsReview,
      trustedMappings: trusted.length
    },
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(`[Ingredient overrides] Restaurant: ${restaurantId}`);
  console.log(`[Ingredient overrides] Packs: ${packs.files.join(', ')}`);
  console.log(`[Ingredient overrides] Configured unique Poster IDs: ${Object.keys(packs.entries).length}`);
  console.log(`[Ingredient overrides] Source-validated and applied: ${applied}`);
  console.log(`[Ingredient overrides] Rejected source mismatches: ${rejected.length}`);
  console.log(`[Ingredient overrides] Needs review among applied: ${needsReview}`);
  console.log(`[Ingredient overrides] Missing Poster IDs: ${missing}`);
  console.log(`[Ingredient overrides] Protected AI/restaurant records skipped: ${protectedCount}`);
  console.log(`[Ingredient overrides] Trusted active mappings after validation: ${trusted.length}/${active.length}`);

  if (rejected.length) {
    console.log('[Ingredient overrides] SOURCE MISMATCHES (rule blocked; Poster source remains authoritative):');
    for (const item of rejected.slice(0, 180)) {
      console.log(`- ${item.posterId} | Poster="${item.raw}" | rule="${item.intended}"`);
    }
  }
}

main().catch((error) => {
  console.error(`[Ingredient overrides] FAILED: ${error?.message || error}`);
  process.exit(1);
});
