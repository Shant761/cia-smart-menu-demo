// Demo rules describing whether an allergen can be removed during preparation.
// Unknown rules are treated as non-removable for safety. Later these rules can
// come from Poster recipe metadata / restaurant settings.
const allergenCustomizationByProduct = {
  101: {
    milk: { removable: true, reason: { ru: 'Можно убрать сыр Чеддер', en: 'Cheddar can be removed', hy: 'Չեդդեր պանիրը կարելի է չավելացնել' } },
    gluten: { removable: false, reason: { ru: 'Глютен входит в булочку — без изменения основы убрать нельзя', en: 'Gluten is in the bun and cannot be removed without changing the base', hy: 'Գլյուտենը բուլկու բաղադրության մեջ է և առանց հիմքը փոխելու չի հեռացվում' } },
    egg: { removable: true, reason: { ru: 'Можно убрать фирменный соус', en: 'House sauce can be removed', hy: 'Ֆիրմային սոուսը կարելի է չավելացնել' } }
  },
  102: {
    milk: { removable: true, reason: { ru: 'Можно убрать пармезан', en: 'Parmesan can be removed', hy: 'Պարմեզանը կարելի է չավելացնել' } },
    gluten: { removable: true, reason: { ru: 'Можно убрать сухарики', en: 'Croutons can be removed', hy: 'Չորահացը կարելի է չավելացնել' } },
    egg: { removable: true, reason: { ru: 'Можно приготовить без соуса Цезарь', en: 'Can be prepared without Caesar dressing', hy: 'Կարելի է պատրաստել առանց Կեսար սոուսի' } },
    mustard: { removable: true, reason: { ru: 'Можно приготовить без соуса Цезарь', en: 'Can be prepared without Caesar dressing', hy: 'Կարելի է պատրաստել առանց Կեսար սոուսի' } }
  },
  104: {
    milk: { removable: true, reason: { ru: 'Можно приготовить без сливочного масла и молочного соуса', en: 'Can be prepared without butter and dairy sauce', hy: 'Կարելի է պատրաստել առանց կարագի և կաթնային սոուսի' } }
  },
  106: {
    gluten: { removable: false, reason: { ru: 'Глютен находится в пасте — это основа блюда', en: 'Gluten is in the pasta, which is the base of the dish', hy: 'Գլյուտենը պաստայի մեջ է, որը ուտեստի հիմքն է' } },
    crustaceans: { removable: false, reason: { ru: 'Креветки — основной ингредиент блюда', en: 'Shrimp is a core ingredient of the dish', hy: 'Ծովախեցգետինը ուտեստի հիմնական բաղադրիչն է' } },
    milk: { removable: false, reason: { ru: 'Молочные продукты входят в приготовленный сливочный соус', en: 'Dairy is part of the prepared cream sauce', hy: 'Կաթնամթերքը պատրաստված սերուցքային սոուսի բաղադրության մեջ է' } }
  },
  107: {
    fish: { removable: false, reason: { ru: 'Рыба — основной ингредиент сета', en: 'Fish is a core ingredient of the set', hy: 'Ձուկը սեթի հիմնական բաղադրիչն է' } },
    crustaceans: { removable: false, reason: { ru: 'Креветка — основной ингредиент части роллов', en: 'Shrimp is a core ingredient in part of the rolls', hy: 'Ծովախեցգետինը ռոլերի մի մասի հիմնական բաղադրիչն է' } },
    soy: { removable: true, reason: { ru: 'Можно не подавать соевый соус', en: 'Soy sauce can be omitted', hy: 'Սոյայի սոուսը կարելի է չմատուցել' } },
    gluten: { removable: true, reason: { ru: 'Если источник — соевый соус, его можно не подавать', en: 'If the source is soy sauce, it can be omitted', hy: 'Եթե աղբյուրը սոյայի սոուսն է, այն կարելի է չմատուցել' } }
  },
  108: {
    milk: { removable: false, reason: { ru: 'Молочные продукты входят в основу чизкейка', en: 'Dairy is part of the cheesecake base', hy: 'Կաթնամթերքը չիզքեյքի հիմքի բաղադրության մեջ է' } },
    egg: { removable: false, reason: { ru: 'Яйцо используется при приготовлении основы', en: 'Egg is used while preparing the base', hy: 'Ձուն օգտագործվում է հիմքը պատրաստելիս' } },
    gluten: { removable: false, reason: { ru: 'Глютен входит в готовую основу десерта', en: 'Gluten is part of the prepared dessert base', hy: 'Գլյուտենը պատրաստի աղանդերի հիմքի բաղադրության մեջ է' } }
  },
  109: {
    nuts: { removable: false, reason: { ru: 'Ореховый крем уже входит в десерт', en: 'Nut cream is already part of the dessert', hy: 'Ընկույզի կրեմն արդեն աղանդերի բաղադրության մեջ է' } },
    milk: { removable: false, reason: { ru: 'Молоко может входить в готовый шоколад или крем', en: 'Milk may be part of the prepared chocolate or cream', hy: 'Կաթը կարող է լինել պատրաստի շոկոլադի կամ կրեմի բաղադրության մեջ' } }
  },
  111: {
    milk: { removable: false, reason: { ru: 'Молоко — основной ингредиент капучино', en: 'Milk is a core ingredient of cappuccino', hy: 'Կաթը կապուչինոյի հիմնական բաղադրիչն է' } }
  }
};

