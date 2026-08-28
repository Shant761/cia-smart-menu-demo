(() => {
  const params = new URLSearchParams(window.location.search);
  const restaurantId = params.get('restaurant');

  // Garden Table remains the visual demo. Real restaurants use Firestore nutrition.
  if (!restaurantId || restaurantId === 'garden-table') return;

  const applyNutrition = (menu) => {
    try {
      const products = Array.isArray(menu?.products) ? menu.products : [];
      if (!products.length) return false;

      if (typeof nutritionByProduct !== 'undefined') {
        products.forEach((product) => {
          delete nutritionByProduct[product.id];
        });

        let calculated = 0;
        products.forEach((product) => {
          if (product?.nutrition?.status !== 'calculated') return;
          const calories = Number(product.nutrition.calories);
          if (!Number.isFinite(calories)) return;
          nutritionByProduct[product.id] = {
            calories,
            per100g: product.nutrition.per100g ?? null,
            servingGrams: product.nutrition.servingGrams ?? null,
            source: product.nutrition.source || 'Poster recipe + USDA'
          };
          calculated += 1;
        });

        console.info(`[CIA Smart Menu] Verified nutrition loaded: ${calculated} dishes for ${restaurantId}`);
      }

      if (typeof renderAll === 'function' && state?.menu) renderAll();
      return true;
    } catch (error) {
      console.warn('[CIA Smart Menu] Nutrition apply failed.', error);
      return false;
    }
  };

  if (state?.menu && applyNutrition(state.menu)) return;

  window.addEventListener('cia:menu-loaded', (event) => {
    applyNutrition(event.detail?.menu || state?.menu);
  }, { once: true });
})();
