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
const normalize = (value) => clean(value).toLocaleLowerCase('und');
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

// Fallback for common Poster/Armenian category names. A dedicated category pack can override these later.
const CATEGORY_TRANSLATIONS = [
  ['նախաճաշ', 'Завтраки', 'Breakfast'], ['աղցան', 'Салаты', 'Salads'], ['ապուր', 'Супы', 'Soups'],
  ['տաք ուտեստ', 'Горячие блюда', 'Hot dishes'], ['տաք ուտեստներ', 'Горячие блюда', 'Hot dishes'],
  ['սառը նախուտեստ', 'Холодные закуски', 'Cold appetizers'], ['նախուտեստ', 'Закуски', 'Appetizers'],
  ['միս', 'Мясо', 'Meat'], ['ձուկ', 'Рыба', 'Fish'], ['ծովամթերք', 'Морепродукты', 'Seafood'],
  ['պիցցա', 'Пицца', 'Pizza'], ['պաստա', 'Паста', 'Pasta'], ['հաց', 'Хлеб', 'Bread'],
  ['աղանդեր', 'Десерты', 'Desserts'], ['քաղցրավենիք', 'Сладости', 'Sweets'], ['պաղպաղակ', 'Мороженое', 'Ice cream'],
  ['մրգեր', 'Фрукты', 'Fruits'], ['բանջարեղեն', 'Овощи', 'Vegetables'], ['պանիր', 'Сыры', 'Cheese'],
  ['սոուս', 'Соусы', 'Sauces'], ['խմիչք', 'Напитки', 'Drinks'], ['ոչ ալկոհոլային', 'Безалкогольные напитки', 'Non-alcoholic drinks'],
  ['սուրճ', 'Кофе', 'Coffee'], ['թեյ', 'Чай', 'Tea'], ['կոկտեյլ', 'Коктейли', 'Cocktails'],
  ['գինի', 'Вино', 'Wine'], ['գարեջուր', 'Пиво', 'Beer'], ['օղի', 'Водка', 'Vodka'],
  ['ալկոհոլ', 'Алкоголь', 'Alcohol'], ['բուրգեր', 'Бургеры', 'Burgers'], ['շաուրմա', 'Шаурма', 'Shawarma'],
  ['գարնանային', 'Весеннее меню', 'Spring menu'], ['ամառային', 'Летнее меню', 'Summer menu'],
  ['աշնանային', 'Осеннее меню', 'Autumn menu'], ['ձմեռային', 'Зимнее меню', 'Winter menu']
];

function localizeCategory(name, pack) {
  const source = clean(name);
  const direct = Object.values(pack.entries).find((rule) => {
    const names = rule?.names || rule;
    return [names?.hy, names?.ru, names?.en, rule?.source].some((value) => normalize(value) === normalize(source));
  });
  if (direct) {
    const names = direct.names || direct;
    return { ru: clean(names.ru) || source, en: clean(names.en) || source, hy: clean(names.hy) || source };
  }
  const lowered = normalize(source);
  const match = CATEGORY_TRANSLATIONS.find(([hy]) => lowered.includes(normalize(hy)));
  if (match) return { ru: match[1], en: match[2], hy: source };
  return { ru: source, en: source, hy: source };
}

function ingredientRuleFor(ingredient, ingredientPack) {
  const ids = [
    ingredient?.ingredientId,
    ingredient?.ingredient_id,
    ingredient?.posterIngredientId,
    ingredient?.poster_ingredient_id,
    ingredient?.id,
    ingredient?.ingredient?.id
  ].filter((id) => id != null && clean(id));
  for (const id of ids) {
    const rule = ingredientPack.entries[String(id)];
    if (rule) return rule;
  }

  // Poster recipe payloads have changed field names between API versions. If no ID is present,
  // match the current ingredient text against the curated RU/EN/HY names.
  const currentNames = [ingredient?.name, ingredient?.ingredient_name, ingredient?.ingredientName].map(normalize).filter(Boolean);
  if (!currentNames.length) return null;
  for (const rule of Object.values(ingredientPack.entries)) {
    const names = rule?.names || rule;
    const candidates = [names?.ru, names?.en, names?.hy, rule?.sourceName].map(normalize).filter(Boolean);
    if (candidates.some((candidate) => currentNames.includes(candidate))) return rule;
  }
  return null;
}

initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

async function main() {
  const productsPack = loadJsonPacks('product-translations', 'products');
  const ingredientPack = loadJsonPacks('ingredient-overrides', 'ingredients');
  const categoryPack = loadJsonPacks('category-translations', 'categories');
  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  const productSnapshot = await restaurantRef.collection('products').get();
  const categorySnapshot = await restaurantRef.collection('categories').get();
  const writes = [];
  let productTranslations = 0;
  let ingredientTranslations = 0;
  let allergenUpdates = 0;
  let categoryTranslations = 0;

  for (const doc of productSnapshot.docs) {
    const data = doc.data();
    const productId = String(doc.id);
    const productRule = productsPack.entries[productId];
    const next = {};

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
        const rule = ingredientRuleFor(ingredient, ingredientPack);
        if (!rule?.names) return ingredient;
        const names = rule.names;
        const updated = {
          ...ingredient,
          name: clean(names.ru) || clean(ingredient.name) || clean(ingredient.ingredient_name),
          names: {
            ru: clean(names.ru) || clean(ingredient.name) || clean(ingredient.ingredient_name),
            en: clean(names.en) || clean(ingredient.name) || clean(ingredient.ingredient_name),
            hy: clean(names.hy) || clean(ingredient.name) || clean(ingredient.ingredient_name)
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
          method: 'curated_by_poster_ingredient_id_or_source_name',
          updatedAt: FieldValue.serverTimestamp()
        };
        ingredientTranslations += 1;
      }

      const overrideAllergens = new Set(
        ingredients.flatMap((ingredient) => {
          const rule = ingredientRuleFor(ingredient, ingredientPack);
          return rule?.allergens || [];
        })
      );
      if (overrideAllergens.size) {
        const existing = Array.isArray(data.allergens) ? data.allergens : [];
        const mergedIds = [...new Set([
          ...existing.map((item) => typeof item === 'string' ? item : item?.id).filter(Boolean),
          ...overrideAllergens
        ])];
        next.allergens = mergedIds.map((id) => ({ id, status: 'suggested', source: 'restaurant_rule_override' }));
        allergenUpdates += 1;
      }
    }

    if (Object.keys(next).length) {
      next.updatedAt = FieldValue.serverTimestamp();
      writes.push({ ref: doc.ref, data: next });
    }
  }

  for (const doc of categorySnapshot.docs) {
    const data = doc.data();
    if (String(data.id || doc.id) === 'all') continue;
    const localizedName = localizeCategory(data.name?.hy || data.name?.ru || data.name?.en || data.posterOriginalName || '', categoryPack);
    const current = data.name || {};
    if (JSON.stringify(localizedName) !== JSON.stringify(current)) {
      writes.push({
        ref: doc.ref,
        data: {
          name: localizedName,
          categoryLocalization: {
            version: categoryPack.version || 1,
            sourceFiles: categoryPack.files,
            method: categoryPack.files.length ? 'curated_category_pack' : 'curated_common_category_rules',
            updatedAt: FieldValue.serverTimestamp()
          },
          updatedAt: FieldValue.serverTimestamp()
        }
      });
      categoryTranslations += 1;
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
      categoryVersion: categoryPack.version || 1,
      productPacks: productsPack.files,
      ingredientPacks: ingredientPack.files,
      categoryPacks: categoryPack.files,
      productsApplied: productTranslations,
      productsWithIngredientUpdates: ingredientTranslations,
      categoryUpdates: categoryTranslations,
      allergenUpdates,
      lastRunAt: FieldValue.serverTimestamp()
    },
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  console.log(`[Source localization] ${restaurantId}: products=${productTranslations}, ingredient-updates=${ingredientTranslations}, category-updates=${categoryTranslations}, allergen-updates=${allergenUpdates}`);
}

main().catch((error) => {
  console.error(`[Source localization] FAILED: ${error?.message || error}`);
  process.exit(1);
});
