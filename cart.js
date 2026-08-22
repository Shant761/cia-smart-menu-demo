(() => {
  const state = {
    items: new Map(),
    products: [],
    lang: localStorage.getItem('ciaSmartMenuPrefs') ? (JSON.parse(localStorage.getItem('ciaSmartMenuPrefs')).lang || 'ru') : 'ru'
  };

  const $ = (s) => document.querySelector(s);
  const txt = (obj) => obj?.[state.lang] || obj?.ru || obj?.en || '';
  const copy = {
    ru: { add: 'Добавить', added: 'Добавлено', cart: 'Корзина', empty: 'Корзина пока пуста', emptyHint: 'Добавляйте блюда прямо из меню.', total: 'Итого', order: 'Перейти к заказу', close: 'Закрыть', remove: 'Удалить' },
    en: { add: 'Add', added: 'Added', cart: 'Cart', empty: 'Your cart is empty', emptyHint: 'Add dishes directly from the menu.', total: 'Total', order: 'Continue to order', close: 'Close', remove: 'Remove' },
    hy: { add: 'Ավելացնել', added: 'Ավելացված է', cart: 'Զամբյուղ', empty: 'Զամբյուղը դատարկ է', emptyHint: 'Ավելացրեք ուտեստները անմիջապես մենյուից։', total: 'Ընդամենը', order: 'Անցնել պատվերին', close: 'Փակել', remove: 'Հեռացնել' }
  };
  const tr = (k) => copy[state.lang]?.[k] || copy.ru[k];

  function save() {
    localStorage.setItem('ciaSmartMenuCart', JSON.stringify([...state.items.values()]));
  }

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem('ciaSmartMenuCart') || '[]');
      raw.forEach(item => state.items.set(String(item.id), item));
    } catch (_) {}
  }

  function totalCount() {
    return [...state.items.values()].reduce((sum, item) => sum + item.qty, 0);
  }

  function totalPrice() {
    return [...state.items.values()].reduce((sum, item) => sum + item.price * item.qty, 0);
  }

  function money(value) {
    return `${Number(value).toLocaleString(state.lang === 'hy' ? 'hy-AM' : state.lang === 'en' ? 'en-US' : 'ru-RU')} ֏`;
  }

  function add(id) {
    const product = state.products.find(p => String(p.id) === String(id));
    if (!product) return;
    const key = String(product.id);
    const current = state.items.get(key);
    state.items.set(key, {
      id: product.id,
      name: product.name,
      emoji: product.emoji || '🍽️',
      price: Number(product.price) || 0,
      qty: current ? current.qty + 1 : 1
    });
    save();
    render();
    markAdded(id);
  }

  function change(id, delta) {
    const item = state.items.get(String(id));
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) state.items.delete(String(id));
    save();
    render();
  }

  function markAdded(id) {
    const button = document.querySelector(`.cart-add[data-cart-product="${CSS.escape(String(id))}"]`);
    if (!button) return;
    button.classList.add('is-added');
    button.textContent = '✓ ' + tr('added');
    setTimeout(() => {
      if (document.body.contains(button)) {
        button.classList.remove('is-added');
        button.textContent = '+ ' + tr('add');
      }
    }, 900);
  }

  function enhanceCards() {
    document.querySelectorAll('.dish-card[data-product-id]').forEach(card => {
      if (card.querySelector('.cart-add')) return;
      const id = card.dataset.productId;
      const content = card.querySelector('.dish-content');
      if (!content) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cart-add';
      button.dataset.cartProduct = id;
      button.textContent = '+ ' + tr('add');
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        add(id);
      });
      content.appendChild(button);
    });
  }

  function render() {
    const count = totalCount();
    const bar = $('#cartBar');
    if (bar) {
      bar.classList.toggle('hidden', count === 0);
      $('#cartCount').textContent = count;
      $('#cartTotal').textContent = money(totalPrice());
      $('#cartBarLabel').textContent = tr('cart');
    }

    const title = $('#cartTitle');
    if (title) title.textContent = tr('cart');

    const list = $('#cartItems');
    if (!list) return;
    const items = [...state.items.values()];
    if (!items.length) {
      list.innerHTML = `<div class="cart-empty"><div class="cart-empty-icon">🛒</div><h3>${tr('empty')}</h3><p>${tr('emptyHint')}</p></div>`;
    } else {
      list.innerHTML = items.map(item => `
        <div class="cart-item">
          <div class="cart-item-icon">${item.emoji}</div>
          <div class="cart-item-main">
            <strong>${txt(item.name)}</strong>
            <span>${money(item.price)}</span>
          </div>
          <div class="cart-stepper">
            <button type="button" data-cart-minus="${item.id}" aria-label="−">−</button>
            <b>${item.qty}</b>
            <button type="button" data-cart-plus="${item.id}" aria-label="+">+</button>
          </div>
        </div>`).join('');
    }
    $('#cartSubtotal').textContent = money(totalPrice());
    $('#cartOrderBtn').disabled = !items.length;
  }

  function open() {
    $('#cartBackdrop')?.classList.remove('hidden');
    $('#cartSheet')?.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    $('#cartBackdrop')?.classList.add('hidden');
    $('#cartSheet')?.classList.remove('open');
    document.body.style.overflow = '';
  }

  async function init() {
    load();
    try {
      const response = await fetch('data/products.json');
      if (response.ok) state.products = (await response.json()).products || [];
    } catch (_) {}

    document.addEventListener('click', (event) => {
      if (event.target.closest('#cartBar')) open();
      if (event.target.closest('#closeCartSheet') || event.target.closest('#cartBackdrop')) close();
      const plus = event.target.closest('[data-cart-plus]');
      const minus = event.target.closest('[data-cart-minus]');
      if (plus) change(plus.dataset.cartPlus, 1);
      if (minus) change(minus.dataset.cartMinus, -1);
      if (event.target.closest('#cartOrderBtn')) {
        alert(state.lang === 'hy' ? 'Պատվերի ձևավորումը կլինի հաջորդ փուլում։' : state.lang === 'en' ? 'Checkout will be connected in the next step.' : 'Оформление заказа подключим следующим этапом.');
      }
    });

    const observer = new MutationObserver(enhanceCards);
    observer.observe(document.body, { childList: true, subtree: true });
    enhanceCards();
    render();
  }

  window.addEventListener('storage', () => render());
  window.addEventListener('cia:language-changed', (event) => {
    state.lang = event.detail?.lang || state.lang;
    render();
    enhanceCards();
  });

  init();
})();
