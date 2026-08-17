// CIA Smart Menu — Online Waiter demo layer.
// Keeps the customer flow fully client-side for now. Poster submission will be
// connected through a backend endpoint in the next integration step.

const waiterCopy = {
  ru: {
    title: 'Онлайн-официант', subtitle: 'Ваш заказ за столом', open: 'Онлайн-официант', add: 'Добавить официанту', added: 'Добавлено',
    cannotAdd: 'Это блюдо нельзя адаптировать под выбранные аллергены', empty: 'Вы ещё ничего не выбрали.', items: 'поз.', total: 'Итого',
    send: 'Отправить заказ', call: 'Позвать официанта', bill: 'Попросить счёт', note: 'Комментарий к блюду', notePlaceholder: 'Например: без лука, соус отдельно',
    autoChanges: 'Изменения по аллергенам', remove: 'Удалить', table: 'Стол', tableUnknown: 'Стол не указан', demo: 'Демо-режим',
    demoHint: 'Заказ сформирован. Реальная отправка в Poster будет подключена через CIA Server.', sent: 'Демо-заказ сформирован',
    serviceDemo: 'Запрос сформирован в демо-режиме', unsafe: 'Нельзя заказать с текущими настройками аллергии', close: 'Закрыть'
  },
  en: {
    title: 'Online waiter', subtitle: 'Your table order', open: 'Online waiter', add: 'Add to waiter', added: 'Added',
    cannotAdd: 'This dish cannot be adjusted for the selected allergens', empty: 'You have not selected anything yet.', items: 'items', total: 'Total',
    send: 'Send order', call: 'Call waiter', bill: 'Request bill', note: 'Dish note', notePlaceholder: 'For example: no onion, sauce on the side',
    autoChanges: 'Allergy adjustments', remove: 'Remove', table: 'Table', tableUnknown: 'Table not specified', demo: 'Demo mode',
    demoHint: 'Order is prepared. Real Poster submission will be connected through CIA Server.', sent: 'Demo order prepared',
    serviceDemo: 'Request prepared in demo mode', unsafe: 'Cannot order with the current allergy settings', close: 'Close'
  },
  hy: {
    title: 'Օնլայն մատուցող', subtitle: 'Ձեր պատվերը սեղանից', open: 'Օնլայն մատուցող', add: 'Ավելացնել մատուցողին', added: 'Ավելացված է',
    cannotAdd: 'Այս ուտեստը հնարավոր չէ հարմարեցնել ընտրված ալերգեններին', empty: 'Դեռ ոչինչ չեք ընտրել։', items: 'դիրք', total: 'Ընդամենը',
    send: 'Ուղարկել պատվերը', call: 'Կանչել մատուցողին', bill: 'Խնդրել հաշիվը', note: 'Մեկնաբանություն ուտեստին', notePlaceholder: 'Օրինակ՝ առանց սոխի, սոուսը առանձին',
    autoChanges: 'Փոփոխություններ ալերգենների պատճառով', remove: 'Հեռացնել', table: 'Սեղան', tableUnknown: 'Սեղանը նշված չէ', demo: 'Դեմո ռեժիմ',
    demoHint: 'Պատվերը ձևավորված է։ Poster ուղարկումը կկապվի CIA Server-ի միջոցով։', sent: 'Դեմո պատվերը ձևավորված է',
    serviceDemo: 'Հարցումը ձևավորված է դեմո ռեժիմում', unsafe: 'Չի կարելի պատվիրել ալերգիայի ընթացիկ կարգավորումներով', close: 'Փակել'
  }
};

const waiterState = {
  items: [],
  open: false,
  table: new URLSearchParams(location.search).get('table') || new URLSearchParams(location.search).get('tableId') || ''
};

function wt(key) {
  const lang = (typeof state !== 'undefined' && state.lang) || 'ru';
  return waiterCopy[lang]?.[key] || waiterCopy.ru[key] || key;
}

function waiterProduct(productId) {
  return state?.menu?.products?.find((item) => item.id === productId);
}

