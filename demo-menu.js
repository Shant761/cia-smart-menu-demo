(() => {
  const originalFetch = window.fetch.bind(window.fetch);
  const isDemo = new URLSearchParams(window.location.search).get('demo') === '1';

  window.fetch = async (...args) => {
    const requestUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

    if (!requestUrl.includes('data/products.json')) {
      return originalFetch(...args);
    }

    try {
      // In explicit demo mode, bypass Firestore completely. This is important
      // while the Firestore quota is exhausted: the CIASIFT demo must still
      // load the local menu and test the real Poster order endpoint.
      const menuResponse = isDemo
        ? await originalFetch('data/products.json')
        : await originalFetch(...args);

      if (!menuResponse.ok) throw new Error(`menu status ${menuResponse.status}`);

      const menu = await menuResponse.json();
      const colaResponse = await originalFetch('data/cola-test.json');

      if (colaResponse.ok) {
        const colaData = await colaResponse.json();
        const cola = colaData?.products?.[0];
        if (cola && !menu.products.some(product => String(product.id) === String(cola.id))) {
          menu.products.push(cola);
        }
      }

      return new Response(JSON.stringify(menu), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    } catch (error) {
      console.warn('[CIA Smart Menu] Demo menu load failed:', error);
      return originalFetch(...args);
    }
  };
})();
