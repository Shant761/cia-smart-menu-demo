import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCE3QRts6mWqkDFySX8F4Bim7dIb7IaLq0',
  authDomain: 'cia-smart-menu.firebaseapp.com',
  projectId: 'cia-smart-menu',
  storageBucket: 'cia-smart-menu.firebasestorage.app',
  messagingSenderId: '62965932851',
  appId: '1:62965932851:web:56a31d76521be03fda9446'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

const restaurantId = new URLSearchParams(window.location.search).get('restaurant') || 'poster-test';

const state = {
  user: null,
  admin: null,
  restaurant: null,
  products: [],
  categories: [],
  analyses: new Map(),
  allergens: [],
  view: 'products',
  productFilter: 'all',
  query: '',
  currentProductId: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const esc = (value) => clean(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');
const localized = (value, lang = 'ru') => {
  if (typeof value === 'string') return value;
  return clean(value?.[lang] || value?.ru || value?.hy || value?.en || '');
};
const formatPrice = (value) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(value || 0))} ֏`;

function showOnly(id) {
  ['authView', 'pendingAccessView', 'adminView'].forEach((viewId) => {
    document.getElementById(viewId).classList.toggle('hidden', viewId !== id);
  });
}

function showToast(message, error = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 3200);
}

function authErrorMessage(error) {
  const code = error?.code || '';
  if (code === 'auth/operation-not-allowed') {
    return 'В Firebase Authentication нужно включить провайдер Google: Authentication → Sign-in method → Google → Enable.';
  }
  if (code === 'auth/popup-blocked') return 'Браузер заблокировал окно входа. Повторяем через перенаправление…';
  if (code === 'auth/popup-closed-by-user') return 'Окно входа было закрыто.';
  return clean(error?.message || 'Не удалось войти в Firebase.');
}

async function signInAdmin() {
  const errorBox = $('#authError');
  errorBox.classList.add('hidden');
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    if (error?.code === 'auth/popup-blocked') {
      errorBox.textContent = authErrorMessage(error);
      errorBox.classList.remove('hidden');
      await signInWithRedirect(auth, provider);
      return;
    }
    errorBox.textContent = authErrorMessage(error);
    errorBox.classList.remove('hidden');
  }
}

async function checkAccess(user) {
  state.user = user;
  $('#signOutBtn').classList.remove('hidden');
  $('#currentUid').textContent = user.uid;
  $('#currentUserEmail').textContent = user.email || 'Google account';

  try {
    const snapshot = await getDoc(doc(db, 'restaurants', restaurantId, 'admins', user.uid));
    if (!snapshot.exists() || snapshot.data()?.active !== true) {
      state.admin = null;
      showOnly('pendingAccessView');
      return;
    }
    state.admin = snapshot.data();
    await loadAdminData();
  } catch (error) {
    console.error(error);
    showOnly('pendingAccessView');
    showToast('Не удалось проверить доступ. Убедитесь, что Firestore Rules обновлены.', true);
  }
}

async function loadAdminData() {
  showOnly('adminView');
  const restaurantRef = doc(db, 'restaurants', restaurantId);
  const [restaurantSnap, categoriesSnap, productsSnap, analysisSnap, allergensResponse] = await Promise.all([
    getDoc(restaurantRef),
    getDocs(collection(db, 'restaurants', restaurantId, 'categories')),
    getDocs(collection(db, 'restaurants', restaurantId, 'products')),
    getDocs(collection(db, 'restaurants', restaurantId, 'product_analysis')),
    fetch('data/allergens.json')
  ]);

  if (!restaurantSnap.exists()) throw new Error(`Restaurant ${restaurantId} not found`);
  state.restaurant = restaurantSnap.data();
  state.categories = categoriesSnap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || String(a.id).localeCompare(String(b.id)));
  state.products = productsSnap.docs
    .map((item) => ({ _docId: item.id, ...item.data() }))
    .filter((item) => item.source === 'poster' && item.active !== false)
    .sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999));
  state.analyses = new Map(analysisSnap.docs.map((item) => [String(item.id), item.data()]));
  state.allergens = allergensResponse.ok ? await allergensResponse.json() : [];

  $('#openMenuLink').href = `/?restaurant=${encodeURIComponent(restaurantId)}`;
  $('#restaurantTitle').textContent = localized(state.restaurant?.name) || restaurantId;
  const displayName = state.user.displayName || 'Администратор';
  $('#userName').textContent = displayName;
  $('#userEmail').textContent = state.user.email || '';
  $('#userAvatar').textContent = displayName.slice(0, 1).toUpperCase();
  renderAll();
}

function categoryById(id) {
  return state.categories.find((item) => String(item.id) === String(id));
}

function allergenById(id) {
  return state.allergens.find((item) => item.id === id) || { id, emoji: '⚠️', name: { ru: id, en: id, hy: id } };
}

function isVerified(product) {
  return product?.restaurantReview?.status === 'verified';
}

function isHidden(product) {
  return product?.smartMenuPublished === false;
}

function renderStats() {
  const products = state.products;
  $('#statProducts').textContent = products.length;
  $('#statVerified').textContent = products.filter(isVerified).length;
  $('#statNeedsReview').textContent = products.filter((item) => !isVerified(item)).length;
  $('#statHidden').textContent = products.filter(isHidden).length;
}

function filteredProducts() {
  const q = state.query.toLowerCase();
  return state.products.filter((product) => {
    const filterMatch = state.productFilter === 'all'
      || (state.productFilter === 'verified' && isVerified(product))
      || (state.productFilter === 'needs_review' && !isVerified(product))
      || (state.productFilter === 'hidden' && isHidden(product));
    if (!filterMatch) return false;
    if (!q) return true;
    const haystack = [
      localized(product.name, 'ru'),
      localized(product.name, 'hy'),
      localized(product.name, 'en'),
      product.posterOriginalName,
      localized(categoryById(product.category)?.name, 'ru')
    ].join(' ').toLowerCase();
    return haystack.includes(q);
  });
}

function renderProducts() {
  const products = filteredProducts();
  $('#productsEmpty').classList.toggle('hidden', products.length > 0);
  $('#productList').innerHTML = products.map((product) => {
    const category = categoryById(product.category);
    const allergens = Array.isArray(product.allergens) ? product.allergens : [];
    const badges = allergens.slice(0, 3).map((item) => {
      const meta = allergenById(item.id);
      return `<span class="badge allergen">${esc(meta.emoji)} ${esc(localized(meta.name))}</span>`;
    }).join('');
    const status = isVerified(product)
      ? '<span class="badge verified">✓ Подтверждено</span>'
      : '<span class="badge review">Требует проверки</span>';
    const hidden = isHidden(product) ? '<span class="badge hidden-badge">Скрыто</span>' : '';
    const image = product.image
      ? `<img class="product-thumb" src="${esc(product.image)}" alt="" loading="lazy">`
      : `<div class="product-thumb placeholder">🍽️</div>`;
    return `
      <article class="product-row" data-id="${esc(product._docId)}">
        ${image}
        <div class="product-main">
          <strong>${esc(localized(product.name))}</strong>
          <small>${esc(localized(product.name, 'hy'))}</small>
        </div>
        <div class="product-meta">${esc(localized(category?.name) || 'Без категории')}<br>${esc(formatPrice(product.price))}</div>
        <div class="badge-row">${status}${hidden}${badges}</div>
        <div class="row-actions"><button class="review-btn" type="button" data-open-product="${esc(product._docId)}">Проверить</button></div>
      </article>`;
  }).join('');

  $$('[data-open-product]').forEach((button) => button.addEventListener('click', () => openProductDrawer(button.dataset.openProduct)));
}

function renderCategories() {
  $('#categoryList').innerHTML = state.categories.map((category) => {
    const isAll = category.id === 'all';
    const published = isAll || category.smartMenuPublished !== false;
    return `
      <article class="category-row" data-category-id="${esc(category.id)}">
        <div class="category-name"><small>RU</small><strong>${esc(localized(category.name, 'ru'))}</strong></div>
        <div class="category-name"><small>HY</small><strong>${esc(localized(category.name, 'hy'))}</strong></div>
        <div class="category-name"><small>EN</small><strong>${esc(localized(category.name, 'en'))}</strong></div>
        <div class="row-actions">
          <span class="category-source" title="Исходное название Poster">${esc(category.posterOriginalName || '')}</span>
          <label class="switch" title="Показывать категорию гостям">
            <input class="category-publish-toggle" type="checkbox" data-category-id="${esc(category.id)}" ${published ? 'checked' : ''} ${isAll ? 'disabled' : ''}>
            <span class="switch-slider"></span>
          </label>
        </div>
      </article>`;
  }).join('');

  $$('.category-publish-toggle').forEach((toggle) => toggle.addEventListener('change', async () => {
    const categoryId = toggle.dataset.categoryId;
    const category = categoryById(categoryId);
    if (!category || categoryId === 'all') return;
    toggle.disabled = true;
    try {
      await updateDoc(doc(db, 'restaurants', restaurantId, 'categories', categoryId), {
        smartMenuPublished: toggle.checked,
        restaurantReview: {
          status: 'reviewed',
          reviewedBy: state.user.uid,
          reviewedAt: serverTimestamp()
        },
        updatedAt: serverTimestamp()
      });
      category.smartMenuPublished = toggle.checked;
      category.restaurantReview = { status: 'reviewed', reviewedBy: state.user.uid };
      showToast(toggle.checked ? 'Категория опубликована' : 'Категория скрыта из Smart Menu');
    } catch (error) {
      console.error(error);
      toggle.checked = !toggle.checked;
      showToast('Не удалось сохранить категорию', true);
    } finally {
      toggle.disabled = false;
    }
  }));
}

function renderAll() {
  renderStats();
  renderProducts();
  renderCategories();
}

function switchView(view) {
  state.view = view;
  $$('.nav-btn').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $('#productsView').classList.toggle('hidden', view !== 'products');
  $('#productsToolbar').classList.toggle('hidden', view !== 'products');
  $('#categoriesView').classList.toggle('hidden', view !== 'categories');
}

function productAllergenIds(product, analysis) {
  const ids = new Set();
  for (const item of Array.isArray(product.allergens) ? product.allergens : []) if (item?.id) ids.add(item.id);
  for (const id of product?.allergenReview?.confirmed || []) ids.add(id);
  for (const id of product?.allergenReview?.rejected || []) ids.add(id);
  for (const id of analysis?.publicAllergenIds || []) ids.add(id);
  for (const id of Object.keys(product?.allergenCustomization || {})) ids.add(id);
  return [...ids];
}

function currentDecision(product, id) {
  if ((product?.allergenReview?.rejected || []).includes(id)) return 'rejected';
  if ((product?.allergenReview?.confirmed || []).includes(id)) return 'confirmed';
  const item = (product.allergens || []).find((entry) => entry.id === id);
  return item?.status === 'confirmed' ? 'confirmed' : 'suggested';
}

function currentRemovability(product, id) {
  const rule = product?.allergenCustomization?.[id];
  const verified = rule?.restaurantVerified === true || rule?.verified === true || rule?.status === 'confirmed';
  if (!verified) return 'unknown';
  return rule.removable === true ? 'removable' : 'fixed';
}

function allergenEditorRow(product, id) {
  const meta = allergenById(id);
  return `
    <div class="allergen-edit-row" data-allergen-id="${esc(id)}">
      <div class="allergen-edit-head">
        <strong>${esc(meta.emoji)} ${esc(localized(meta.name))}</strong>
        <span class="badge ${currentDecision(product, id) === 'confirmed' ? 'verified' : currentDecision(product, id) === 'rejected' ? 'hidden-badge' : 'review'}">${currentDecision(product, id) === 'confirmed' ? 'Подтверждено' : currentDecision(product, id) === 'rejected' ? 'Отклонено' : 'Кандидат'}</span>
      </div>
      <div class="allergen-controls">
        <select class="allergen-decision" aria-label="Решение по аллергену">
          <option value="suggested" ${currentDecision(product, id) === 'suggested' ? 'selected' : ''}>Требует проверки</option>
          <option value="confirmed" ${currentDecision(product, id) === 'confirmed' ? 'selected' : ''}>Подтвердить аллерген</option>
          <option value="rejected" ${currentDecision(product, id) === 'rejected' ? 'selected' : ''}>Аллергена нет / отклонить</option>
        </select>
        <select class="allergen-removability" aria-label="Можно ли убрать аллерген">
          <option value="unknown" ${currentRemovability(product, id) === 'unknown' ? 'selected' : ''}>Можно убрать? — уточнить</option>
          <option value="removable" ${currentRemovability(product, id) === 'removable' ? 'selected' : ''}>Можно убрать</option>
          <option value="fixed" ${currentRemovability(product, id) === 'fixed' ? 'selected' : ''}>Нельзя убрать</option>
        </select>
      </div>
    </div>`;
}

function renderAddAllergenSelect(existingIds) {
  const options = state.allergens
    .filter((item) => !existingIds.includes(item.id))
    .map((item) => `<option value="${esc(item.id)}">${esc(item.emoji)} ${esc(localized(item.name))}</option>`)
    .join('');
  return `<option value="">Добавить аллерген…</option>${options}`;
}

function openProductDrawer(docId) {
  const product = state.products.find((item) => String(item._docId) === String(docId));
  if (!product) return;
  state.currentProductId = String(docId);
  const analysis = state.analyses.get(String(docId));
  const category = categoryById(product.category);
  const recipeRows = analysis?.normalizedIngredients || (product.posterRecipeIngredients || []).map((row) => ({
    sourceName: row.name,
    names: { ru: row.name },
    netto: row.netto,
    brutto: row.brutto,
    unit: row.unit,
    mappingTrusted: false
  }));
  const allergenIds = productAllergenIds(product, analysis);
  const image = product.image
    ? `<img class="review-image" src="${esc(product.image)}" alt="">`
    : '<div class="review-image placeholder">🍽️</div>';

  $('#drawerTitle').textContent = localized(product.name);
  $('#drawerBody').innerHTML = `
    <div class="review-hero">
      ${image}
      <div>
        <div class="language-names">
          <div class="language-line"><span>HY</span><strong>${esc(localized(product.name, 'hy'))}</strong></div>
          <div class="language-line"><span>RU</span><strong>${esc(localized(product.name, 'ru'))}</strong></div>
          <div class="language-line"><span>EN</span><strong>${esc(localized(product.name, 'en'))}</strong></div>
        </div>
        <div class="review-price">${esc(formatPrice(product.price))}</div>
        <div class="product-meta">${esc(localized(category?.name) || 'Без категории')}</div>
      </div>
    </div>

    <div class="readonly-note">🔒 Исходные данные Poster доступны только для чтения. Эта панель не меняет состав техкарты, названия ингредиентов, граммовки, цену или фото в Poster.</div>

    <section class="review-section">
      <h3>Техкарта Poster</h3>
      <p>Показываем исходные строки и граммовки для проверки. Никаких изменений техкарты отсюда не отправляется.</p>
      <div class="recipe-table">
        ${recipeRows.length ? recipeRows.map((row) => `
          <div class="recipe-row">
            <div class="recipe-name">
              <strong>${esc(row.sourceName || row.name || '')}</strong>
              <small>${row.mappingTrusted ? `Нормализовано: ${esc(row.names?.ru || row.canonicalId || '')}` : 'Исходное значение Poster'}</small>
            </div>
            <div class="recipe-value">netto ${esc(row.netto ?? 0)} ${esc(row.unit || 'г')}</div>
            <div class="recipe-value">brutto ${esc(row.brutto ?? 0)}</div>
          </div>`).join('') : '<div class="empty-state">В техкарте нет строк ингредиентов.</div>'}
      </div>
    </section>

    <section class="review-section">
      <h3>Аллергены</h3>
      <p>Кандидаты рассчитаны из техкарты. Ресторан подтверждает или отклоняет их. Можно также добавить пропущенный аллерген вручную.</p>
      <div id="allergenEditor" class="allergen-editor">
        ${allergenIds.length ? allergenIds.map((id) => allergenEditorRow(product, id)).join('') : '<div id="noAllergensYet" class="empty-state">Кандидаты аллергенов не найдены.</div>'}
      </div>
      <div class="add-allergen-row">
        <select id="addAllergenSelect">${renderAddAllergenSelect(allergenIds)}</select>
        <button id="addAllergenBtn" class="secondary-btn" type="button">Добавить</button>
      </div>
    </section>

    <section class="review-section">
      <h3>Статус проверки</h3>
      <div class="form-grid">
        <div class="form-field">
          <label for="reviewStatusSelect">Проверка ресторана</label>
          <select id="reviewStatusSelect">
            <option value="needs_review" ${!isVerified(product) ? 'selected' : ''}>Требует проверки</option>
            <option value="verified" ${isVerified(product) ? 'selected' : ''}>Подтверждено рестораном</option>
          </select>
        </div>
        <div class="publish-row">
          <div><strong>Показывать гостям</strong><span>Отключение скрывает блюдо только в Smart Menu.</span></div>
          <label class="switch">
            <input id="productPublishToggle" type="checkbox" ${!isHidden(product) ? 'checked' : ''}>
            <span class="switch-slider"></span>
          </label>
        </div>
      </div>
    </section>`;

  $('#addAllergenBtn').addEventListener('click', () => {
    const select = $('#addAllergenSelect');
    const id = select.value;
    if (!id || $(`.allergen-edit-row[data-allergen-id="${CSS.escape(id)}"]`)) return;
    $('#noAllergensYet')?.remove();
    $('#allergenEditor').insertAdjacentHTML('beforeend', allergenEditorRow(product, id));
    const ids = $$('.allergen-edit-row').map((row) => row.dataset.allergenId);
    select.innerHTML = renderAddAllergenSelect(ids);
  });

  $('#drawerBackdrop').classList.remove('hidden');
  $('#productDrawer').classList.add('open');
  $('#productDrawer').setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeDrawer() {
  state.currentProductId = null;
  $('#drawerBackdrop').classList.add('hidden');
  $('#productDrawer').classList.remove('open');
  $('#productDrawer').setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function verifiedReason(removable) {
  if (removable) {
    return {
      ru: 'Ресторан подтвердил: источник аллергена можно исключить при приготовлении.',
      en: 'Restaurant confirmed: the allergen source can be omitted during preparation.',
      hy: 'Ռեստորանը հաստատել է․ ալերգենի աղբյուրը կարելի է չավելացնել պատրաստելիս։'
    };
  }
  return {
    ru: 'Ресторан подтвердил: источник аллергена нельзя безопасно исключить из блюда.',
    en: 'Restaurant confirmed: the allergen source cannot be safely removed from the dish.',
    hy: 'Ռեստորանը հաստատել է․ ալերգենի աղբյուրը չի կարելի անվտանգ հեռացնել ուտեստից։'
  };
}

async function saveCurrentProduct() {
  const product = state.products.find((item) => String(item._docId) === String(state.currentProductId));
  if (!product) return;

  const confirmed = [];
  const rejected = [];
  const publicAllergens = [];
  const customization = {};
  let suggestedCount = 0;

  for (const row of $$('.allergen-edit-row')) {
    const id = row.dataset.allergenId;
    const decision = row.querySelector('.allergen-decision').value;
    const removability = row.querySelector('.allergen-removability').value;
    if (decision === 'rejected') {
      rejected.push(id);
      continue;
    }
    if (decision === 'confirmed') confirmed.push(id);
    else suggestedCount += 1;
    publicAllergens.push({
      id,
      status: decision === 'confirmed' ? 'confirmed' : 'suggested',
      source: decision === 'confirmed' ? 'restaurant_review' : 'restaurant_review_pending',
      ...(decision === 'confirmed' ? { restaurantVerified: true } : {})
    });

    if (decision === 'confirmed' && ['removable', 'fixed'].includes(removability)) {
      const removable = removability === 'removable';
      customization[id] = {
        status: 'confirmed',
        restaurantVerified: true,
        removable,
        reason: verifiedReason(removable),
        updatedBy: state.user.uid,
        updatedAt: serverTimestamp()
      };
    }
  }

  const reviewStatus = $('#reviewStatusSelect').value;
  if (reviewStatus === 'verified' && suggestedCount > 0) {
    showToast('Сначала подтвердите или отклоните все аллерген-кандидаты.', true);
    return;
  }

  const payload = {
    smartMenuPublished: $('#productPublishToggle').checked,
    allergens: publicAllergens,
    allergenReview: {
      confirmed,
      rejected,
      updatedBy: state.user.uid,
      updatedAt: serverTimestamp()
    },
    allergenCustomization: customization,
    restaurantReview: {
      status: reviewStatus,
      reviewedBy: state.user.uid,
      reviewedAt: serverTimestamp()
    },
    updatedAt: serverTimestamp()
  };

  const button = $('#saveProductBtn');
  button.disabled = true;
  button.textContent = 'Сохраняем…';
  try {
    await updateDoc(doc(db, 'restaurants', restaurantId, 'products', product._docId), payload);
    product.smartMenuPublished = payload.smartMenuPublished;
    product.allergens = publicAllergens;
    product.allergenReview = { confirmed, rejected, updatedBy: state.user.uid };
    product.allergenCustomization = Object.fromEntries(Object.entries(customization).map(([id, rule]) => [id, { ...rule, updatedAt: null }]));
    product.restaurantReview = { status: reviewStatus, reviewedBy: state.user.uid };
    renderStats();
    renderProducts();
    showToast('Проверка блюда сохранена');
    closeDrawer();
  } catch (error) {
    console.error(error);
    showToast('Firestore не разрешил сохранить изменения. Проверьте права администратора и Rules.', true);
  } finally {
    button.disabled = false;
    button.textContent = 'Сохранить проверку';
  }
}

$('#signInBtn').addEventListener('click', signInAdmin);
$('#signOutBtn').addEventListener('click', () => signOut(auth));
$('#retryAccessBtn').addEventListener('click', () => state.user && checkAccess(state.user));
$('#copyUidBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.user?.uid || '');
    showToast('UID скопирован');
  } catch (_) {
    showToast('Не удалось скопировать UID', true);
  }
});
$('#productSearch').addEventListener('input', (event) => {
  state.query = event.target.value.trim();
  renderProducts();
});
$('#productFilter').addEventListener('change', (event) => {
  state.productFilter = event.target.value;
  renderProducts();
});
$$('.nav-btn').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
$('#closeDrawerBtn').addEventListener('click', closeDrawer);
$('#drawerBackdrop').addEventListener('click', closeDrawer);
$('#saveProductBtn').addEventListener('click', saveCurrentProduct);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDrawer(); });

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    state.user = null;
    state.admin = null;
    $('#signOutBtn').classList.add('hidden');
    showOnly('authView');
    return;
  }
  await checkAccess(user);
});