function loadWaiterState() {
  try {
    const saved = JSON.parse(localStorage.getItem('ciaOnlineWaiter') || '{}');
    if (Array.isArray(saved.items)) waiterState.items = saved.items;
  } catch (_) {}
}

function saveWaiterState() {
  localStorage.setItem('ciaOnlineWaiter', JSON.stringify({ items: waiterState.items }));
}

function waiterGroups(product) {
  if (typeof getConflictGroups === 'function') return getConflictGroups(product);
  return { removable: [], fixed: [] };
}

function selectedRemovals(product) {
  const groups = waiterGroups(product);
  return groups.removable.map((item) => {
    const allergen = typeof allergenById === 'function' ? allergenById(item.id) : null;
    const rule = typeof getAllergenCustomization === 'function' ? getAllergenCustomization(product, item.id) : null;
    return {
      id: item.id,
      label: `${allergen?.emoji || ''} ${txt(allergen?.name)}`.trim(),
      reason: rule?.reason ? txt(rule.reason) : ''
    };
  });
}

function injectWaiterUI() {
  if (document.querySelector('#onlineWaiterBtn')) return;

  const style = document.createElement('style');
  style.id = 'onlineWaiterStyles';
  style.textContent = `
    body.waiter-open { overflow:hidden; }
    .online-waiter-btn { position:fixed; right:16px; bottom:max(16px, env(safe-area-inset-bottom)); z-index:70; border:0; border-radius:18px; padding:12px 15px; background:#1f5c38; color:#fff; box-shadow:0 10px 30px rgba(24,64,42,.24); display:flex; align-items:center; gap:10px; font:inherit; font-weight:800; cursor:pointer; }
    .online-waiter-btn .waiter-count { min-width:24px; height:24px; border-radius:999px; background:#fff; color:#1f5c38; display:grid; place-items:center; font-size:12px; padding:0 6px; }
    .waiter-backdrop { position:fixed; inset:0; z-index:78; background:rgba(22,26,23,.42); backdrop-filter:blur(2px); }
    .waiter-panel { position:fixed; z-index:79; left:50%; bottom:0; width:min(100%, 620px); max-height:88vh; transform:translate(-50%, 105%); transition:transform .25s ease; background:#fbf8f1; border-radius:28px 28px 0 0; box-shadow:0 -18px 50px rgba(28,35,30,.2); display:flex; flex-direction:column; overflow:hidden; }
    .waiter-panel.open { transform:translate(-50%, 0); }
    .waiter-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:20px 20px 12px; border-bottom:1px solid rgba(67,72,66,.09); }
    .waiter-head h2 { margin:3px 0 0; font-size:25px; }
    .waiter-kicker { font-size:11px; letter-spacing:.08em; font-weight:900; color:#61806a; }
    .waiter-table { display:inline-flex; margin-top:7px; padding:5px 9px; border-radius:999px; background:#eaf3ec; color:#2e6841; font-size:12px; font-weight:800; }
    .waiter-close { width:38px; height:38px; border-radius:999px; border:0; background:#eee9df; font-size:24px; cursor:pointer; }
    .waiter-body { overflow:auto; padding:14px 18px 8px; }
    .waiter-empty { padding:32px 10px; text-align:center; color:#777167; }
    .waiter-item { background:#fff; border:1px solid rgba(72,78,72,.09); border-radius:18px; padding:13px; margin-bottom:10px; }
    .waiter-item-top { display:flex; gap:12px; justify-content:space-between; align-items:flex-start; }
    .waiter-item-name { font-weight:900; line-height:1.25; }
    .waiter-item-price { font-weight:900; white-space:nowrap; }
    .waiter-adjustments { margin-top:9px; padding:9px 10px; border-radius:12px; background:#edf8ef; color:#28663a; font-size:12px; }
    .waiter-adjustments strong { display:block; margin-bottom:3px; }
    .waiter-controls { display:flex; align-items:center; gap:8px; margin-top:11px; }
    .waiter-qty { display:inline-flex; align-items:center; border:1px solid #dfdbd2; border-radius:12px; overflow:hidden; background:#faf8f3; }
    .waiter-qty button { width:34px; height:34px; border:0; background:transparent; font-size:20px; cursor:pointer; }
    .waiter-qty span { min-width:28px; text-align:center; font-weight:900; }
    .waiter-remove { margin-left:auto; border:0; background:transparent; color:#9a463b; font-weight:800; cursor:pointer; }
    .waiter-note { width:100%; min-height:58px; margin-top:10px; border:1px solid #dfdbd2; border-radius:12px; padding:10px 11px; font:inherit; resize:vertical; background:#fcfbf8; box-sizing:border-box; }
    .waiter-footer { padding:14px 18px max(18px, env(safe-area-inset-bottom)); border-top:1px solid rgba(67,72,66,.09); background:#fbf8f1; }
    .waiter-total { display:flex; align-items:center; justify-content:space-between; font-weight:900; margin-bottom:11px; }
    .waiter-total strong { font-size:22px; }
    .waiter-actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:9px; }
    .waiter-service-btn { border:1px solid #dcd7cd; border-radius:13px; padding:10px 9px; background:#fff; font:inherit; font-size:12px; font-weight:800; cursor:pointer; }
    .waiter-send { width:100%; border:0; border-radius:15px; padding:14px 16px; background:#1f5c38; color:#fff; font:inherit; font-weight:900; cursor:pointer; }
    .waiter-send:disabled { opacity:.45; cursor:not-allowed; }
    .waiter-demo { margin-top:8px; font-size:11px; line-height:1.4; color:#7a746b; text-align:center; }
    .waiter-toast { position:fixed; left:50%; bottom:92px; transform:translate(-50%, 20px); z-index:90; max-width:min(90vw, 420px); padding:11px 14px; border-radius:13px; background:#24382b; color:#fff; font-size:13px; font-weight:800; opacity:0; pointer-events:none; transition:.2s ease; text-align:center; }
    .waiter-toast.show { opacity:1; transform:translate(-50%, 0); }
    .waiter-add-wrap { margin-top:16px; }
    .waiter-add-btn { width:100%; border:0; border-radius:15px; padding:13px 16px; background:#1f5c38; color:#fff; font:inherit; font-weight:900; cursor:pointer; }
    .waiter-add-btn:disabled { background:#c7c2b9; color:#716b62; cursor:not-allowed; }
    .waiter-unsafe-hint { margin-top:7px; padding:9px 10px; border-radius:11px; background:#fff0ed; color:#943f34; font-size:12px; font-weight:800; }
    @media (min-width:700px) { .waiter-panel { bottom:18px; border-radius:28px; max-height:86vh; } }
  `;
  document.head.appendChild(style);

  document.body.insertAdjacentHTML('beforeend', `
    <button id="onlineWaiterBtn" class="online-waiter-btn" type="button">
      <span>🤵</span><span id="waiterBtnLabel"></span><span id="waiterCount" class="waiter-count">0</span>
    </button>
    <div id="waiterBackdrop" class="waiter-backdrop hidden"></div>
    <aside id="waiterPanel" class="waiter-panel" aria-hidden="true">
      <div class="waiter-head">
        <div><div class="waiter-kicker">CIA SMART MENU</div><h2 id="waiterTitle"></h2><div id="waiterTable" class="waiter-table"></div></div>
        <button id="waiterClose" class="waiter-close" type="button">×</button>
      </div>
      <div id="waiterBody" class="waiter-body"></div>
      <div class="waiter-footer">
        <div class="waiter-total"><span id="waiterTotalLabel"></span><strong id="waiterTotal"></strong></div>
        <div class="waiter-actions"><button id="callWaiterBtn" class="waiter-service-btn" type="button"></button><button id="requestBillBtn" class="waiter-service-btn" type="button"></button></div>
        <button id="sendWaiterOrder" class="waiter-send" type="button"></button>
        <div id="waiterDemoHint" class="waiter-demo"></div>
      </div>
    </aside>
    <div id="waiterToast" class="waiter-toast"></div>
  `);

  document.querySelector('#onlineWaiterBtn').addEventListener('click', openWaiter);
  document.querySelector('#waiterClose').addEventListener('click', closeWaiter);
  document.querySelector('#waiterBackdrop').addEventListener('click', closeWaiter);
  document.querySelector('#callWaiterBtn').addEventListener('click', () => showWaiterToast(`🤵 ${wt('serviceDemo')}`));
  document.querySelector('#requestBillBtn').addEventListener('click', () => showWaiterToast(`🧾 ${wt('serviceDemo')}`));
  document.querySelector('#sendWaiterOrder').addEventListener('click', submitWaiterOrder);
  document.querySelector('#waiterBody').addEventListener('click', handleWaiterBodyClick);
  document.querySelector('#waiterBody').addEventListener('input', handleWaiterBodyInput);
}

