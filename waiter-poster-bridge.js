// CIA Smart Menu — Poster submission bridge for the existing Online Waiter.
// Keeps waiter.js UI/state intact and replaces only the demo send action.

(() => {
  const BACKEND_URL = 'https://cia-smart-menu-demo.vercel.app/api/create-order';
  const PHONE_KEY = 'ciaOnlineWaiterPhone';

  const copy = {
    ru: {
      phone: 'Телефон для заказа',
      phonePlaceholder: '+374 98 615 005',
      phoneRequired: 'Укажите номер телефона для отправки заказа.',
      tableRequired: 'Укажите корректный номер стола.',
      sending: 'Отправляем заказ…',
      sent: 'Заказ отправлен в Poster',
      error: 'Не удалось отправить заказ',
      demo: 'Заказ будет отправлен напрямую в Poster через CIA Server.'
    },
    en: {
      phone: 'Phone for the order',
      phonePlaceholder: '+374 98 615 005',
      phoneRequired: 'Enter a phone number to send the order.',
      tableRequired: 'Enter a valid table number.',
      sending: 'Sending order…',
      sent: 'Order sent to Poster',
      error: 'Could not send the order',
      demo: 'The order will be sent directly to Poster through CIA Server.'
    },
    hy: {
      phone: 'Պատվերի հեռախոսահամար',
      phonePlaceholder: '+374 98 615 005',
      phoneRequired: 'Մուտքագրեք հեռախոսահամար՝ պատվերը ուղարկելու համար։',
      tableRequired: 'Մուտքագրեք սեղանի ճիշտ համարը։',
      sending: 'Պատվերը ուղարկվում է…',
      sent: 'Պատվերը ուղարկվել է Poster',
      error: 'Չհաջողվեց ուղարկել պատվերը',
      demo: 'Պատվերը կուղարկվի անմիջապես Poster՝ CIA Server-ի միջոցով։'
    }
  };

  function lang() {
    return (typeof state !== 'undefined' && state.lang) || 'ru';
  }

  function tr(key) {
    return copy[lang()]?.[key] || copy.ru[key] || key;
  }

  function normalizePhone(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('0')) digits = '374' + digits.slice(1);
    if (digits.startsWith('374')) return '+' + digits;
    return digits ? '+' + digits : '';
  }

  function getPhone() {
    return localStorage.getItem(PHONE_KEY) || '';
  }

  function injectPhoneField() {
    const footer = document.querySelector('.waiter-footer');
    if (!footer || document.querySelector('#waiterPhone')) return;

    const block = document.createElement('div');
    block.id = 'waiterPhoneBlock';
    block.style.cssText = 'margin:0 0 10px;';
    block.innerHTML = `
      <label for="waiterPhone" style="display:block;font-size:12px;font-weight:800;color:#5f5a52;margin:0 0 6px;">${tr('phone')}</label>
      <input id="waiterPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="${tr('phonePlaceholder')}" value="${escapeHtml(getPhone())}" style="width:100%;box-sizing:border-box;border:1px solid #dfdbd2;border-radius:12px;padding:11px 12px;background:#fcfbf8;font:inherit;outline:none;">
    `;
    footer.insertBefore(block, footer.querySelector('.waiter-total'));

    const input = document.querySelector('#waiterPhone');
    input.addEventListener('input', (event) => {
      const value = normalizePhone(event.target.value);
      event.target.value = value;
      localStorage.setItem(PHONE_KEY, value);
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

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function buildPayload() {
    const table = Number(waiterState.table);
    const phone = normalizePhone(document.querySelector('#waiterPhone')?.value || getPhone());

    if (!/^\+?[0-9]{8,15}$/.test(phone.replace(/[\s()-]/g, ''))) {
      throw new Error(tr('phoneRequired'));
    }
    if (!Number.isInteger(table) || table < 1) {
      throw new Error(tr('tableRequired'));
    }

    const products = waiterState.items.map((item) => ({
      product_id: Number(item.productId),
      count: Number(item.qty)
    }));

    const comments = waiterState.items.map((item) => {
      const product = waiterProduct(item.productId);
      const name = product ? txt(product.name) : String(item.productId);
      const parts = [];
      if (Array.isArray(item.modifications) && item.modifications.length) {
        parts.push(`Изменения: ${item.modifications.join(', ')}`);
      }
      if (item.note) parts.push(`Комментарий: ${item.note}`);
      return `${name} × ${item.qty}${parts.length ? ` — ${parts.join('; ')}` : ''}`;
    });

    return {
      confirm: true,
      phone,
      spot_id: table,
      first_name: 'CIA Smart Menu',
      last_name: 'Online Waiter',
      comment: `Онлайн-официант, стол ${table}. ${comments.join(' | ')}`.slice(0, 1000),
      products
    };
  }

  async function submitToPoster() {
    if (!waiterState.items.length || submitToPoster.running) return;

    const button = document.querySelector('#sendWaiterOrder');
    if (!button) return;

    let payload;
    try {
      payload = buildPayload();
    } catch (error) {
      showWaiterToast(`⛔ ${error.message}`);
      return;
    }

    const previousText = button.textContent;
    submitToPoster.running = true;
    button.disabled = true;
    button.textContent = tr('sending');

    try {
      const response = await fetch(BACKEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        throw new Error(data.error || tr('error'));
      }

      localStorage.setItem('ciaLastPosterOrder', JSON.stringify({
        sentAt: new Date().toISOString(),
        payload,
        response: data
      }));

      waiterState.items = [];
      saveWaiterState();
      renderWaiter();
      showWaiterToast(`✓ ${tr('sent')}`);
    } catch (error) {
      console.error('CIA Online Waiter Poster order failed:', error);
      showWaiterToast(`⛔ ${error.message || tr('error')}`);
    } finally {
      submitToPoster.running = false;
      if (document.querySelector('#sendWaiterOrder')) {
        document.querySelector('#sendWaiterOrder').disabled = !waiterState.items.length;
        document.querySelector('#sendWaiterOrder').textContent = previousText;
      }
    }
  }

  function install() {
    if (typeof waiterState === 'undefined') return;

    injectPhoneField();
    refreshCopy();

    const button = document.querySelector('#sendWaiterOrder');
    if (!button || button.dataset.posterBridgeInstalled === '1') return;
    button.dataset.posterBridgeInstalled = '1';

    // Capture phase runs before waiter.js's original demo listener.
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      submitToPoster();
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
