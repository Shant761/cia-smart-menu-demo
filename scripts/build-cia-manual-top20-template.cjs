const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const limit = Number(process.env.CIA_PRIORITY_LIMIT || 100);
const topFile = process.env.CIA_PRIORITY_FILE || `cia-nutrition-priority-top${limit}.json`;
const manualFile = process.env.CIA_MANUAL_FILE || 'cia-nutrition-manual-top20.json';
const topPath = path.join(root, 'data', topFile);
const outPath = path.join(root, 'data', manualFile);

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function uniq(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function blankEntry(entry) {
  return {
    priority: entry.priority,
    id: entry.id,
    name: entry.name,
    aliases: uniq(entry.aliases),
    usedInProductCount: entry.usedInProductCount || 0,
    occurrences: entry.occurrences || 0,
    kcalPer100g: null,
    proteinPer100g: null,
    fatPer100g: null,
    carbsPer100g: null,
    source: null,
    sourceReference: null,
    verified: false,
    status: 'needs_review'
  };
}

function mergeEntry(priorityEntry, previousEntry) {
  const next = blankEntry(priorityEntry);
  if (!previousEntry) return next;

  return {
    ...next,
    aliases: uniq([...(next.aliases || []), ...(previousEntry.aliases || [])]),
    kcalPer100g: previousEntry.kcalPer100g ?? next.kcalPer100g,
    proteinPer100g: previousEntry.proteinPer100g ?? next.proteinPer100g,
    fatPer100g: previousEntry.fatPer100g ?? next.fatPer100g,
    carbsPer100g: previousEntry.carbsPer100g ?? next.carbsPer100g,
    source: previousEntry.source ?? next.source,
    sourceReference: previousEntry.sourceReference ?? next.sourceReference,
    verified: previousEntry.verified === true,
    status: previousEntry.status || next.status
  };
}

if (!Number.isFinite(limit) || limit <= 0) {
  throw new Error(`Invalid CIA_PRIORITY_LIMIT: ${process.env.CIA_PRIORITY_LIMIT}`);
}

if (!fs.existsSync(topPath)) throw new Error(`Missing ${topPath}`);
const top = readJson(topPath);
const existingManual = readJson(outPath, { entries: [] });
const entries = Array.isArray(top.entries) ? top.entries.slice(0, limit) : [];

const previousById = new Map();
const previousByName = new Map();
for (const entry of existingManual.entries || []) {
  if (entry.id) previousById.set(String(entry.id), entry);
  const nameKey = normalize(entry.name);
  if (nameKey && !previousByName.has(nameKey)) previousByName.set(nameKey, entry);
  for (const alias of entry.aliases || []) {
    const aliasKey = normalize(alias);
    if (aliasKey && !previousByName.has(aliasKey)) previousByName.set(aliasKey, entry);
  }
}

const manualEntries = entries.map((entry) => {
  const previous = previousById.get(String(entry.id)) || previousByName.get(normalize(entry.name));
  return mergeEntry(entry, previous);
});

const manual = {
  version: existingManual.version || '1.0.0',
  restaurantId: top.restaurantId || existingManual.restaurantId || 'poster-test',
  description: `CIA manual nutrition records extended through priority top ${limit}. Fill only confirmed values. Values are per 100g.`,
  calculationBasis: existingManual.calculationBasis || 'per 100g',
  entries: manualEntries
};

fs.writeFileSync(outPath, JSON.stringify(manual, null, 2) + '\n');
console.log(`[CIA Nutrition Manual] priority source: ${topFile}`);
console.log(`[CIA Nutrition Manual] entries written: ${manual.entries.length}`);
console.log(`[CIA Nutrition Manual] verified preserved: ${manual.entries.filter((entry) => entry.verified === true).length}`);
console.log(`[CIA Nutrition Manual] output: ${outPath}`);
