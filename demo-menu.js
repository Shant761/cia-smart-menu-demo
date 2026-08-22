(() => {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (...args) => {
    const requestUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    const response = await originalFetch(...args);

    if (!requestUrl.includes('data/products.json')) return response;

    try {
      const menu = await response.clone().json();
      const colaResponse = await originalFetch('data/cola-test.json');
      if (colaResponse.ok) {
        const colaData = await colaResponse.json();
        const cola = colaData?.products?.[0];
        if (cola && !menu.products.some(product => String(product.id) === String(cola.id))) {
          menu.products.push(cola);
        }
      }

      return new Response(JSON.stringify(menu), {
        status: response.status,
        statusText: response.statusText,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (_) {
      return response;
    }
  };
})();
