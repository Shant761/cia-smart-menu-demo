const state = {
  menu: null,
  allergens: [],
  lang: 'ru',
  category: 'all',
  query: '',
  mode: 'safe',
  selected: new Set(),
  draftSelected: new Set()
};

const i18n = {
  ru: {
    search: 'Поиск блюд', personalize: 'Настроить меню под себя', personalizeSub: 'Исключите продукты и аллергены',
    edit: 'Изменить', menu: 'МЕНЮ', allDishes: 'Все блюда', dishes: 'блюд', personalization: 'ПЕРСОНАЛИЗАЦИЯ',
    excludeTitle: 'Что вы хотите исключить?', excludeIntro: 'Отметьте продукты, которые не должны встречаться в блюдах.',
    show: 'Показывать', safeOnly: 'Только подходящие блюда', safeHint: 'Скрывать блюда с выбранными аллергенами',
    showAll: 'Все блюда', allHint: 'Показывать предупреждение при конфликте', reset: 'Сбросить', apply: 'Применить',
    suitable: '✓ Подходит вашему фильтру', conflict: '⚠ Не подходит', review: 'ℹ Есть данные, требующие подтверждения',
    ingredients: 'Состав', allergens: 'Аллергены', noAllergens: 'Подтверждённые аллергены не указаны',
    contains: 'По текущей техкарте содержит выбранные вами аллергены:', safety: 'При тяжёлой аллергии уточните у персонала возможность перекрёстного контакта на кухне.',
    suggested: 'требует подтверждения', emptyTitle: 'Ничего не найдено', emptyText: 'Измените поиск или выбранные ограничения.',
    activePrefix: 'Ваш фильтр:'
  },
  en: {
    search: 'Search dishes', personalize: 'Personalize your menu', personalizeSub: 'Exclude ingredients and allergens',
    edit: 'Edit', menu: 'MENU', allDishes: 'All dishes', dishes: 'dishes', personalization: 'PERSONALIZATION',
    excludeTitle: 'What would you like to exclude?', excludeIntro: 'Select ingredients that should not appear in your dishes.',
    show: 'Show', safeOnly: 'Only suitable dishes', safeHint: 'Hide dishes with selected allergens',
    showAll: 'All dishes', allHint: 'Show warnings when there is a conflict', reset: 'Reset', apply: 'Apply',
    suitable: '✓ Matches your filter', conflict: '⚠ Not suitable', review: 'ℹ Some data needs restaurant confirmation',
    ingredients: 'Ingredients', allergens: 'Allergens', noAllergens: 'No confirmed allergens listed',
    contains: 'According to the current recipe this dish contains:', safety: 'For severe allergies, please ask staff about possible cross-contact in the kitchen.',
    suggested: 'needs confirmation', emptyTitle: 'Nothing found', emptyText: 'Change your search or selected exclusions.',
    activePrefix: 'Your filter:'
  },
  hy: {
    search: 'Որոնել ուտեստներ', personalize: 'Կարգավորել մենյուն ձեզ համար', personalizeSub: 'Բացառեք բաղադրիչներն ու ալերգենները',
    edit: 'Փոխել', menu: 'ՄԵՆՅՈՒ', allDishes: 'Բոլոր ուտեստները', dishes: 'ուտեստ', personalization: 'ԱՆՀԱՏԱԿԱՆԱՑՈՒՄ',
    excludeTitle: 'Ի՞նչ եք ցանկանում բացառել։', excludeIntro: 'Նշեք այն բաղադրիչները, որոնք չպետք է լինեն ուտեստներում։',
    show: 'Ցուցադրել', safeOnly: 'Միայն համապատասխան ուտեստները', safeHint: 'Թաքցնել ընտրված ալերգեններով ուտեստները',
    showAll: 'Բոլոր ուտեստները', allHint: 'Ցույց տալ նախազգուշացում անհամապատասխանության դեպքում', reset: 'Մաքրել', apply: 'Կիրառել',
    suitable: '✓ Համապատասխանում է ձեր ֆիլտրին', conflict: '⚠ Չի համապատասխանում', review: 'ℹ Կան տվյալներ, որոնք պետք է հաստատի ռեստորանը',
    ingredients: 'Բաղադրություն', allergens: 'Ալերգեններ', noAllergens: 'Հաստատված ալերգեններ նշված չեն',
    contains: 'Ըստ ընթացիկ տեխնոլոգիական քարտի պարունակում է՝', safety: 'Ծանր ալերգիայի դեպքում ճշտեք անձնակազմից խոհանոցում հնարավոր խաչաձև շփման մասին։',
    suggested: 'պետք է հաստատվի', emptyTitle: 'Ոչինչ չի գտնվել', emptyText: 'Փոխեք որոնումը կամ ընտրված սահմանափակումները։',
    activePrefix: 'Ձեր ֆիլտրը՝'
  }
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const txt = (obj) => obj?.[state.lang] || obj?.ru || obj?.en || '';
const tr = (key) => i18n[state.lang][key] || i18n.ru[key] || key;
const allergenById = (id) => state.allergens.find((item) => item.id === id);

function loadPrefs() {
  try {
    const prefs = JSON.parse(localStorage.getItem('ciaSmartMenuPrefs') || '{}');
    if (['ru','en','hy'].includes(prefs.lang)) state.lang = prefs.lang;
    if (['safe','all'].includes(prefs.mode)) state.mode = prefs.mode;
    if (Array.isArray(prefs.selected)) state.selected = new Set(prefs.selected);
  } catch (_) {}
}

function savePrefs() {
  localStorage.setItem('ciaSmartMenuPrefs', JSON.stringify({
    lang: state.lang,
    mode: state.mode,
    selected: [...state.selected]
  }));
}

async function init() {
  loadPrefs();
  try {
    const [menuResponse, allergenResponse] = await Promise.all([
      fetch('data/products.json'),
      fetch('data/allergens.json')
    ]);
    if (!menuResponse.ok || !allergenResponse.ok) throw new Error('Failed to load menu data');
    state.menu = await menuResponse.json();
    state.allergens = await allergenResponse.json();
    bindEvents();
    renderAll();
  } catch (error) {
    console.error(error);
    $('#menuGrid').innerHTML = `<div class="empty-state"><h3>Menu data error</h3><p>${error.message}</p></div>`;
  }
}

function bindEvents() {
  $('#searchInput').addEventListener('input', (event) => {
    state.query = event.target.value.trim().toLowerCase();
    renderMenu();
  });

  $('#personalizeBtn').addEventListener('click', openFilterSheet);
  $('#editFiltersBtn').addEventListener('click', openFilterSheet);
  $('#closeFilterSheet').addEventListener('click', closeSheets);
  $('#closeDishSheet').addEventListener('click', closeSheets);
  $('#sheetBackdrop').addEventListener('click', closeSheets);

  $('#clearFiltersBtn').addEventListener('click', () => {
    state.draftSelected.clear();
    renderAllergenOptions();
  });

  $('#applyFiltersBtn').addEventListener('click', () => {
    state.selected = new Set(state.draftSelected);
    state.mode = $('input[name="filterMode"]:checked').value;
    savePrefs();
    closeSheets();
    renderAll();
  });

  $('#menuGrid').addEventListener('click', (event) => {
    const card = event.target.closest('[data-product-id]');
    if (card) openDish(Number(card.dataset.productId));
  });

  $$('.lang-btn').forEach((button) => button.addEventListener('click', () => {
    state.lang = button.dataset.lang;
    savePrefs();
    renderAll();
  }));
}

function renderAll() {
  document.documentElement.lang = state.lang;
  $$('.lang-btn').forEach((button) => button.classList.toggle('active', button.dataset.lang === state.lang));
  renderStaticCopy();
  renderCategories();
  renderActiveFilters();
  renderMenu();
}

function renderStaticCopy() {
  $('#restaurantName').textContent = txt(state.menu.restaurant.name);
  $('#restaurantMeta').textContent = txt(state.menu.restaurant.meta);
  $('#searchInput').placeholder = tr('search');
  $('#personalizeTitle').textContent = tr('personalize');
  $('#personalizeSubtitle').textContent = tr('personalizeSub');
  $('#editFiltersBtn').textContent = tr('edit');
  $('#menuEyebrow').textContent = tr('menu');

  const sheet = $('#filterSheet');
  sheet.querySelector('.eyebrow').textContent = tr('personalization');
  sheet.querySelector('h2').textContent = tr('excludeTitle');
  sheet.querySelector('.sheet-intro').textContent = tr('excludeIntro');
  sheet.querySelector('.mode-label').textContent = tr('show');
  const radios = sheet.querySelectorAll('.radio-row');
  radios[0].querySelector('strong').textContent = tr('safeOnly');
  radios[0].querySelector('small').textContent = tr('safeHint');
  radios[1].querySelector('strong').textContent = tr('showAll');
  radios[1].querySelector('small').textContent = tr('allHint');
  $('#clearFiltersBtn').textContent = tr('reset');
  $('#applyFiltersBtn').textContent = tr('apply');
  $('#emptyState h3').textContent = tr('emptyTitle');
  $('#emptyState p').textContent = tr('emptyText');
}

function renderCategories() {
  const nav = $('#categoryNav');
  nav.innerHTML = state.menu.categories.map((category) => `
    <button class="category-chip ${category.id === state.category ? 'active' : ''}" data-category="${category.id}">${txt(category.name)}</button>
  `).join('');

  nav.querySelectorAll('.category-chip').forEach((button) => button.addEventListener('click', () => {
    state.category = button.dataset.category;
    renderCategories();
    renderMenu();
  }));
}

function renderActiveFilters() {
  const bar = $('#activeFilterBar');
  if (!state.selected.size) {
    bar.classList.add('hidden');
    return;
  }
  const names = [...state.selected].map((id) => txt(allergenById(id)?.name)).filter(Boolean);
  $('#activeFilterText').textContent = `${tr('activePrefix')} ${names.join(' • ')}`;
  bar.classList.remove('hidden');
}

function getConflicts(product) {
  return product.allergens.filter((item) => state.selected.has(item.id));
}

function productMatchesSearch(product) {
  if (!state.query) return true;
  const haystack = [
    txt(product.name),
    txt(product.description),
    ...(product.ingredients?.[state.lang] || product.ingredients?.ru || [])
  ].join(' ').toLowerCase();
  return haystack.includes(state.query);
}

function filteredProducts() {
  return state.menu.products.filter((product) => {
    const categoryMatch = state.category === 'all' || product.category === state.category;
    const searchMatch = productMatchesSearch(product);
    const conflict = getConflicts(product).length > 0;
    const safetyMatch = state.mode === 'all' || !conflict;
    return categoryMatch && searchMatch && safetyMatch;
  });
}

function renderMenu() {
  const products = filteredProducts();
  const selectedCategory = state.menu.categories.find((category) => category.id === state.category);
  $('#menuTitle').textContent = state.category === 'all' ? tr('allDishes') : txt(selectedCategory?.name);
  $('#resultCount').textContent = `${products.length} ${tr('dishes')}`;
  $('#menuGrid').innerHTML = products.map(renderCard).join('');
  $('#emptyState').classList.toggle('hidden', products.length > 0);
}

function renderCard(product) {
  const conflicts = getConflicts(product);
  const hasSuggested = product.allergens.some((item) => item.status === 'suggested');
  const statusClass = conflicts.length ? 'warn' : hasSuggested ? 'review' : 'safe';
  const statusText = conflicts.length ? tr('conflict') : hasSuggested ? tr('review') : (state.selected.size ? tr('suitable') : '');
  const pills = product.allergens.slice(0, 4).map((item) => {
    const allergen = allergenById(item.id);
    if (!allergen) return '';
    return `<span class="allergen-pill" title="${item.status === 'suggested' ? tr('suggested') : ''}">${allergen.emoji} ${txt(allergen.name)}</span>`;
  }).join('');

  return `
    <article class="dish-card ${conflicts.length ? 'conflict' : ''}" data-product-id="${product.id}" tabindex="0">
      <div class="dish-media">
        ${product.image ? `<img src="${product.image}" alt="${txt(product.name)}" loading="lazy">` : `<div class="dish-placeholder">${product.emoji || '🍽️'}</div>`}
      </div>
      <div class="dish-content">
        <div class="dish-topline">
          <h3 class="dish-title">${txt(product.name)}</h3>
          <span class="dish-price">${formatPrice(product.price)}</span>
        </div>
        <p class="dish-desc">${txt(product.description)}</p>
        <div class="allergen-row">${pills}</div>
        ${statusText ? `<div class="status-line ${statusClass}">${statusText}</div>` : ''}
      </div>
    </article>`;
}

function openFilterSheet() {
  state.draftSelected = new Set(state.selected);
  renderAllergenOptions();
  const radio = $(`input[name="filterMode"][value="${state.mode}"]`);
  if (radio) radio.checked = true;
  openSheet($('#filterSheet'));
}

function renderAllergenOptions() {
  $('#allergenOptions').innerHTML = state.allergens.map((allergen) => `
    <button type="button" class="allergen-option ${state.draftSelected.has(allergen.id) ? 'selected' : ''}" data-allergen="${allergen.id}">
      <span class="emoji">${allergen.emoji}</span>
      <span>${txt(allergen.name)}</span>
    </button>
  `).join('');

  $('#allergenOptions').querySelectorAll('.allergen-option').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.allergen;
    state.draftSelected.has(id) ? state.draftSelected.delete(id) : state.draftSelected.add(id);
    renderAllergenOptions();
  }));
}

