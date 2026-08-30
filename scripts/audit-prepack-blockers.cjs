const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const INPUT = path.join(ROOT, 'data', 'poster-test-prepack-nutrition.json');
const OUTPUT = path.join(ROOT, 'data', 'poster-test-prepack-blockers.json');

const data = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
const results = Array.isArray(data?.results) ? data.results : [];
const byId = new Map(results.map((item) => [String(item.productId), item]));
const review = results.filter((item) => item.status !== 'calculated');

function keyFor(row) {
  return `${row.type || 'unknown'}:${String(row.id || '')}:${String(row.reason || '')}`;
}

function leafBlockers(prepackId, stack = []) {
  const id = String(prepackId);
  if (stack.includes(id)) return [{ type: 'prepack', id, name: byId.get(id)?.name || '', reason: 'cycle_detected' }];
  const result = byId.get(id);
  if (!result) return [{ type: 'prepack', id, name: '', reason: 'prepack_not_found' }];
  const unresolved = Array.isArray(result.unresolved) ? result.unresolved : [];
  if (!unresolved.length) return [{ type: 'prepack', id, name: result.name || '', reason: result.reason || 'unknown_review_reason' }];

  const leaves = [];
  for (const row of unresolved) {
    const type = String(row.type || 'ingredient');
    const nestedId = String(row.id || '');
    if (type === 'prepack' && byId.has(nestedId)) {
      leaves.push(...leafBlockers(nestedId, [...stack, id]));
    } else {
      leaves.push({
        type,
        id: nestedId,
        name: String(row.name || '').trim(),
        reason: String(row.reason || 'unresolved'),
        grams: Number.isFinite(Number(row.grams)) ? Number(row.grams) : null
      });
    }
  }
  return leaves;
}

const blockerMap = new Map();
for (const prep of review) {
  const leaves = leafBlockers(prep.productId);
  const seen = new Set();
  for (const leaf of leaves) {
    const key = keyFor(leaf);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!blockerMap.has(key)) {
      blockerMap.set(key, {
        type: leaf.type,
        id: leaf.id,
        name: leaf.name,
        reason: leaf.reason,
        affectedPrepackCount: 0,
        affectedPrepacks: []
      });
    }
    const blocker = blockerMap.get(key);
    blocker.affectedPrepackCount += 1;
    blocker.affectedPrepacks.push({ productId: String(prep.productId), name: prep.name || '' });
  }
}

const blockers = [...blockerMap.values()].sort((a, b) =>
  b.affectedPrepackCount - a.affectedPrepackCount ||
  a.type.localeCompare(b.type) ||
  String(a.id).localeCompare(String(b.id))
);

const payload = {
  version: '1.0.0',
  restaurantId: data?.restaurantId || 'poster-test',
  generatedAt: new Date().toISOString(),
  prepackCount: results.length,
  calculatedCount: results.filter((item) => item.status === 'calculated').length,
  needsReviewCount: review.length,
  uniqueLeafBlockerCount: blockers.length,
  blockers
};

fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`[Prepack blockers] prepacks=${payload.prepackCount}; calculated=${payload.calculatedCount}; review=${payload.needsReviewCount}; blockers=${payload.uniqueLeafBlockerCount}`);
for (const blocker of blockers) {
  console.log(`[Prepack blocker] ${blocker.type} ${blocker.id} ${blocker.name}: reason=${blocker.reason}; affects=${blocker.affectedPrepackCount}`);
}
