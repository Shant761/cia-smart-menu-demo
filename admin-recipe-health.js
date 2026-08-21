import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { collection, getDocs, getFirestore } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCE3QRts6mWqkDFySX8F4Bim7dIb7IaLq0',
  authDomain: 'cia-smart-menu.firebaseapp.com',
  projectId: 'cia-smart-menu',
  storageBucket: 'cia-smart-menu.firebasestorage.app',
  messagingSenderId: '62965932851',
  appId: '1:62965932851:web:56a31d76521be03fda9446'
};

const app = initializeApp(firebaseConfig, 'recipe-health');
const auth = getAuth(app);
const db = getFirestore(app);
const restaurantId = new URLSearchParams(window.location.search).get('restaurant') || 'poster-test';

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

function issueLabel(issue) {
  const labels = {
    unresolved_preparation: 'Полуфабрикат не раскрыт',
    loader_error: 'Ошибка загрузки полуфабриката',
    missing_preparation_id: 'У полуфабриката нет ID',
    cycle: 'Обнаружен цикл в техкарте',
    max_depth: 'Превышена глубина техкарты',
    product_recipe_load_error: 'Не удалось загрузить техкарту блюда'
  };
  return labels[issue?.type] || issue?.type || 'Неизвестная проблема';
}

function issueDetails(product) {
  const issues = Array.isArray(product?.recipeIssues?.issues) ? product.recipeIssues.issues : [];
  const preparations = Array.isArray(product?.recipe?.preparations) ? product.recipe.preparations : [];
  const unresolved = preparations.filter((item) => item.status !== 'resolved');
  const sourceIngredients = Array.isArray(product?.posterRecipeSource?.ingredients) ? product.posterRecipeSource.ingredients : [];

  const issueRows = issues.map((issue) => `
    <div class="recipe-health-issue">
      <strong>${esc(issueLabel(issue))}</strong>
      <span>Путь: ${esc(issue.path || '—')}</span>
      ${issue.message ? `<code>${esc(issue.message)}</code>` : ''}
    </div>`).join('');

  const prepRows = unresolved.map((prep) => `
    <div class="recipe-health-prep">
      <strong>${esc(prep.name || prep.id || 'Полуфабрикат')}</strong>
      <span>ID: ${esc(prep.id || '—')} · статус: ${esc(prep.status || '—')}</span>
      <small>Путь: ${esc(prep.path || prep.name || '—')}</small>
    </div>`).join('');

  const sourceRows = sourceIngredients.map((item) => {
    const preparationId = item?.preparation_id ?? item?.preparationId ?? item?.prep_id ?? item?.prepId;
    const ingredientId = item?.ingredient_id ?? item?.ingredientId;
    return `<div class="recipe-health-source-row"><span>${esc(item?.ingredient_name || item?.preparation_name || item?.name || '—')}</span><code>${esc(preparationId ? `preparation_id=${preparationId}` : ingredientId ? `ingredient_id=${ingredientId}` : 'Poster component')}</code></div>`;
  }).join('');

  return `
    ${issueRows || '<div class="recipe-health-ok">Проблемы не обнаружены.</div>'}
    ${prepRows ? `<div class="recipe-health-subtitle">Нераскрытые полуфабрикаты</div>${prepRows}` : ''}
    <details class="recipe-health-source">
      <summary>Показать исходник Poster</summary>
      <div class="recipe-health-source-list">${sourceRows || '<span>Исходные строки техкарты не сохранены.</span>'}</div>
    </details>`;
}

async function renderHealth() {
  const panel = document.getElementById('recipeHealthPanel');
  if (!panel) return;
  try {
    const snapshot = await getDocs(collection(db, 'restaurants', restaurantId, 'products'));
    const products = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((product) => product.source === 'poster');
    const problematic = products.filter((product) => product.recipeIssues?.hasIssues === true);

    panel.classList.toggle('hidden', problematic.length === 0);
    if (!problematic.length) return;

    panel.innerHTML = `
      <div class="recipe-health-head">
        <div>
          <span class="eyebrow">КОНТРОЛЬ ТЕХКАРТ</span>
          <h2>Есть проблемы с раскрытием состава</h2>
          <p>Исходник Poster сохранён отдельно и доступен только для чтения. Smart Menu не будет считать нераскрытый полуфабрикат полностью проверенным.</p>
        </div>
        <span class="recipe-health-count">${problematic.length} блюд</span>
      </div>
      <div class="recipe-health-list">
        ${problematic.map((product) => `
          <article class="recipe-health-card">
            <div class="recipe-health-card-head">
              <strong>${esc(product?.name?.ru || product?.posterOriginalName || product.id)}</strong>
              <span class="badge review">Требует проверки</span>
            </div>
            <small>Poster ID: ${esc(product.posterProductId || product.id)}</small>
            <div class="recipe-health-body">${issueDetails(product)}</div>
          </article>`).join('')}
      </div>`;
  } catch (error) {
    console.error('[Recipe health]', error);
    panel.classList.remove('hidden');
    panel.innerHTML = '<div class="notice error">Не удалось загрузить контроль техкарт.</div>';
  }
}

onAuthStateChanged(auth, (user) => {
  if (user) setTimeout(renderHealth, 700);
});
