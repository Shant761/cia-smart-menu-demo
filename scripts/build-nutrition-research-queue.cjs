const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const limit = Number(process.env.CIA_PRIORITY_LIMIT || 500);
const priorityPath = path.join(root, 'data', process.env.CIA_PRIORITY_FILE || `cia-nutrition-priority-top${limit}.json`);
const manualPath = path.join(root, 'data', process.env.CIA_MANUAL_FILE || 'cia-nutrition-manual-top20.json');
const outPath = path.join(root, 'data', process.env.CIA_RESEARCH_FILE || 'cia-nutrition-research-queue.json');

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokens(value) {
  return new Set(normalize(value).split(' ').filter(Boolean));
}

function tokenOverlap(a, b) {
  const aa = tokens(a);
  const bb = tokens(b);
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const token of aa) if (bb.has(token)) common += 1;
  return common / Math.max(aa.size, bb.size);
}

function uniqueStrings(values) {
  return [...new Set((values || []).map(v => String(v || '').trim()).filter(Boolean))];
}

function hasPossibleAliasCollision(entry) {
  const primary = String(entry.name || '');
  const aliases = uniqueStrings(entry.aliases).filter(alias => normalize(alias) !== normalize(primary));
  if (!aliases.length) return false;
  return aliases.some(alias => {
    const a = normalize(primary);
    const b = normalize(alias);
    if (!a || !b) return false;
    if (a.includes(b) || b.includes(a)) return false;
    return tokenOverlap(a, b) < 0.2;
  });
}

const NON_FOOD = /(уголь|табак|муштук|мундштук|coal|charcoal|tobacco|hookah)/i;
const PREPARED = /(соус|крем|начинка|тесто|печенье|борщ|брауни|буженина|рулет|пюре|желато|морожен|салат|суп|джем|варень|глазур|маринованн.*овощ|каурма|дзадзики|ким\s*чи|сорбе|сосиск|тост|котлет|наггет|паштет|медовик|муравейник|безе|торт|чизкейк|фондан|харчо|харриса|спас|суджух|паста из перца|запеченн|вяленн|засахаренн|морс|компот|сцежанн|настойка фруктового чая|кофе восточн|кофе парижск)/i;
const BRAND = /(monin|parmalat|ponti|caravella|fever.?tree|arcolad|gurme|red\s*bull|ред\s*булл|nutella|нутелла|perrier|перриер)/i;
const ALCOHOL_BRAND = /(havana club|absolut|aperol|baileys|bombay|campari|grey goose|jameson|karas|koor|onegin|st\.?germain|takar|bacardi|ballantine|becherovka|beluga|chivas|corona|dargett|don julio|glenfiddich|hendrick|hennessy|jack daniel|jagermeister|malibu|mo[eë]t|patron|roku|sambuka|glenlivet|macallan|zonin|zorah|olmega|olmeca|beefeter|beefeater|cointreau|kahlua|martini|chistie\s*rosi|akhtamar|dvin|nairi|ohanyan|vaspurakan|jim\s*beam|jin\s*beam|keush|krombacher|piccini|attems|tariri|monkey\s*47)/i;
const ALCOHOL = /(водка|вино\b|ром\b|джин\b|виски|текил|ликер|liqueur|liquor|brandy|бренди|коньяк|prosecco|brut\b|pinot\s+grigio|absent|absinthe|cachaca|calvados|sambuka|whisky|whiskey|gin\b|rum\b|vodka|wine\b|beer\b|пиво\b|хреновух)/i;

function classify(entry, manualEntry) {
  const text = [entry.name, ...(entry.aliases || [])].join(' | ');
  // Source-name collisions always win over a previously verified value.
  // A Poster ID that points to multiple unrelated foods must never auto-pass.
  if (hasPossibleAliasCollision(entry)) return 'source_collision';
  if (manualEntry?.verified === true) return 'verified';
  if (NON_FOOD.test(text)) return 'non_food';
  // Alcohol brands must be classified as alcohol regardless of whether Poster
  // stores the recipe unit as ml, g or p (whole bottle/piece).
  if (ALCOHOL.test(text) || ALCOHOL_BRAND.test(text)) return 'alcohol';
  if (PREPARED.test(text)) return 'prepared_or_recipe';
  if (BRAND.test(text)) return 'branded_product';
  return 'generic_ingredient';
}