function updateWaiterCopy() {
  const label = document.querySelector('#waiterBtnLabel');
  if (!label) return;
  label.textContent = wt('open');
  document.querySelector('#waiterTitle').textContent = wt('title');
  document.querySelector('#waiterTotalLabel').textContent = wt('total');
  document.querySelector('#callWaiterBtn').textContent = `🤵 ${wt('call')}`;
  document.querySelector('#requestBillBtn').textContent = `🧾 ${wt('bill')}`;
  document.querySelector('#sendWaiterOrder').textContent = wt('send');
  document.querySelector('#waiterDemoHint').textContent = `${wt('demo')}: ${wt('demoHint')}`;
  document.querySelector('#waiterTable').textContent = waiterState.table ? `${wt('table')} ${waiterState.table}` : wt('tableUnknown');
  renderWaiter();
}

function openWaiter() {
  waiterState.open = true;
  document.body.classList.add('waiter-open');
  document.querySelector('#waiterBackdrop').classList.remove('hidden');
  document.querySelector('#waiterPanel').classList.add('open');
  document.querySelector('#waiterPanel').setAttribute('aria-hidden', 'false');
  renderWaiter();
}

function closeWaiter() {
  waiterState.open = false;
  document.body.classList.remove('waiter-open');
  document.querySelector('#waiterBackdrop')?.classList.add('hidden');
  document.querySelector('#waiterPanel')?.classList.remove('open');
  document.querySelector('#waiterPanel')?.setAttribute('aria-hidden', 'true');
}