const customizationCopy = {
  ru: {
    canAdapt: 'Можно изменить', cannotAdapt: 'Нельзя убрать', canPrepare: 'Можно приготовить без выбранного аллергена',
    cannotPrepare: 'Нельзя безопасно убрать выбранный аллерген', customizeTitle: 'Можно ли изменить состав?',
    removable: 'Можно убрать', fixed: 'Нельзя убрать', unknown: 'Нужно уточнить у персонала',
    selectedRemovable: 'Выбранный аллерген можно исключить при приготовлении:', selectedFixed: 'Выбранный аллерген нельзя исключить:',
    customizationHint: 'Изменение состава нужно подтвердить при заказе.'
  },
  en: {
    canAdapt: 'Can be adjusted', cannotAdapt: 'Cannot remove', canPrepare: 'Can be prepared without the selected allergen',
    cannotPrepare: 'The selected allergen cannot be safely removed', customizeTitle: 'Can the recipe be adjusted?',
    removable: 'Can remove', fixed: 'Cannot remove', unknown: 'Please confirm with staff',
    selectedRemovable: 'The selected allergen can be excluded during preparation:', selectedFixed: 'The selected allergen cannot be excluded:',
    customizationHint: 'Recipe changes must be confirmed when ordering.'
  },
  hy: {
    canAdapt: 'Կարելի է փոխել', cannotAdapt: 'Չի կարելի հեռացնել', canPrepare: 'Կարելի է պատրաստել առանց ընտրված ալերգենի',
    cannotPrepare: 'Ընտրված ալերգենը անվտանգ հեռացնել հնարավոր չէ', customizeTitle: 'Կարելի՞ է փոխել բաղադրությունը',
    removable: 'Կարելի է հեռացնել', fixed: 'Չի կարելի հեռացնել', unknown: 'Պետք է ճշտել անձնակազմից',
    selectedRemovable: 'Ընտրված ալերգենը կարելի է բացառել պատրաստելիս՝', selectedFixed: 'Ընտրված ալերգենը հնարավոր չէ բացառել՝',
    customizationHint: 'Բաղադրության փոփոխությունը պետք է հաստատել պատվերի ժամանակ։'
  }
};

function customText(key) {
  return customizationCopy[state.lang]?.[key] || customizationCopy.ru[key] || key;
}

function getAllergenCustomization(product, allergenId) {
  return allergenCustomizationByProduct[product.id]?.[allergenId] || null;
}

function getConflictGroups(product) {
  const conflicts = getConflicts(product);
  return {
    conflicts,
    removable: conflicts.filter((item) => getAllergenCustomization(product, item.id)?.removable === true),
    fixed: conflicts.filter((item) => getAllergenCustomization(product, item.id)?.removable !== true)
  };
}

