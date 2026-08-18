// Prevent demo-only data from leaking into real Poster products when numeric
// product IDs happen to collide. Poster allergen removability stays conservative
// until the restaurant explicitly verifies it, and demo calories are hidden until
// the real nutrition calculator writes calculated nutrition data.
(() => {
  const params = new URLSearchParams(window.location.search);
  const restaurantId = params.get('restaurant');
  const isRealPosterMenu = Boolean(restaurantId && restaurantId !== 'garden-table');

  // app.js keeps demo calories in a mutable object. Clear those demo entries for
  // real restaurant menus so IDs such as Poster product 104 cannot inherit demo kcal.
  if (isRealPosterMenu && typeof nutritionByProduct !== 'undefined') {
    Object.keys(nutritionByProduct).forEach((id) => delete nutritionByProduct[id]);
  }

  const original = window.getAllergenCustomization;
  if (typeof original !== 'function') return;

  window.getAllergenCustomization = function getPosterSafeAllergenCustomization(product, allergenId) {
    if (product?.source === 'poster') return null;
    return original(product, allergenId);
  };
})();