function renderWaiter() {
  const body = document.querySelector('#waiterBody');
  if (!body || !state?.menu) return;
  waiterState.items = waiterState.items.filter((item) => waiterProduct(item.productId));
  saveWaiterState();

  const count = waiterState.items.reduce((sum, item) => sum + item.qty, 0);
  document.querySelector('#waiterCount').textContent = count;

  if (!waiterState.items.length) {
    body.innerHTML = `<div class="waiter-empty">🤵<br><br>${wt('empty')}</div>`;
    document.querySelector('#waiterTotal').textContent = formatPrice(0);
    document.querySelector('#sendWaiterOrder').disabled = true;
    return;
  }

  body.innerHTML = waiterState.items.map((item) => {
    const product = waiterProduct(item.productId);
    const mods = Array.isArray(item.modifications) ? item.modifications : [];
    return `<div class="waiter-item" data-waiter-product="${product.id}">
      <div class="waiter-item-top"><div class="waiter-item-name">${product.emoji || '🍽️'} ${txt(product.name)}</div><div class="waiter-item-price">${formatPrice(product.price * item.qty)}</div></div>
      ${mods.length ? `<div class="waiter-adjustments"><strong>✓ ${wt('autoChanges')}</strong>${mods.map((mod) => `<div>${escapeWaiterHtml(mod)}</div>`).join('')}</div>` : ''}
      <textarea class="waiter-note" data-note-product="${product.id}" placeholder="${wt('notePlaceholder')}">${escapeWaiterHtml(item.note || '')}</textarea>
      <div class="waiter-controls"><div class="waiter-qty"><button type="button" data-waiter-action="minus" data-product="${product.id}">−</button><span>${item.qty}</span><button type="button" data-waiter-action="plus" data-product="${product.id}">+</button></div><button type="button" class="waiter-remove" data-waiter-action="remove" data-product="${product.id}">${wt('remove')}</button></div>
    </div>`;
  }).join('');

  const total = waiterState.items.reduce((sum, item) => {
    const product = waiterProduct(item.productId);
    return sum + (product ? product.price * item.qty : 0);
  }, 0);
  document.querySelector('#waiterTotal').textContent = formatPrice(total);
  document.querySelector('#sendWaiterOrder').disabled = false;
}

