// CIA Smart Menu — Poster submission bridge for the existing Online Waiter.
(() => {
  const BACKEND_URL = 'https://cia-smart-menu-demo.vercel.app/api/create-order';
  const PHONE_KEY = 'ciaOnlineWaiterPhone';
  const FIXED_SPOT_ID = 1;

  const copy = {
    ru: { phone: 'Телефон для заказа', phonePlaceholder: '+374 98 615 005', phoneRequired: 'Укажите номер телефона для отправки заказа.', sending: 'Отправляем заказ…', sent: 'Заказ отправлен в Poster', error: 'Не удалось отправить заказ', demo: 'Заказ будет отправлен напрямую в Poster через CIA Server.' },
    en: { phone: 'Phone for the order', phonePlaceholder: '+374 98 615 005', phoneRequired: 'Enter a phone number to send the order.', sending: 'Sending order…', sent: 'Order sent to Poster', error: 'Could not send the order', demo: 'The order will be sent directly to Poster through CIA Server.' },
    hy: { phone: 'Պատվերի հեռախոսահամար', phonePlaceholder: '+374 98 615 005', phoneRequired: 'Մուտքագրեք հեռախոսահամար՝ պատվերը ուղարկելու համար։', sending: 'Պատվերը ուղարկվում է…', sent: 'Պատվերը ուղարկվել է Poster', error: 'Չհաջողվեց ուղարկել պատվերը', demo: 'Պատվերը կուղարկվի անմիջապես Poster՝ CIA Server-ի միջոցով։' }
  };

  const lang = () => (typeof state !== 'undefined' && state.lang) || 'ru';
  const tr = (key) => copy[lang()]?.[key] || copy.ru[key] || key;

  function normalizePhone(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('0')) digits = '374' + digits.slice(1);
    return digits.startsWith('374') ? '+' + digits : (digits ? '+' + digits : '');
  }

  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  function injectPhoneField() {
    const footer = document.querySelector('.waiter-footer');
    if (!footer || document.querySelector('#waiterPhone')) return;
    const block = document.createElement('div');
    block.id = 'waiterPhoneBlock';
    block.style.cssText = 'margin:0 0 10px;';
    block.innerHTML = `<label for="waiterPhone" style="display:block;font-size:12px;font-weight:800;color:#5f5a52;margin:0 0 6px;">${tr('phone')}</label><input id="waiterPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="${tr('phonePlaceholder')}" value="${escapeHtml(localStorage.getItem(PHONE_KEY) || '')}" style="width:100%;box-sizing:border-box;border:1px solid #dfdbd2;border-radius:12px;padding:11px 12px;background:#fcfbf8;font:inherit;outline:none;">`;
    footer.insertBefore(block, footer.querySelector('.waiter-total'));
    document.querySelector('#waiterPhone').addEventListener('input', (event) => {
      event.target.value = normalizePhone(event.target.value);
      localStorage.setItem(PHONE_KEY, event.target.value);
    });
  }

  function refreshCopy() {
    const hint = document.querySelector('#waiterDemoHint');
    if (hint) hint.textContent = tr('demo');
    const input = document.querySelector('#waiterPhone');
    const label = document.querySelector('label[for="waiterPhone"]');
    if (label) label.textContent = tr('phone');
    if (input) input.placeholder = tr('phonePlaceholder');
  }

  function buildPayload() {
    const phone = normalizePhone(document.querySelector('#waiterPhone')?.value || localStorage.getItem(PHONE_KEY));
    if (!/^\+?[0-9]{8,15}$/.test(phone.replace(/[\s()-]/g, ''))) throw new Error(tr('phoneRequired'));

    const products = waiterState.items.map((item) => ({ product_id: Number(item.productId), count: Number(item.qty) }));
    const comments = waiterState.items.map((item) => {
      const product = waiterProduct(item.productId);
      const name = product ? txt(product.name) : String(item.productId);
      const parts = [];
      if (Array.isArray(item.modifications) && item.modifications.length) parts.push(`Изменения: ${item.modifications.join(', ')}`);
      if (item.note) parts.push(`Комментарий: ${item.note}`);
      return `${name} × ${item.qty}${parts.length ? ` — ${parts.join('; ')}` : ''}`;
    });

    return {
      confirm: true,
      phone,
      spot_id: FIXED_SPOT_ID,
      first_name: 'CIA Smart Menu',
      last_name: 'Online Waiter',
      comment: `Онлайн-официант, стол ${FIXED_SPOT_ID}. ${comments.join(' | ')}`.slice(0, 1000),
      products
    };
  }

  async function submitToPoster() {
    if (!waiterState.items.length || submitToPoster.running) return;
    const button = document.querySelector('#sendWaiterOrder');
    if (!button) return;
    let payload;
    try { payload = buildPayload(); } catch (error) { showWaiterToast(`⛔ ${error.message}`); return; }

    const previousText = button.textContent;
    submitToPoster.running = true;
    button.disabled = true;
    button.textContent = tr('sending');
    try {
      const response = await fetch(BACKEND_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || tr('error'));
      localStorage.setItem('ciaLastPosterOrder', JSON.stringify({ sentAt: new Date().toISOString(), payload, response: data }));
      waiterState.items = [];
      saveWaiterState();
      renderWaiter();
      showWaiterToast(`✓ ${tr('sent')}`);
    } catch (error) {
      console.error('CIA Online Waiter Poster order failed:', error);
      showWaiterToast(`⛔ ${error.message || tr('error')}`);
    } finally {
      submitToPoster.running = false;
      const currentButton = document.querySelector('#sendWaiterOrder');
      if (currentButton) { currentButton.disabled = !waiterState.items.length; currentButton.textContent = previousText; }
    }
  }

  function install() {
    if (typeof waiterState === 'undefined') return;
    injectPhoneField();
    refreshCopy();
    const button = document.querySelector('#sendWaiterOrder');
    if (!button || button.dataset.posterBridgeInstalled === '1') return;
    button.dataset.posterBridgeInstalled = '1';
    button.addEventListener('click', (event) => { event.preventDefault(); event.stopImmediatePropagation(); submitToPoster(); }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
