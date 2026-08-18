// Allergen removability is restaurant-owned data.
// No product-ID demo rules are used here: numeric Poster IDs may collide with old demo IDs.
const customizationCopy = {
  ru: {
    canAdapt: 'Можно изменить', cannotAdapt: 'Нельзя убрать', canPrepare: 'Можно приготовить без выбранного аллергена',
    cannotPrepare: 'Нельзя безопасно убрать выбранный аллерген', customizeTitle: 'Можно ли изменить состав?',
    removable: 'Можно убрать', fixed: 'Нельзя убрать', unknown: 'Нужно уточнить у персонала',
    unknownShort: 'Уточнить', selectedRemovable: 'Выбранный аллерген можно исключить при приготовлении:',
    selectedFixed: 'Выбранный аллерген нельзя исключить:', selectedUnknown: 'Возможность исключения выбранного аллергена нужно подтвердить у персонала:',
    customizationHint: 'Изменение состава должно быть подтверждено рестораном при заказе.'
  },
  en: {
    canAdapt: 'Can be adjusted', cannotAdapt: 'Cannot remove', canPrepare: 'Can be prepared without the selected allergen',
    cannotPrepare: 'The selected allergen cannot be safely removed', customizeTitle: 'Can the recipe be adjusted?',
    removable: 'Can remove', fixed: 'Cannot remove', unknown: 'Please confirm with staff',
    unknownShort: 'Confirm', selectedRemovable: 'The selected allergen can be excluded during preparation:',
    selectedFixed: 'The selected allergen cannot be excluded:', selectedUnknown: 'Please confirm with staff whether this allergen can be excluded:',
    customizationHint: 'Recipe changes must be confirmed by the restaurant when ordering.'
  },
  hy: {
    canAdapt: 'Կարելի է փոխել', cannotAdapt: 'Չի կարելի հեռացնել', canPrepare: 'Կարելի է պատրաստել առանց ընտրված ալերգենի',
    cannotPrepare: 'Ընտրված ալերգենը անվտանգ հեռացնել հնարավոր չէ', customizeTitle: 'Կարելի՞ է փոխել բաղադրությունը',
    removable: 'Կարելի է հեռացնել', fixed: 'Չի կարելի հեռացնել', unknown: 'Պետք է ճշտել անձնակազմից',
    unknownShort: 'Ճշտել', selectedRemovable: 'Ընտրված ալերգենը կարելի է բացառել պատրաստելիս՝',
    selectedFixed: 'Ընտրված ալերգենը հնարավոր չէ բացառել՝', selectedUnknown: 'Ընտրված ալերգենը բացառելու հնարավորությունը պետք է ճշտել անձնակազմից՝',
    customizationHint: 'Բաղադրության փոփոխությունը պատվերի ժամանակ պետք է հաստատի ռեստորանը։'
  }
};

function customText(key) {
  return customizationCopy[state.lang]?.[key] || customizationCopy.ru[key] || key;
}

function getAllergenCustomization(product, allergenId) {
  const sources = [
    product?.allergenCustomization,
    product?.customization?.allergens,
    product?.restaurantCustomization?.allergens
  ].filter((value) => value && typeof value === 'object');

  for (const source of sources) {
    const rule = source[allergenId];
    if (!rule) continue;
    const verified = rule.restaurantVerified === true || rule.verified === true || rule.status === 'confirmed';
    if (!verified) return null;
    return {
      removable: rule.removable === true,
      reason: rule.reason || null,
      verified: true
    };
  }
  return null;
}

function getConflictGroups(product) {
  const conflicts = getConflicts(product);
  const removable = [];
  const fixed = [];
  const unknown = [];

  for (const item of conflicts) {
    const rule = getAllergenCustomization(product, item.id);
    if (!rule) unknown.push(item);
    else if (rule.removable === true) removable.push(item);
    else fixed.push(item);
  }
  return { conflicts, removable, fixed, unknown };
}

