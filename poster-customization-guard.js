// Isolate legacy Garden Table demo nutrition from real restaurant menus.
// Allergen removability is handled in customization.js only from restaurant-confirmed data.
(() => {
  const params = new URLSearchParams(window.location.search);
  const restaurantId = params.get('restaurant');
  const isRealRestaurant = Boolean(restaurantId && restaurantId !== 'garden-table');

  if (isRealRestaurant && typeof nutritionByProduct !== 'undefined') {
    Object.keys(nutritionByProduct).forEach((id) => delete nutritionByProduct[id]);
  }
})();
