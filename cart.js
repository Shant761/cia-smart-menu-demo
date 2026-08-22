(() => {
  const state = {
    items: new Map(),
    products: [],
    lang: localStorage.getItem('ciaSmartMenuPrefs') ? (JSON.parse(localStorage.getItem('ciaSmartMenuPrefs')).lang || 'ru') : 'ru'
  };

  const BACKEND_URL = 'https://cia-smart-menu-demo.vercel.app/api/create-order';
  const $ = (s) => document.querySelector(s);
  const txt = (obj) => obj?.[state.lang] || obj?.ru || obj?.en || '';
  const copy = {
    ru: { add: 'Добавить', added: 'Добавлено', cart: 'Корзина', empty: 'Корзина пока пуста', emptyHint: 'Добавляйте блюда прямо из меню.', total: 'Итого', order: 'Оформить заказ', close: 'Закрыть', remove: 'Удалить', checkout: 'Оформление заказа', phone: 'Телефон', table: 'Стол', comment: 'Комментарий', send: 'Отправить заказ', sending: 'Отправляем…', success: 'Заказ отправлен', successHint: 'Заказ принят Poster.', error: 'Не удалось отправить заказ', required: 'Укажите номер телефона и стол.' },
    en: { add: 'Add', added: 'Added', cart: 'Cart', empty: 'Your cart is empty', emptyHint: 'Add dishes directly from the menu.', total: 'Total', order: 'Checkout', close: 'Close', remove: 'Remove', checkout: 'Checkout', phone: 'Phone', table: 'Table', comment: 'Comment', send: 'Send order', sending: 'Sending…', success: 'Order sent', successHint: 'Order accepted by Poster.', error: 'Could not send order', required: 'Enter phone number and table.' },
    hy: { add: 'Ավելացնել', added: 'Ավելացված է', cart: 'Զամբյուղ', empty: 'Զամբյուղը դատարկ է', emptyHint: 'Ավելացրեք ուտեստները անմիջապես մենյուից։', total: 'Ընդամենը', order: 'Ձևակերպել պատվեր', close: 'Փակել', remove: 'Հեռացնել', checkout: 'Պատվերի ձևակերպում', phone: 'Հեռախոս', table: 'Սեղան', comment: 'Մեկնաբանություն', send: 'Ուղարկել պատվերը', sending: 'Ուղարկվում է…', success: 'Պատվերն ուղարկված է', successHint: 'Պատվերն ընդունվել է Poster-ի կողմից։', error: 'Չհաջողվեց ուղարկել պատվերը', required: 'Մուտքագրեք հեռախոսահամարը և սեղանը։' }
  };
  const tr = (k) => copy[state.lang]?.[k] || copy.ru[k];

  function save() { localStorage.setItem('ciaSmartMenuCart', JSON.stringify([...state.items.values()])); }
  function load() { try { JSON.parse(localStorage.getItem('ciaSmartMenuCart') || '[]').forEach(item => state.items.set(String(item.id), item)); } catch (_) {} }
  function totalCount() { return [...state.items.values()].reduce((sum, item) => sum + item.qty, 0); }
  function totalPrice() { return [...state.items.values()].reduce((sum, item) => sum + item.price * item.qty, 0); }
  function money(value) { return `${Number(value).toLocaleString(state.lang === 'hy' ? 'hy-AM' : state.lang === 'en' ? 'en-US' : 'ru-RU')} ֏`; }

  function add(id) {
    const product = state.products.find(p => String(p.id) === String(id));
    if (!product) return;
    const key = String(product.id);
    const current = state.items.get(key);
    state.items.set(key, { id: product.id, name: product.name, emoji: product.emoji || '🍽️', price: Number(product.price) || 0, qty: current ? current.qty + 1 : 1 });
    save(); render(); markAdded(id);
  }

  function change(id, delta) {
    const item = state.items.get(String(id));
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) state.items.delete(String(id));
    save(); render();
  }

  function markAdded(id) {
    const button = document.querySelector(`.cart-add[data-cart-product="${CSS.escape(String(id))}"]`);
    if (!button) return;
    button.classList.add('is-added'); button.textContent = '✓ ' + tr('added');
    setTimeout(() => { if (document.body.contains(button)) { button.classList.remove('is-added'); button.textContent = '+ ' + tr('add'); } }, 900);
  }

  function enhanceCards() {
    document.querySelectorAll('.dish-card[data-product-id]').forEach(card => {
      if (card.querySelector('.cart-add')) return;
      const id = card.dataset.productId;
      const content = card.querySelector('.dish-content');
      if (!content) return;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'cart-add'; button.dataset.cartProduct = id; button.textContent = '+ ' + tr('add');
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); add(id); });
      content.appendChild(button);
    });
  }

  function render() {
    const count = totalCount();
    const bar = $('#cartBar');
    if (bar) { bar.classList.toggle('hidden', count === 0); $('#cartCount').textContent = count; $('#cartTotal').textContent = money(totalPrice()); $('#cartBarLabel').textContent = tr('cart'); }
    if ($('#cartTitle')) $('#cartTitle').textContent = tr('cart');
    const list = $('#cartItems');
    if (!list) return;
    const items = [...state.items.values()];
    list.innerHTML = items.length ? items.map(item => `<div class="cart-item"><div class="cart-item-icon">${item.emoji}</div><div class="cart-item-main"><strong>${txt(item.name)}</strong><span>${money(item.price)}</span></div><div class="cart-stepper"><button type="button" data-cart-minus="${item.id}">−</button><b>${item.qty}</b><button type="button" data-cart-plus="${item.id}">+</button></div></div>`).join('') : `<div class="cart-empty"><div class="cart-empty-icon">🛒</div><h3>${tr('empty')}</h3><p>${tr('emptyHint')}</p></div>`;
    $('#cartSubtotal').textContent = money(totalPrice());
    $('#cartOrderBtn').disabled = !items.length;
  }

  function open() { $('#cartBackdrop')?.classList.remove('hidden'); $('#cartSheet')?.classList.add('open'); document.body.style.overflow = 'hidden'; }
  function close() { $('#cartBackdrop')?.classList.add('hidden'); $('#cartSheet')?.classList.remove('open'); document.body.style.overflow = ''; }

  function ensureCheckout() {
    if ($('#checkoutSheet')) return;
    document.body.insertAdjacentHTML('beforeend', `<div id="checkoutBackdrop" class="backdrop hidden"></div><aside id="checkoutSheet" class="bottom-sheet cart-sheet" aria-hidden="true"><div class="sheet-handle"></div><div class="sheet-header"><div><span class="eyebrow">ORDER</span><h2 id="checkoutTitle">${tr('checkout')}</h2></div><button class="icon-btn" id="closeCheckout" type="button">×</button></div><div class="checkout-form"><label>${tr('phone')}<input id="checkoutPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+374 98 615 005"></label><label>${tr('table')}<input id="checkoutTable" type="number" min="1" max="999" inputmode="numeric" placeholder="1"></label><label>${tr('comment')}<textarea id="checkoutComment" rows="3" maxlength="1000" placeholder=""></textarea></label><div id="checkoutMessage" class="checkout-message hidden"></div><button id="sendOrderBtn" class="primary-btn cart-order-btn" type="button">${tr('send')}</button></div></aside>`);
  }

  function openCheckout() {
    if (!state.items.size) return;
    ensureCheckout(); close();
    $('#checkoutBackdrop')?.classList.remove('hidden'); $('#checkoutSheet')?.classList.add('open'); document.body.style.overflow = 'hidden';
  }
  function closeCheckout() { $('#checkoutBackdrop')?.classList.add('hidden'); $('#checkoutSheet')?.classList.remove('open'); document.body.style.overflow = ''; }

  async function sendOrder() {
    const phone = $('#checkoutPhone')?.value.trim();
    const spotId = Number($('#checkoutTable')?.value);
    const message = $('#checkoutMessage');
    const button = $('#sendOrderBtn');
    if (!/^\+?[0-9]{8,15}$/.test(phone.replace(/[\s()-]/g, '')) || !Number.isInteger(spotId) || spotId < 1) {
      message.textContent = tr('required'); message.className = 'checkout-message error'; return;
    }
    const products = [...state.items.values()].map(item => ({ product_id: Number(item.id), count: Number(item.qty) }));
    button.disabled = true; button.textContent = tr('sending'); message.className = 'checkout-message hidden';
    try {
      const response = await fetch(BACKEND_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true, phone, spot_id: spotId, first_name: 'CIA Smart Menu', comment: $('#checkoutComment')?.value.trim() || 'CIA Smart Menu order', products }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Order failed');
      state.items.clear(); save(); render();
      message.textContent = `${tr('success')}. ${tr('successHint')}`; message.className = 'checkout-message success';
      button.textContent = '✓ ' + tr('success');
    } catch (error) {
      message.textContent = `${tr('error')}: ${error.message}`; message.className = 'checkout-message error';
      button.disabled = false; button.textContent = tr('send');
    }
  }

  async function init() {
    load();
    try { const response = await fetch('data/products.json'); if (response.ok) state.products = (await response.json()).products || []; } catch (_) {}
    document.addEventListener('click', event => {
      if (event.target.closest('#cartBar')) open();
      if (event.target.closest('#closeCartSheet') || event.target.closest('#cartBackdrop')) close();
      if (event.target.closest('#cartOrderBtn')) openCheckout();
      if (event.target.closest('#closeCheckout') || event.target.closest('#checkoutBackdrop')) closeCheckout();
      if (event.target.closest('#sendOrderBtn')) sendOrder();
      const plus = event.target.closest('[data-cart-plus]'); const minus = event.target.closest('[data-cart-minus]');
      if (plus) change(plus.dataset.cartPlus, 1); if (minus) change(minus.dataset.cartMinus, -1);
    });
    const observer = new MutationObserver(enhanceCards); observer.observe(document.body, { childList: true, subtree: true });
    enhanceCards(); render();
  }

  window.addEventListener('storage', () => render());
  window.addEventListener('cia:language-changed', event => { state.lang = event.detail?.lang || state.lang; render(); enhanceCards(); });
  init();
})();
