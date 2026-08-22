(() => {
  const nativeFetch = window.fetch.bind(window);
  const targetSuffix = 'data/products.json';

  const params = new URLSearchParams(window.location.search);
  const explicitRestaurantId = params.get('restaurant');
  const restaurantId = explicitRestaurantId || 'ciasift';
  const allowDemoFallback = !explicitRestaurantId || restaurantId === 'garden-table';

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
      const firebase = await waitForFirebase();
      if (firebase?.loadPublicMenu) {
        const menu = await firebase.loadPublicMenu(restaurantId);
        if (menu?.products?.length) {
          console.info('[CIA Smart Menu] Menu loaded from Firestore:', restaurantId);
          return new Response(JSON.stringify(menu), {
            status: 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          });
        }
      }
    } catch (error) {
      console.warn('[CIA Smart Menu] Firestore menu load failed.', error);
      if (!allowDemoFallback) return firestoreErrorResponse('firestore_unavailable');
    }

    // The static Garden Table JSON is a demo-only fallback. A real restaurant
    // must never silently show demo products if Firestore is unavailable.
    if (allowDemoFallback) return nativeFetch(input, init);
    return firestoreErrorResponse('restaurant_menu_unavailable');
  };
})();
