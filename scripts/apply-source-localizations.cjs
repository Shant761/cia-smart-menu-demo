const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PROJECT_ID = 'cia-smart-menu';
const DATA_DIR = path.join(process.cwd(), 'data');
const restaurantId = (process.env.CIA_RESTAURANT_ID || 'poster-test').trim();
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
if (!serviceAccount.client_email) throw new Error('FIREBASE_SERVICE_ACCOUNT is required');

const clean = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function loadJsonPacks(prefix, keyName) {
  const re = new RegExp(`^${escapeRegex(restaurantId)}-${prefix}(?:-v(\\d+))?\\.json$`);
  const files = fs.readdirSync(DATA_DIR).map((name) => {
    const match = name.match(re);
    return match ? { name, version: Number(match[1] || 1) } : null;
  }).filter(Boolean).sort((a, b) => a.version - b.version || a.name.localeCompare(b.name));
  const entries = {};
  let version = 0;
  for (const file of files) {
    const config = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file.name), 'utf8'));
    version = Math.max(version, Number(config.version || file.version));
    if (config.restaurantId && config.restaurantId !== restaurantId) continue;
    for (const [id, value] of Object.entries(config[keyName] || {})) entries[String(id)] = value;
  }
  return { files: files.map((file) => file.name), entries, version };
}

initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

async function main() {
  const productsPack = loadJsonPacks('product-translations', 'products');
  const ingredientPack = loadJsonPacks('ingredient-overrides', 'ingredients');
  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  const snapshot = await restaurantRef.collection('products').get();
  const writes = [];
  let productTranslations = 0;
  let ingredientTranslations = 0;
  let allergenUpdates = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const productId = String(doc.id);
    const productRule = productsPack.entries[productId];
    let next = {};

    if (productRule && clean(productRule.ru) && clean(productRule.en)) {
      const current = data.name || {};
      const hy = clean(productRule.hy) || clean(current.hy) || clean(data.posterOriginalName);
      next.name = { ru: clean(productRule.ru), en: clean(productRule.en), hy };
      next.titleTranslation = {
        version: productsPack.version,
        method: 'curated_without_external_api',
        matchedBy: 'poster_product_id',
        sourceText: clean(data.posterOriginalName || current.hy || current.ru || current.en),
        updatedAt: FieldValue.serverTimestamp()
      };
      productTranslations += 1;
    }

    const ingredients = Array.isArray(data.ingredients) ? data.ingredients : [];
    if (ingredients.length) {
      let changed = false;
      const localizedIngredients = ingredients.map((ingredient) => {
        const id = ingredient?.ingredientId ?? ingredient?.posterIngredientId ?? ingredient?.id;
        const rule = id != null ? ingredientPack.entries[String(id)] : null;
        if (!rule?.names) return ingredient;
        const names = rule.names;
        const updated = {
          ...ingredient,
          name: clean(names.ru) || clean(ingredient.name),
          names: {
            ru: clean(names.ru) || clean(ingredient.name),
            en: clean(names.en) || clean(ingredient.name),
            hy: clean(names.hy) || clean(ingredient.name)
          },
          canonicalId: rule.canonicalId || ingredient.canonicalId || null
        };
        if (JSON.stringify(updated) !== JSON.stringify(ingredient)) changed = true;
        return updated;
      });
      if (changed) {
        next.ingredients = localizedIngredients;
        next.ingredientLocalization = {
          version: ingredientPack.version,
          sourceFiles: ingredientPack.files,
          method: 'curated_by_poster_ingredient_id',
          updatedAt: FieldValue.serverTimestamp()
        };
        ingredientTranslations += 1;
      }

      const overrideAllergens = new Set(
        ingredients.flatMap((ingredient) => {
          const id = ingredient?.ingredientId ?? ingredient?.posterIngredientId ?? ingredient?.id;
          return id != null && ingredientPack.entries[String(id)]?.allergens || [];
        })
      );
      if (overrideAllergens.size) {
        const existing = Array.isArray(data.allergens) ? data.allergens : [];
        const merged = [...new Set([...existing.map((item) => typeof item === 'string' ? item : item?.id).filter(Boolean), ...overrideAllergens])]
          .map((id) => ({ id, status: 'suggested', source: 'restaurant_rule_override' }));
        next.allergens = merged;
        allergenUpdates += 1;
      }
    }

    if (Object.keys(next).length) {
      next.updatedAt = FieldValue.serverTimestamp();
      writes.push({ ref: doc.ref, data: next });
    }
  }

  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    writes.slice(i, i + 400).forEach((write) => batch.set(write.ref, write.data, { merge: true }));
    await batch.commit();
  }

  await restaurantRef.set({
    sourceLocalization: {
      productVersion: productsPack.version,
      ingredientVersion: ingredientPack.version,
      productPacks: productsPack.files,
      ingredientPacks: ingredientPack.files,
      productsApplied: productTranslations,
      productsWithIngredientUpdates: ingredientTranslations,
      allergenUpdates,
      lastRunAt: FieldValue.serverTimestamp()
    },
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(`[Source localization] ${restaurantId}: products=${productTranslations}, ingredient-updates=${ingredientTranslations}, allergen-updates=${allergenUpdates}`);
}

main().catch((error) => {
  console.error(`[Source localization] FAILED: ${error?.message || error}`);
  process.exit(1);
});
