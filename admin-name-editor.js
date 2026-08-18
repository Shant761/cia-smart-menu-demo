import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  deleteField,
  doc,
  getDoc,
  getFirestore,
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

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const restaurantId = new URLSearchParams(window.location.search).get('restaurant') || 'poster-test';
const LANGS = ['hy', 'ru', 'en'];
let currentProductId = null;
let currentProduct = null;
let currentAnalysis = null;
let renderTimer = null;
let booted = false;

const $ = (selector) => document.querySelector(selector);
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const esc = (value) => clean(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');
const baseNames = (value) => ({
  hy: clean(value?.hy),
  ru: clean(value?.ru),
  en: clean(value?.en)
});

function ingredientKey(row, index) {
  const id = row?.posterIngredientId ?? row?.ingredientId;
  if (id !== null && id !== undefined && clean(id)) return `id:${clean(id)}`;
  return `name:${clean(row?.sourceName ?? row?.name ?? '') || `row-${index}`}`;
}

function ensureStyles() {
  if ($('#adminNameEditorStyles')) return;
  const style = document.createElement('style');
  style.id = 'adminNameEditorStyles';
  style.textContent = `
    .name-editor { margin:16px 0; padding:16px; border:1px solid #e2e0d8; border-radius:18px; background:#fbfaf6; }
    .name-editor h3 { margin:0 0 6px; font-size:18px; }
    .name-editor-note { margin:0 0 14px; color:#716c62; font-size:13px; line-height:1.45; }
    .name-editor-source { margin:0 0 12px; padding:10px 12px; border-radius:12px; background:#f0eee7; color:#625e55; font-size:12px; }
    .name-editor-source strong { color:#292821; }
    .name-editor-field { margin:10px 0; }
    .name-editor-field label { display:block; margin-bottom:6px; font-size:12px; font-weight:800; color:#5f5a51; }
    .name-editor-field input { width:100%; box-sizing:border-box; padding:11px 12px; border:1px solid #d9d6cc; border-radius:11px; background:white; font:inherit; color:#24251f; }
    .name-editor-field input:focus { outline:2px solid #b9d6bf; border-color:#5b8d68; }
    .ingredient-editor-row { margin:14px 0; padding-top:14px; border-top:1px solid #e5e2da; }
    .ingredient-editor-title { font-weight:800; margin-bottom:5px; }
    .ingredient-editor-source { color:#777166; font-size:12px; margin-bottom:8px; }
    .name-editor-footer { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
    .name-editor-footer button { min-height:42px; }
    .name-editor-reset { background:#f2efe7 !important; color:#3f3c34 !important; }
    .name-editor-status { font-size:12px; color:#5d665d; margin-top:12px; }
    @media (max-width:640px) { .name-editor { padding:13px; } }
  `;
  document.head.appendChild(style);
}

function getIngredientRows(product, analysis) {
  const recipe = Array.isArray(product?.posterRecipeIngredients) ? product.posterRecipeIngredients : [];
  const normalized = Array.isArray(analysis?.normalizedIngredients) ? analysis.normalizedIngredients : [];
  const ingredientLists = product?.ingredients || {};
  return recipe.map((row, index) => {
    const normalizedRow = normalized[index] || {};
    const names = baseNames(normalizedRow.names || {
      hy: ingredientLists.hy?.[index] || row?.name,
      ru: ingredientLists.ru?.[index] || row?.name,
      en: ingredientLists.en?.[index] || row?.name
    });
    return {
      index,
      key: ingredientKey({ ...row, ...normalizedRow }, index),
      sourceName: clean(normalizedRow.sourceName || row?.name || ''),
      names
    };
  });
}

function effectiveName(product) {
  return { ...baseNames(product?.name), ...baseNames(product?.nameOverrides) };
}

function effectiveIngredientNames(row, overrides) {
  return { ...row.names, ...baseNames(overrides?.[row.key]) };
}

async function loadProduct(productId) {
  const [productSnap, analysisSnap] = await Promise.all([
    getDoc(doc(db, 'restaurants', restaurantId, 'products', productId)),
    getDoc(doc(db, 'restaurants', restaurantId, 'product_analysis', productId))
  ]);
  if (!productSnap.exists()) throw new Error('Блюдо не найдено.');
  currentProduct = productSnap.data();
  currentAnalysis = analysisSnap.exists() ? analysisSnap.data() : null;
  return currentProduct;
}

function addFooterButtons() {
  const footer = $('.drawer-footer');
  if (!footer || $('#saveNameOverridesBtn')) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'name-editor-footer';
  wrapper.innerHTML = `
    <button id="saveNameOverridesBtn" class="secondary-btn" type="button">Сохранить названия</button>
    <button id="resetNameOverridesBtn" class="secondary-btn name-editor-reset" type="button">Сбросить ручные названия</button>
  `;
  footer.insertBefore(wrapper, $('#saveProductBtn'));
  $('#saveNameOverridesBtn').addEventListener('click', saveOverrides);
  $('#resetNameOverridesBtn').addEventListener('click', resetOverrides);
}

function renderEditor() {
  if (!currentProduct || !currentProductId || !$('#drawerBody')) return;
  ensureStyles();
  addFooterButtons();
  $('#drawerBody').querySelector('#nameEditor')?.remove();

  const name = effectiveName(currentProduct);
  const rows = getIngredientRows(currentProduct, currentAnalysis);
  const overrides = currentProduct.ingredientNameOverrides || {};

  const ingredientMarkup = rows.length
    ? rows.map((row) => {
        const values = effectiveIngredientNames(row, overrides);
        return `
          <div class="ingredient-editor-row" data-ingredient-key="${esc(row.key)}">
            <div class="ingredient-editor-title">Ингредиент ${row.index + 1}</div>
            <div class="ingredient-editor-source">Источник Poster: <strong>${esc(row.sourceName || '—')}</strong></div>
            ${LANGS.map((lang) => `
              <div class="name-editor-field">
                <label>${lang.toUpperCase()}</label>
                <input class="ingredient-name-input" data-lang="${lang}" type="text" value="${esc(values[lang])}" autocomplete="off">
              </div>
            `).join('')}
          </div>`;
      }).join('')
    : '<p class="name-editor-note">В этой позиции нет доступных строк состава для редактирования названий.</p>';

  const editor = document.createElement('section');
  editor.id = 'nameEditor';
  editor.className = 'name-editor';
  editor.innerHTML = `
    <h3>✏️ Названия</h3>
    <p class="name-editor-note">Здесь можно исправлять только отображаемые названия. Техкарта Poster, состав, граммы, цена, фото и данные аллергенов этим разделом не изменяются.</p>
    <div class="name-editor-source">Исходное название Poster: <strong>${esc(currentProduct.posterOriginalName || currentProduct.name?.hy || '—')}</strong></div>
    ${LANGS.map((lang) => `
      <div class="name-editor-field">
        <label>${lang.toUpperCase()}</label>
        <input id="product-name-${lang}" class="product-name-input" data-lang="${lang}" type="text" value="${esc(name[lang])}" autocomplete="off">
      </div>
    `).join('')}
    <div class="name-editor-source" style="margin-top:18px;"><strong>Названия ингредиентов</strong> — каждый ингредиент редактируется отдельно.</div>
    ${ingredientMarkup}
    <div class="name-editor-status" id="nameEditorStatus"></div>
  `;
  $('#drawerBody').prepend(editor);
}

async function openForProduct(productId) {
  currentProductId = String(productId);
  try {
    await loadProduct(currentProductId);
    renderEditor();
  } catch (error) {
    console.error(error);
  }
}

function collectOverrides() {
  const nameBase = baseNames(currentProduct?.name);
  const nameOverride = {};
  for (const lang of LANGS) {
    const value = clean($(`#product-name-${lang}`)?.value);
    if (value && value !== nameBase[lang]) nameOverride[lang] = value;
  }

  const ingredientOverrides = {};
  const baseRows = getIngredientRows(currentProduct, currentAnalysis);
  for (const row of baseRows) {
    const container = $(`.ingredient-editor-row[data-ingredient-key="${CSS.escape(row.key)}"]`);
    if (!container) continue;
    const base = row.names;
    const values = {};
    for (const lang of LANGS) {
      const value = clean(container.querySelector(`.ingredient-name-input[data-lang="${lang}"]`)?.value);
      if (value && value !== base[lang]) values[lang] = value;
    }
    if (Object.keys(values).length) ingredientOverrides[row.key] = values;
  }
  return { nameOverride, ingredientOverrides };
}

async function saveOverrides() {
  if (!currentProductId || !currentProduct) return;
  const button = $('#saveNameOverridesBtn');
  const status = $('#nameEditorStatus');
  button.disabled = true;
  button.textContent = 'Сохраняем…';
  try {
    const { nameOverride, ingredientOverrides } = collectOverrides();
    const ref = doc(db, 'restaurants', restaurantId, 'products', currentProductId);
    await updateDoc(ref, {
      nameOverrides: Object.keys(nameOverride).length ? nameOverride : deleteField(),
      ingredientNameOverrides: Object.keys(ingredientOverrides).length ? ingredientOverrides : deleteField()
    });
    status.textContent = '✓ Названия сохранены.';
    await loadProduct(currentProductId);
    renderEditor();
  } catch (error) {
    console.error(error);
    status.textContent = `Не удалось сохранить: ${clean(error?.message || error)}`;
  } finally {
    button.disabled = false;
    button.textContent = 'Сохранить названия';
  }
}

async function resetOverrides() {
  if (!currentProductId) return;
  if (!confirm('Сбросить ручные названия и вернуть автоматические?')) return;
  const button = $('#resetNameOverridesBtn');
  const status = $('#nameEditorStatus');
  button.disabled = true;
  try {
    await updateDoc(doc(db, 'restaurants', restaurantId, 'products', currentProductId), {
      nameOverrides: deleteField(),
      ingredientNameOverrides: deleteField()
    });
    status.textContent = '✓ Ручные названия сброшены.';
    await loadProduct(currentProductId);
    renderEditor();
  } catch (error) {
    console.error(error);
    status.textContent = `Не удалось сбросить: ${clean(error?.message || error)}`;
  } finally {
    button.disabled = false;
  }
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderEditor, 60);
}

function boot() {
  if (booted) return;
  booted = true;
  ensureStyles();
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-open-product]');
    if (!button) return;
    currentProductId = String(button.dataset.openProduct);
    setTimeout(() => openForProduct(currentProductId), 100);
  }, true);

  const drawerBody = $('#drawerBody');
  if (drawerBody) {
    new MutationObserver(scheduleRender).observe(drawerBody, { childList: true, subtree: true });
  }

  const drawer = $('#productDrawer');
  if (drawer) new MutationObserver(scheduleRender).observe(drawer, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
}

if (auth.currentUser) boot();
else {
  const unsubscribe = auth.onAuthStateChanged((user) => {
    if (user) {
      unsubscribe();
      boot();
    }
  });
}
