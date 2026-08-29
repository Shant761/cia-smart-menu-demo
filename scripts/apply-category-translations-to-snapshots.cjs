const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dataDir = path.join(root, 'data');
const snapshotDir = path.join(dataDir, 'public-menus');
const langs = ['hy', 'ru', 'en'];

const clean = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

if (!fs.existsSync(snapshotDir)) {
  console.log('[Category snapshot translations] No public snapshot directory; skipped.');
  process.exit(0);
}

const packs = fs.readdirSync(dataDir)
  .filter((name) => /-category-translations\.json$/.test(name));

let changedFiles = 0;
let changedCategories = 0;

for (const packName of packs) {
  const packPath = path.join(dataDir, packName);
  const pack = readJson(packPath);
  const restaurantId = clean(pack.restaurantId || packName.replace(/-category-translations\.json$/, ''));
  if (!restaurantId) continue;

  const snapshotPath = path.join(snapshotDir, `${restaurantId}.json`);
  if (!fs.existsSync(snapshotPath)) continue;

  const snapshot = readJson(snapshotPath);
  if (!Array.isArray(snapshot.categories)) continue;

  let fileChanged = false;
  snapshot.categories = snapshot.categories.map((category) => {
    const rule = pack.categories?.[String(category?.id)];
    if (!rule) return category;

    const translated = Object.fromEntries(langs.map((lang) => [lang, clean(rule[lang])]));
    if (langs.some((lang) => !translated[lang])) return category;

    const current = category.name || {};
    const same = langs.every((lang) => clean(current[lang]) === translated[lang]);
    if (same) return category;

    fileChanged = true;
    changedCategories += 1;
    return { ...category, name: translated };
  });

  if (fileChanged) {
    writeJson(snapshotPath, snapshot);
    changedFiles += 1;
    console.log(`[Category snapshot translations] Updated ${restaurantId}`);
  }
}

console.log(`[Category snapshot translations] Files changed: ${changedFiles}`);
console.log(`[Category snapshot translations] Categories changed: ${changedCategories}`);