function injectCustomizationStyles() {
  if ($('#customizationStyles')) return;
  const style = document.createElement('style');
  style.id = 'customizationStyles';
  style.textContent = `
    .custom-pill { display:inline-flex; align-items:center; padding:4px 8px; border-radius:999px; font-size:11px; font-weight:800; margin-left:4px; }
    .custom-pill.removable { background:#e7f6e9; color:#28663a; }
    .custom-pill.fixed { background:#fde9e6; color:#9a352d; }
    .custom-pill.unknown { background:#fff4db; color:#8a6420; }
    .custom-summary { margin-top:9px; padding:9px 11px; border-radius:12px; font-size:12px; font-weight:800; }
    .custom-summary.removable { background:#edf8ef; color:#28663a; }
    .custom-summary.fixed { background:#fff0ed; color:#9a352d; }
    .custom-summary.unknown { background:#fff7e8; color:#8a6420; }
    .customization-list { display:grid; gap:9px; margin-top:10px; }
    .customization-item { display:flex; gap:10px; align-items:flex-start; padding:11px 12px; border-radius:14px; background:#f7f5ef; }
    .customization-item .custom-icon { width:24px; flex:0 0 24px; }
    .customization-item strong { display:block; font-size:13px; }
    .customization-item small { display:block; margin-top:3px; color:#716b62; line-height:1.35; }
    .customization-item.removable strong { color:#28663a; }
    .customization-item.fixed strong { color:#9a352d; }
    .customization-item.unknown strong { color:#8a6420; }
  `;
  document.head.appendChild(style);
}

injectCustomizationStyles();

filteredProducts = function() {
  return state.menu.products.filter((product) => {
    const categoryMatch = state.category === 'diet-salads'
      ? product.category === 'salads' && isLightDish(product)
      : state.category === 'all' || product.category === state.category;
    const searchMatch = productMatchesSearch(product);
    const groups = getConflictGroups(product);
    // Unknown removability is treated conservatively in Safe mode, but is not labelled "cannot remove".
    const safetyMatch = state.mode === 'all' || (groups.fixed.length === 0 && groups.unknown.length === 0);
    return categoryMatch && searchMatch && safetyMatch;
  });
};

renderCard = function(product) {
  const groups = getConflictGroups(product);
  const hasSuggested = product.allergens.some((item) => item.status === 'suggested');
  const nutrition = getNutrition(product);
  const light = isLightDish(product);

  let statusText = '';
  let statusClass = 'safe';
  if (groups.fixed.length) {
    statusText = `⛔ ${customText('cannotPrepare')}`;
    statusClass = 'warn';
  } else if (groups.unknown.length) {
    statusText = `⚠ ${customText('unknown')}`;
    statusClass = 'review';
  } else if (groups.removable.length) {
    statusText = `✓ ${customText('canPrepare')}`;
    statusClass = 'safe';
  } else if (hasSuggested) {
    statusText = tr('review');
    statusClass = 'review';
  } else if (state.selected.size) {
    statusText = tr('suitable');
  }

  const pills = product.allergens.slice(0, 4).map((item) => {
    const allergen = allergenById(item.id);
    if (!allergen) return '';
    const rule = getAllergenCustomization(product, item.id);
    const selected = state.selected.has(item.id);
    let action = '';
    if (selected) {
      action = rule
        ? `<span class="custom-pill ${rule.removable ? 'removable' : 'fixed'}">${rule.removable ? customText('canAdapt') : customText('cannotAdapt')}</span>`
        : `<span class="custom-pill unknown">${customText('unknownShort')}</span>`;
    }
    return `<span class="allergen-pill" title="${item.status === 'suggested' ? tr('suggested') : ''}">${allergen.emoji} ${txt(allergen.name)}${action}</span>`;
  }).join('');

  return `
    <article class="dish-card ${groups.fixed.length || groups.unknown.length ? 'conflict' : ''}" data-product-id="${product.id}" tabindex="0">
      <div class="dish-media">
        ${product.image ? `<img src="${product.image}" alt="${txt(product.name)}" loading="lazy">` : `<div class="dish-placeholder">${product.emoji || '🍽️'}</div>`}
      </div>
      <div class="dish-content">
        <div class="dish-topline">
          <h3 class="dish-title">${txt(product.name)}</h3>
          <span class="dish-price">${formatPrice(product.price)}</span>
        </div>
        <p class="dish-desc">${txt(product.description)}</p>
        ${nutrition ? `<div class="nutrition-row"><span class="calorie-pill">🔥 ${nutrition.calories} ${tr('calories')}</span>${light ? `<span class="light-pill">🌿 ${tr('light')}</span>` : ''}</div>` : ''}
        <div class="allergen-row">${pills}</div>
        ${statusText ? `<div class="status-line ${statusClass}">${statusText}</div>` : ''}
      </div>
    </article>`;
};