function researchPlan(kind, entry) {
  const name = String(entry.name || '').trim();
  switch (kind) {
    case 'verified':
      return { action: 'done', preferredSources: [], searchQueries: [] };
    case 'source_collision':
      return { action: 'manual_review_before_search', preferredSources: ['Poster recipe/source names'], searchQueries: [] };
    case 'non_food':
      return { action: 'exclude_from_nutrition', preferredSources: [], searchQueries: [] };
    case 'prepared_or_recipe':
      return {
        action: 'calculate_from_poster_recipe_first',
        preferredSources: ['Poster tech card', 'USDA FoodData Central as ingredient reference', 'CIQUAL as secondary reference'],
        searchQueries: [`${name} nutrition kcal 100g`, `${name} калорийность 100 г`]
      };
    case 'branded_product':
      return {
        action: 'internet_lookup_brand_first',
        preferredSources: ['Manufacturer nutrition label', 'Open Food Facts', 'USDA Global Branded Foods'],
        searchQueries: [`${name} nutrition 100g`, `${name} calories nutrition label`]
      };
    case 'alcohol':
      return {
        action: 'internet_lookup_label_or_abv',
        preferredSources: ['Manufacturer', 'Open Food Facts', 'official product specification'],
        searchQueries: [`${name} calories 100 ml nutrition`, `${name} ABV calories`]
      };
    default:
      return {
        action: 'internet_lookup_generic',
        preferredSources: ['USDA FoodData Central', 'CIQUAL', 'Open Food Facts as secondary reference'],
        searchQueries: [`${name} USDA FoodData Central`, `${name} calories kcal 100g`]
      };
  }
}

if (!fs.existsSync(priorityPath)) throw new Error(`Missing priority file: ${priorityPath}`);
const priority = readJson(priorityPath, { entries: [] });
const manual = readJson(manualPath, { entries: [] });
const manualById = new Map((manual.entries || []).map(entry => [String(entry.id), entry]));

const queue = (priority.entries || []).map(entry => {
  const manualEntry = manualById.get(String(entry.id));
  const kind = classify(entry, manualEntry);
  return {
    priority: entry.priority,
    id: entry.id,
    posterIngredientId: entry.posterIngredientId ?? null,
    name: entry.name,
    aliases: uniqueStrings(entry.aliases),
    units: entry.units || [],
    usedInProductCount: entry.usedInProductCount || 0,
    analysisStatus: entry.analysisStatus || 'unknown',
    verified: manualEntry?.verified === true,
    kind,
    ...researchPlan(kind, entry)
  };
});

const counts = {};
for (const item of queue) counts[item.kind] = (counts[item.kind] || 0) + 1;

const output = {
  version: '1.0.0',
  restaurantId: priority.restaurantId || manual.restaurantId || 'poster-test',
  source: path.basename(priorityPath),
  total: queue.length,
  counts,
  policy: {
    generic_ingredient: 'USDA first; CIQUAL secondary; accept only close food matches.',
    branded_product: 'Manufacturer/Open Food Facts first; do not replace brand with a generic value when label data exists.',
    prepared_or_recipe: 'Poster tech card is authoritative; internet values are reference only.',
    source_collision: 'Never auto-accept. Resolve the Poster ID/name collision first.',
    non_food: 'Exclude from calorie calculations.',
    alcohol: 'Use product label/ABV-specific data; avoid unrelated name matches.'
  },
  entries: queue
};

fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
console.log(`[CIA Nutrition Research] source: ${path.basename(priorityPath)}`);
console.log(`[CIA Nutrition Research] total: ${queue.length}`);
console.log(`[CIA Nutrition Research] counts: ${JSON.stringify(counts)}`);
console.log(`[CIA Nutrition Research] output: ${outPath}`);
