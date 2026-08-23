import '../firebase-client.js';

const params = new URLSearchParams(location.search);
const restaurantId = params.get('restaurant') || 'ciasift';
const state = { menu: { categories: [], products: [] }, category: 'all', query: '' };
const $ = (s) => document.querySelector(s);
const text = (v) => typeof v === 'string' ? v : v?.ru || v?.en || v?.hy || Object.values(v || {})[0] || '';
const id = (v) => typeof v === 'object' ? String(v?.id ?? v?.categoryId ?? '') : String(v ?? '');

function price(p) {
  const raw = Number(p?.price);
  if (!Number.isFinite(raw)) return '—';
  const value = raw >= 100000 ? raw / 100 : raw;
  return `${Math.round(value).toLocaleString('ru-RU')} ֏`;
}
function categoryOf(p) { return id(p?.categoryId ?? p?.category ?? p?.menuCategoryId); }
function visible() {
  return state.menu.products.filter((p) => {
    if (state.category !== 'all' && categoryOf(p) !== state.category) return false;
    return !state.query || text(p.name).toLowerCase().includes(state.query);
  });
}
function renderCategories() {
  const el = $('#categories');
  el.innerHTML = [{ id: 'all', name: 'Все' }, ...state.menu.categories].map((c) =>
    `<button class="category ${String(c.id) === state.category ? 'active' : ''}" data-id="${c.id}">${text(c.name)}</button>`).join('');
  el.querySelectorAll('button').forEach((b) => b.onclick = () => { state.category = b.dataset.id; render(); });
}
function render() {
  const list = visible();
  $('#count').textContent = `${list.length} блюд`;
  $('#products').innerHTML = list.map((p) => {
    const image = p.photo || p.image || p.imageUrl || p.photo_url || '';
    return `<article class="card" data-id="${p.id}"><div class="photo">${image ? `<img src="${image}" alt="${text(p.name)}" loading="lazy">` : 'Нет фото'}</div><div class="info"><h2>${text(p.name) || 'Без названия'}</h2><div class="price">${price(p)}</div></div></article>`;
  }).join('') || '<p>Блюда не найдены.</p>';
  renderCategories();
}
async function waitForFirebase() {
  if (window.ciaFirebase?.ready) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Firebase initialization timeout')), 10000);
    window.addEventListener('cia:firebase-ready', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
async function load() {
  try {
    await waitForFirebase();
    state.menu = await window.ciaFirebase.loadPublicMenu(restaurantId);
    $('#restaurantName').textContent = text(state.menu.restaurant?.name) || restaurantId;
    render();
  } catch (e) {
    console.error(e);
    $('#error').hidden = false;
    $('#error').textContent = `Не удалось загрузить меню: ${e.message}`;
    $('#restaurantName').textContent = restaurantId;
  }
}
$('#search').oninput = (e) => { state.query = e.target.value.trim().toLowerCase(); render(); };
load();