function addProductToWaiter(productId) {
  const product = waiterProduct(productId);
  if (!product) return;
  const groups = waiterGroups(product);
  if (groups.fixed.length) {
    showWaiterToast(`⛔ ${wt('unsafe')}`);
    return;
  }

  const removals = selectedRemovals(product);
  const modifications = removals.map((item) => item.reason || item.label).filter(Boolean);
  const existing = waiterState.items.find((item) => item.productId === productId && JSON.stringify(item.modifications || []) === JSON.stringify(modifications));
  if (existing) existing.qty += 1;
  else waiterState.items.push({ productId, qty: 1, note: '', modifications });
  saveWaiterState();
  renderWaiter();
  showWaiterToast(`✓ ${wt('added')}: ${txt(product.name)}`);
}

function handleWaiterBodyClick(event) {
  const button = event.target.closest('[data-waiter-action]');
  if (!button) return;
  const productId = Number(button.dataset.product);
  const item = waiterState.items.find((entry) => entry.productId === productId);
  if (!item) return;
  if (button.dataset.waiterAction === 'plus') item.qty += 1;
  if (button.dataset.waiterAction === 'minus') item.qty = Math.max(1, item.qty - 1);
  if (button.dataset.waiterAction === 'remove') waiterState.items = waiterState.items.filter((entry) => entry !== item);
  saveWaiterState();
  renderWaiter();
}

function handleWaiterBodyInput(event) {
  const area = event.target.closest('[data-note-product]');
  if (!area) return;
  const productId = Number(area.dataset.noteProduct);
  const item = waiterState.items.find((entry) => entry.productId === productId);
  if (!item) return;
  item.note = area.value;
  saveWaiterState();
}

function submitWaiterOrder() {
  if (!waiterState.items.length) return;
  const order = {
    table: waiterState.table || null,
    createdAt: new Date().toISOString(),
    items: waiterState.items.map((item) => {
      const product = waiterProduct(item.productId);
      return {
        productId: item.productId,
        name: product ? txt(product.name) : String(item.productId),
        qty: item.qty,
        price: product?.price || 0,
        note: item.note || '',
        modifications: item.modifications || []
      };
    })
  };
  console.info('CIA Online Waiter demo order', order);
  localStorage.setItem('ciaLastDemoOrder', JSON.stringify(order));
  showWaiterToast(`✓ ${wt('sent')}`);
}

function showWaiterToast(message) {
  const toast = document.querySelector('#waiterToast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showWaiterToast.timer);
  showWaiterToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function escapeWaiterHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

loadWaiterState();
injectWaiterUI();

const waiterBaseRenderAll = renderAll;
renderAll = function() {
  waiterBaseRenderAll();
  updateWaiterCopy();
};

const waiterBaseOpenDish = openDish;
openDish = function(productId) {
  waiterBaseOpenDish(productId);
  const product = waiterProduct(productId);
  if (!product) return;
  const groups = waiterGroups(product);
  const detailBody = document.querySelector('#dishDetail .detail-body');
  if (!detailBody) return;
  detailBody.insertAdjacentHTML('beforeend', `
    <div class="waiter-add-wrap">
      <button class="waiter-add-btn" type="button" data-add-waiter="${product.id}" ${groups.fixed.length ? 'disabled' : ''}>🤵 ${groups.fixed.length ? wt('cannotAdd') : wt('add')}</button>
      ${groups.fixed.length ? `<div class="waiter-unsafe-hint">⛔ ${wt('unsafe')}</div>` : ''}
    </div>
  `);
  detailBody.querySelector('[data-add-waiter]')?.addEventListener('click', () => addProductToWaiter(product.id));
};

updateWaiterCopy();