openDish = function(productId) {
  const product = state.menu.products.find((item) => item.id === productId);
  if (!product) return;
  const groups = getConflictGroups(product);
  const suggested = product.allergens.filter((item) => item.status === 'suggested');
  const nutrition = getNutrition(product);
  const light = isLightDish(product);

  const allergenMarkup = product.allergens.length
    ? product.allergens.map((item) => {
        const allergen = allergenById(item.id);
        const rule = getAllergenCustomization(product, item.id);
        const action = rule
          ? `<span class="custom-pill ${rule.removable ? 'removable' : 'fixed'}">${rule.removable ? customText('removable') : customText('fixed')}</span>`
          : `<span class="custom-pill unknown">${customText('unknownShort')}</span>`;
        return `<span class="allergen-pill">${allergen?.emoji || ''} ${txt(allergen?.name)}${item.status === 'suggested' ? ` · ${tr('suggested')}` : ''}${action}</span>`;
      }).join('')
    : `<span class="status-line safe">${tr('noAllergens')}</span>`;

  const customizationItems = product.allergens.map((item) => {
    const allergen = allergenById(item.id);
    const rule = getAllergenCustomization(product, item.id);
    const stateName = !rule ? 'unknown' : rule.removable ? 'removable' : 'fixed';
    const label = !rule ? customText('unknown') : rule.removable ? customText('removable') : customText('fixed');
    const reason = rule?.reason ? txt(rule.reason) : customText('unknown');
    const icon = stateName === 'removable' ? '✅' : stateName === 'fixed' ? '⛔' : '❓';
    return `<div class="customization-item ${stateName}"><span class="custom-icon">${icon}</span><div><strong>${allergen?.emoji || ''} ${txt(allergen?.name)} · ${label}</strong><small>${reason}</small></div></div>`;
  }).join('');

  const selectedMessage = groups.fixed.length
    ? `<div class="custom-summary fixed">${customText('selectedFixed')} ${groups.fixed.map((item) => `${allergenById(item.id)?.emoji || ''} ${txt(allergenById(item.id)?.name)}`).join(', ')}</div>`
    : groups.unknown.length
      ? `<div class="custom-summary unknown">${customText('selectedUnknown')} ${groups.unknown.map((item) => `${allergenById(item.id)?.emoji || ''} ${txt(allergenById(item.id)?.name)}`).join(', ')}</div>`
      : groups.removable.length
        ? `<div class="custom-summary removable">${customText('selectedRemovable')} ${groups.removable.map((item) => `${allergenById(item.id)?.emoji || ''} ${txt(allergenById(item.id)?.name)}`).join(', ')}</div>`
        : '';

  $('#dishDetail').innerHTML = `
    <div class="detail-media">${product.image ? `<img src="${product.image}" alt="${txt(product.name)}">` : `<div class="dish-placeholder">${product.emoji || '🍽️'}</div>`}</div>
    <div class="detail-body">
      <div class="detail-title-row"><div><h2>${txt(product.name)}</h2></div><div class="detail-price">${formatPrice(product.price)}</div></div>
      <p class="detail-description">${txt(product.description)}</p>
      ${nutrition ? `<div class="nutrition-panel"><div><span>${tr('nutrition')}</span><strong>🔥 ${nutrition.calories} ${tr('calories')}</strong><span>${tr('nutritionNote')}</span></div>${light ? `<span class="light-pill">🌿 ${tr('light')}</span>` : ''}</div>` : ''}
      ${selectedMessage}
      <section class="detail-section"><h3>${tr('ingredients')}</h3><ul class="ingredient-list">${(product.ingredients?.[state.lang] || product.ingredients?.ru || []).map((item) => `<li>${item}</li>`).join('')}</ul></section>
      <section class="detail-section"><h3>${tr('allergens')}</h3><div class="allergen-row">${allergenMarkup}</div>${suggested.length ? `<div class="status-line review">${tr('review')}</div>` : ''}</section>
      ${product.allergens.length ? `<section class="detail-section"><h3>${customText('customizeTitle')}</h3><div class="customization-list">${customizationItems}</div><div class="safety-box">${customText('customizationHint')}</div></section>` : ''}
      <div class="safety-box">${tr('safety')}</div>
    </div>`;

  openSheet($('#dishSheet'));
};
