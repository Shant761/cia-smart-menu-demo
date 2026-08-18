(() => {
  const nativeFetch = window.fetch.bind(window);
  const targetSuffix = 'data/products.json';

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

  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const isMenuRequest = url === targetSuffix || url.endsWith(`/${targetSuffix}`);

    if (!isMenuRequest) {
      return nativeFetch(input, init);
    }

    try {
      const firebase = await waitForFirebase();
      if (firebase?.loadPublicMenu) {
        const restaurantId = new URLSearchParams(window.location.search).get('restaurant') || 'garden-table';
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
      console.warn('[CIA Smart Menu] Firestore unavailable, using JSON fallback.', error);
    }

    return nativeFetch(input, init);
  };
})();