function openDish(productId) {
  const product = state.menu.products.find((item) => item.id === productId);
  if (!product) return;
  const conflicts = getConflicts(product);
  const confirmed = product.allergens.filter((item) => item.status === 'confirmed');
  const suggested = product.allergens.filter((item) => item.status === 'suggested');

  const allergenMarkup = product.allergens.length
    ? product.allergens.map((item) => {
        const allergen = allergenById(item.id);
        return `<span class="allergen-pill">${allergen?.emoji || ''} ${txt(allergen?.name)}${item.status === 'suggested' ? ` · ${tr('suggested')}` : ''}</span>`;
      }).join('')
    : `<span class="status-line safe">${tr('noAllergens')}</span>`;

  $('#dishDetail').innerHTML = `
    <div class="detail-media">${product.image ? `<img src="${product.image}" alt="${txt(product.name)}">` : `<div class="dish-placeholder">${product.emoji || '🍽️'}</div>`}</div>
    <div class="detail-body">
      <div class="detail-title-row">
        <div><h2>${txt(product.name)}</h2></div>
        <div class="detail-price">${formatPrice(product.price)}</div>
      </div>
      <p class="detail-description">${txt(product.description)}</p>
      ${conflicts.length ? `<div class="conflict-box">${tr('contains')} ${conflicts.map((item) => `${allergenById(item.id)?.emoji || ''} ${txt(allergenById(item.id)?.name)}`).join(', ')}</div>` : ''}
      <section class="detail-section">
        <h3>${tr('ingredients')}</h3>
        <ul class="ingredient-list">${(product.ingredients?.[state.lang] || product.ingredients?.ru || []).map((item) => `<li>${item}</li>`).join('')}</ul>
      </section>
      <section class="detail-section">
        <h3>${tr('allergens')}</h3>
        <div class="allergen-row">${allergenMarkup}</div>
        ${suggested.length ? `<div class="status-line review">${tr('review')}</div>` : ''}
      </section>
      <div class="safety-box">${tr('safety')}</div>
    </div>`;

  openSheet($('#dishSheet'));
}

function openSheet(sheet) {
  $('#sheetBackdrop').classList.remove('hidden');
  [$('#filterSheet'), $('#dishSheet')].forEach((item) => {
    if (item !== sheet) {
      item.classList.remove('open');
      item.setAttribute('aria-hidden', 'true');
    }
  });
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeSheets() {
  $('#sheetBackdrop').classList.add('hidden');
  [$('#filterSheet'), $('#dishSheet')].forEach((sheet) => {
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
  });
  document.body.style.overflow = '';
}

function formatPrice(price) {
  return `${Number(price).toLocaleString(state.lang === 'hy' ? 'hy-AM' : state.lang === 'en' ? 'en-US' : 'ru-RU')} ֏`;
}

init();
