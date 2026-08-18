// Prevent demo per-product customization rules from leaking into real Poster products
// when numeric product IDs happen to collide. Unknown Poster removability stays
// conservative until the restaurant explicitly verifies it.
(() => {
  const original = window.getAllergenCustomization;
  if (typeof original !== 'function') return;

  window.getAllergenCustomization = function getPosterSafeAllergenCustomization(product, allergenId) {
    if (product?.source === 'poster') return null;
    return original(product, allergenId);
  };
})();