function injectCustomizationStyles() {
  if ($('#customizationStyles')) return;
  const style = document.createElement('style');
  style.id = 'customizationStyles';
  style.textContent = `
    .custom-pill { display:inline-flex; align-items:center; padding:4px 8px; border-radius:999px; font-size:11px; font-weight:800; margin-left:4px; }
    .custom-pill.removable { background:#e7f6e9; color:#28663a; }
    .custom-pill.fixed { background:#fde9e6; color:#9a352d; }
    .custom-summary { margin-top:9px; padding:9px 11px; border-radius:12px; font-size:12px; font-weight:800; }
    .custom-summary.removable { background:#edf8ef; color:#28663a; }
    .custom-summary.fixed { background:#fff0ed; color:#9a352d; }
    .customization-list { display:grid; gap:9px; margin-top:10px; }
    .customization-item { display:flex; gap:10px; align-items:flex-start; padding:11px 12px; border-radius:14px; background:#f7f5ef; }
    .customization-item .custom-icon { width:24px; flex:0 0 24px; }
    .customization-item strong { display:block; font-size:13px; }
    .customization-item small { display:block; margin-top:3px; color:#716b62; line-height:1.35; }
    .customization-item.removable strong { color:#28663a; }
    .customization-item.fixed strong { color:#9a352d; }
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
    // In safe mode, keep dishes only when every selected allergen can be removed.
    const safetyMatch = state.mode === 'all' || groups.fixed.length === 0;
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
    const action = selected && rule
      ? `<span class="custom-pill ${rule.removable ? 'removable' : 'fixed'}">${rule.removable ? customText('canAdapt') : customText('cannotAdapt')}</span>`
      : '';
    return `<span class="allergen-pill" title="${item.status === 'suggested' ? tr('suggested') : ''}">${allergen.emoji} ${txt(allergen.name)}${action}</span>`;
  }).join('');

  return `
    <article class="dish-card ${groups.fixed.length ? 'conflict' : ''}" data-product-id="${product.id}" tabindex="0">
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
          : '';
        return `<span class="allergen-pill">${allergen?.emoji || ''} ${txt(allergen?.name)}${item.status === 'suggested' ? ` · ${tr('suggested')}` : ''}${action}</span>`;
      }).join('')
    : `<span class="status-line safe">${tr('noAllergens')}</span>`;

  const customizationItems = product.allergens.map((item) => {
    const allergen = allergenById(item.id);
    const rule = getAllergenCustomization(product, item.id);
    const removable = rule?.removable === true;
    const label = rule ? (removable ? customText('removable') : customText('fixed')) : customText('unknown');
    const reason = rule?.reason ? txt(rule.reason) : customText('unknown');
    return `<div class="customization-item ${removable ? 'removable' : 'fixed'}">
      <span class="custom-icon">${removable ? '✅' : '⛔'}</span>
      <div><strong>${allergen?.emoji || ''} ${txt(allergen?.name)} · ${label}</strong><small>${reason}</small></div>
    </div>`;
  }).join('');

  const selectedMessage = groups.fixed.length
    ? `<div class="custom-summary fixed">${customText('selectedFixed')} ${groups.fixed.map((item) => `${allergenById(item.id)?.emoji || ''} ${txt(allergenById(item.id)?.name)}`).join(', ')}</div>`
    : groups.removable.length
      ? `<div class="custom-summary removable">${customText('selectedRemovable')} ${groups.removable.map((item) => `${allergenById(item.id)?.emoji || ''} ${txt(allergenById(item.id)?.name)}`).join(', ')}</div>`
      : '';

  $('#dishDetail').innerHTML = `
    <div class="detail-media">${product.image ? `<img src="${product.image}" alt="${txt(product.name)}">` : `<div class="dish-placeholder">${product.emoji || '🍽️'}</div>`}</div>
    <div class="detail-body">
      <div class="detail-title-row">
        <div><h2>${txt(product.name)}</h2></div>
        <div class="detail-price">${formatPrice(product.price)}</div>
      </div>
      <p class="detail-description">${txt(product.description)}</p>
      ${nutrition ? `<div class="nutrition-panel"><div><span>${tr('nutrition')}</span><strong>🔥 ${nutrition.calories} ${tr('calories')}</strong><span>${tr('nutritionNote')}</span></div>${light ? `<span class="light-pill">🌿 ${tr('light')}</span>` : ''}</div>` : ''}
      ${selectedMessage}
      <section class="detail-section">
        <h3>${tr('ingredients')}</h3>
        <ul class="ingredient-list">${(product.ingredients?.[state.lang] || product.ingredients?.ru || []).map((item) => `<li>${item}</li>`).join('')}</ul>
      </section>
      <section class="detail-section">
        <h3>${tr('allergens')}</h3>
        <div class="allergen-row">${allergenMarkup}</div>
        ${suggested.length ? `<div class="status-line review">${tr('review')}</div>` : ''}
      </section>
      ${product.allergens.length ? `<section class="detail-section"><h3>${customText('customizeTitle')}</h3><div class="customization-list">${customizationItems}</div><div class="safety-box">${customText('customizationHint')}</div></section>` : ''}
      <div class="safety-box">${tr('safety')}</div>
    </div>`;

  openSheet($('#dishSheet'));
};