(() => {
  const nativeFetch = window.fetch.bind(window);
  const targetSuffix = 'data/products.json';

  const params = new URLSearchParams(window.location.search);
  const explicitRestaurantId = params.get('restaurant');
  const restaurantId = explicitRestaurantId || 'ciasift';
  const demoMode = params.get('demo') === '1';
  const allowDemoFallback = !explicitRestaurantId || restaurantId === 'garden-table' || (restaurantId === 'ciasift' && demoMode);

  const waitForFirebase = (timeoutMs = 1800) => new Promise((resolve) => {
    if (window.ciaFirebase?.loadPublicMenu) {
      resolve(window.ciaFirebase);
      return;
    }

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('cia:firebase-ready', onReady);
      resolve(value);
    };

    const onReady = () => finish(window.ciaFirebase || null);
    window.addEventListener('cia:firebase-ready', onReady, { once: true });
    window.setTimeout(() => finish(window.ciaFirebase || null), timeoutMs);
  });

  const applyCategoryTranslations = async (menu) => {
    if (!menu?.categories?.length || demoMode || restaurantId === 'garden-table') return menu;

    try {
      const response = await nativeFetch(`data/${encodeURIComponent(restaurantId)}-category-translations.json`, {
        cache: 'no-cache'
      });
      if (!response.ok) return menu;

      const pack = await response.json();
      if (pack?.restaurantId && pack.restaurantId !== restaurantId) return menu;
      const translations = pack?.categories;
      if (!translations || typeof translations !== 'object') return menu;

      menu.categories = menu.categories.map((category) => {
        const rule = translations[String(category?.id)];
        if (!rule) return category;
        const name = {
          hy: String(rule.hy || '').trim(),
          ru: String(rule.ru || '').trim(),
          en: String(rule.en || '').trim()
        };
        if (!name.hy || !name.ru || !name.en) return category;
        return { ...category, name };
      });

      console.info('[CIA Smart Menu] Category translations applied:', restaurantId);
    } catch (error) {
      console.warn('[CIA Smart Menu] Category translation pack unavailable.', error);
    }

    return menu;
  };

  const loadSnapshot = async () => {
    if (demoMode || restaurantId === 'garden-table') return null;

    const response = await nativeFetch(`data/public-menus/${encodeURIComponent(restaurantId)}.json`, {
      cache: 'no-cache'
    });

    if (!response.ok) return null;

    const menu = await response.json();
    if (!menu?.products?.length) return null;

    console.info('[CIA Smart Menu] Menu loaded from public snapshot:', restaurantId);
    return applyCategoryTranslations(menu);
  };

  const firestoreErrorResponse = (message) => new Response(JSON.stringify({
    restaurant: { name: { ru: 'Меню временно недоступно', en: 'Menu temporarily unavailable', hy: 'Մենյուն ժամանակավորապես անհասանելի է' }, meta: {} },
    categories: [],
    products: [],
    error: message
  }), {
    status: 503,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });

  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const isMenuRequest = url === targetSuffix || url.endsWith(`/${targetSuffix}`);
    if (!isMenuRequest) return nativeFetch(input, init);

    try {
      const snapshotMenu = await loadSnapshot();
      if (snapshotMenu) {
        return new Response(JSON.stringify(snapshotMenu), {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

      const firebase = await waitForFirebase();
      if (firebase?.loadPublicMenu) {
        const menu = await firebase.loadPublicMenu(restaurantId);
        if (menu?.products?.length) {
          console.info('[CIA Smart Menu] Menu loaded from Firestore fallback:', restaurantId);
          const translatedMenu = await applyCategoryTranslations(menu);
          return new Response(JSON.stringify(translatedMenu), {
            status: 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          });
        }
      }
    } catch (error) {
      console.warn('[CIA Smart Menu] Public menu load failed.', error);
      if (!allowDemoFallback) return firestoreErrorResponse('public_menu_unavailable');
    }

    // Static fallback is enabled only for the explicit demo mode.
    if (allowDemoFallback) return nativeFetch(input, init);
    return firestoreErrorResponse('restaurant_menu_unavailable');
  };
})();
