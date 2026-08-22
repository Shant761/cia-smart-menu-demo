(() => {
  const state = { phone: '', step: 'phone' };

  const texts = {
    ru: {
      title: 'Войдите в Smart Menu',
      subtitle: 'Сохраняйте настройки меню и быстрее оформляйте заказы.',
      phoneLabel: 'Номер телефона',
      phonePlaceholder: '+374 98 615 005',
      continue: 'Продолжить',
      later: 'Продолжить без входа',
      codeTitle: 'Введите код',
      codeSubtitle: 'Код подтверждения будет отправлен на',
      codePlaceholder: '000000',
      verify: 'Подтвердить',
      change: 'Изменить номер',
      demo: 'Сейчас это только интерфейс. SMS-подтверждение подключим следующим этапом.'
    },
    hy: {
      title: 'Մուտք Smart Menu',
      subtitle: 'Պահպանեք մենյուի կարգավորումները և ավելի արագ պատվիրեք։',
      phoneLabel: 'Հեռախոսահամար',
      phonePlaceholder: '+374 98 615 005',
      continue: 'Շարունակել',
      later: 'Շարունակել առանց մուտքի',
      codeTitle: 'Մուտքագրեք կոդը',
      codeSubtitle: 'Հաստատման կոդը կուղարկվի',
      codePlaceholder: '000000',
      verify: 'Հաստատել',
      change: 'Փոխել համարը',
      demo: 'Այս պահին սա միայն ինտերֆեյս է։ SMS հաստատումը կավելացնենք հաջորդ փուլում։'
    },
    en: {
      title: 'Sign in to Smart Menu',
      subtitle: 'Save your menu preferences and order faster.',
      phoneLabel: 'Phone number',
      phonePlaceholder: '+374 98 615 005',
      continue: 'Continue',
      later: 'Continue without signing in',
      codeTitle: 'Enter the code',
      codeSubtitle: 'The verification code will be sent to',
      codePlaceholder: '000000',
      verify: 'Verify',
      change: 'Change number',
      demo: 'This is only the interface for now. SMS verification will be connected next.'
    }
  };

  const lang = () => localStorage.getItem('ciaSmartMenuPrefs') ? (() => { try { return JSON.parse(localStorage.getItem('ciaSmartMenuPrefs')).lang || 'ru'; } catch (_) { return 'ru'; } })() : 'ru';
  const t = (key) => texts[lang()]?.[key] || texts.ru[key];
  const $ = (id) => document.getElementById(id);

  function normalizePhone(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('0')) digits = '374' + digits.slice(1);
    if (digits.startsWith('374')) return '+' + digits;
    return digits ? '+' + digits : '';
  }

  function renderPhone() {
    $('authContent').innerHTML = `
      <div class="auth-icon">☎</div>
      <span class="auth-eyebrow">CIA SMART MENU</span>
      <h2>${t('title')}</h2>
      <p class="auth-subtitle">${t('subtitle')}</p>
      <label class="auth-label" for="authPhone">${t('phoneLabel')}</label>
      <input id="authPhone" class="auth-input" type="tel" inputmode="tel" autocomplete="tel" placeholder="${t('phonePlaceholder')}" />
      <button id="authContinue" class="auth-primary" type="button">${t('continue')} <span>→</span></button>
      <button id="authLater" class="auth-link" type="button">${t('later')}</button>
      <p class="auth-demo-note">${t('demo')}</p>
    `;
    $('authPhone').focus();
    $('authPhone').addEventListener('input', (e) => {
      e.target.value = normalizePhone(e.target.value);
      state.phone = e.target.value;
    });
    $('authContinue').addEventListener('click', () => {
      state.phone = normalizePhone($('authPhone').value);
      if (state.phone.replace(/\D/g, '').length < 8) {
        $('authPhone').classList.add('invalid');
        return;
      }
      state.step = 'code';
      renderCode();
    });
    $('authLater').addEventListener('click', close);
  }

  function renderCode() {
    $('authContent').innerHTML = `
      <div class="auth-icon">✓</div>
      <span class="auth-eyebrow">CIA SMART MENU</span>
      <h2>${t('codeTitle')}</h2>
      <p class="auth-subtitle">${t('codeSubtitle')} <strong>${state.phone}</strong></p>
      <input id="authCode" class="auth-input auth-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="${t('codePlaceholder')}" />
      <button id="authVerify" class="auth-primary" type="button">${t('verify')} <span>→</span></button>
      <button id="authChange" class="auth-link" type="button">${t('change')}</button>
      <p class="auth-demo-note">${t('demo')}</p>
    `;
    $('authCode').focus();
    $('authCode').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });
    $('authVerify').addEventListener('click', close);
    $('authChange').addEventListener('click', () => { state.step = 'phone'; renderPhone(); });
  }

  function open() {
    $('authModal').classList.remove('hidden');
    requestAnimationFrame(() => $('authModal').classList.add('open'));
    state.step = 'phone';
    renderPhone();
  }

  function close() {
    $('authModal').classList.remove('open');
    setTimeout(() => $('authModal').classList.add('hidden'), 220);
  }

  function init() {
    $('accountBtn').addEventListener('click', open);
    $('authClose').addEventListener('click', close);
    $('authModalBackdrop').addEventListener('click', close);
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
  }

  window.CIASmartAuth = { open, close };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
