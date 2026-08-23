# CIA Smart Menu — AI Development Context

## 1. Project purpose

CIA Smart Menu is a restaurant QR menu and ordering platform built around Poster POS data.

Primary goal:

> Turn a normal restaurant QR menu into a smart, personalized menu that can understand dishes, ingredients, allergens, nutrition and customer preferences while keeping ordering connected to Poster.

Repository:
`Shant761/cia-smart-menu-demo`

Current Smart Menu URL:
`https://shant761.github.io/cia-smart-menu-demo/smart-menu/?restaurant=ciasift`

The `restaurant` query parameter identifies the restaurant. Do not hard-code CIASIFT-specific data into the application.

---

## 2. Current architecture

```text
Poster POS
   |
   | data sync
   v
Firebase / Firestore
   |
   | restaurantId
   v
Smart Menu frontend
   |
   +-- localized UI
   +-- product/category rendering
   +-- search/filter
   +-- cart
   +-- local My Orders
   |
   | order request
   v
Vercel backend
   |
   v
Poster API
```

Firebase is the source of the current public menu data for Smart Menu.
Poster remains the source system for restaurant products and order creation.

Do not introduce a second product database unless explicitly requested.
Do not silently replace Firebase with demo JSON.

---

## 3. Important existing code

### New working Smart Menu

`smart-menu/index.html`
`smart-menu/app.js`
`smart-menu/styles.css`

This is the current working customer-facing menu. It contains:

- Firebase menu loading;
- real restaurant products/categories;
- product cards;
- search;
- category filtering;
- cart;
- Poster order submission;
- success notification;
- local My Orders history.

### Firebase

`firebase-client.js`

This contains the public menu loading logic and Firebase integration.

### Backend

The Vercel backend contains the Poster order endpoint, currently used by the Smart Menu to create orders.

Do not change the order contract without checking the existing backend and testing the full flow.

---

## 4. Existing older Smart Menu implementation

The repository also contains an older Smart Menu implementation with functionality that is valuable and should be reused selectively.

It contains or has contained:

- RU / EN / HY localization;
- language preference persistence;
- localized UI strings;
- localized product names / `nameOverrides`;
- allergen selection and filtering;
- ingredient information;
- nutrition/calorie information;
- personalization/preferences.

This old implementation is a **feature donor**, not the source of the current menu data or ordering implementation.

Do NOT replace the current `smart-menu` with the old application wholesale.

Correct approach:

```text
old Smart Menu
    |
    +-- take mature i18n
    +-- take mature allergen logic
    +-- take nutrition logic
    +-- take useful personalization

current Smart Menu
    |
    +-- keep Firebase data
    +-- keep Poster ordering
    +-- keep current cart
    +-- keep My Orders
```

---

## 5. Current product data rules

Product data comes from Firebase and ultimately originates from Poster.

The frontend must support the actual existing data structure instead of inventing a new one.

Localized names may use `nameOverrides` for:

- `hy`
- `ru`
- `en`

Fallback should be predictable when a translation is missing.

Do not modify stored restaurant/product data merely to make the UI easier. First understand the existing schema.

---

## 6. Pricing rule

Price handling has previously caused bugs such as values appearing as `14` instead of `1400`.

Do not introduce arbitrary price conversion rules.

Before changing price logic:

1. inspect the actual Firebase value;
2. inspect the Poster source value;
3. determine where unit conversion currently happens;
4. normalize exactly once;
5. verify the displayed price and the order payload separately.

A displayed price and the Poster order price must not accidentally use different units.

---

## 7. Cart and Poster ordering — protected area

The current cart and Poster order flow is working and is a high-risk area.

When adding unrelated features:

- do not rewrite cart logic;
- do not change the Poster order payload;
- do not change `product_id` mapping;
- do not change quantity semantics;
- do not change the successful-order cleanup;
- do not change backend validation without a concrete reason.

After any change touching order code, test:

1. add one product;
2. increase/decrease quantity;
3. remove product;
4. verify total;
5. submit order;
6. verify Poster receives the order;
7. verify cart becomes empty;
8. verify success message disappears;
9. verify the order is saved in My Orders.

Never assume a successful HTTP response alone means a Poster order was successfully created; inspect the existing backend contract.

---

## 8. My Orders

Current My Orders is intentionally local-only.

Orders are stored in `localStorage` per restaurant.

This is an MVP feature and is NOT synchronized with Poster.

Current displayed status is only:

> `✓ Заказ отправлен`

Do not invent statuses such as:

- preparing;
- ready;
- completed;

until a real status source is implemented.

Order numbers shown to customers are short local numbers such as:

- `203`
- `204`
- `205`

These are NOT Poster order IDs.

Do not expose technical IDs to customers unless explicitly requested.

---

## 9. Localization plan

The existing mature localization implementation should be reused.

Target languages:

- Russian (`ru`)
- Armenian (`hy`)
- English (`en`)

Translate UI strings such as:

- My Orders;
- All;
- Search dishes;
- dishes count;
- Your order;
- Cart;
- Name;
- Phone;
- Comment;
- Send order;
- Sending;
- Order sent;
- No orders yet;
- Dishes not found;
- No photo.

Product names should use the existing localization/name override mechanism rather than hard-coded translations in JavaScript.

Do not create a second independent i18n system if the old implementation already provides the required behavior.

---

## 10. Smart features roadmap

The intended development order is:

### Phase 1 — Working menu
- Firebase data;
- Poster integration;
- product cards;
- search/categories;
- cart;
- order submission;
- local order history.

### Phase 2 — Localization
- RU / HY / EN;
- persistent language selection;
- localized product names.

### Phase 3 — Allergens
- structured ingredients;
- allergen mapping;
- customer allergen selection;
- automatic dish filtering;
- correct dish counts after filtering.

### Phase 4 — Nutrition
- calories;
- serving information;
- later, protein/fat/carbohydrate information if reliable data exists.

### Phase 5 — AI Menu Manager
AI can help transform imperfect Poster product data into structured information:

```text
Poster product
   |
   v
AI analysis
   |
   +-- ingredients
   +-- allergens
   +-- nutrition
   +-- descriptions
   +-- translations
```

AI-generated information must be reviewable/correctable by the restaurant. Do not present uncertain AI guesses as medically reliable facts.

---

## 11. Future product branches

The Smart Menu data foundation can later support:

- Smart Ordering;
- Waiter app;
- Kitchen Display;
- restaurant analytics;
- inventory management;
- AI restaurant assistant;
- loyalty/marketing;
- personalized recommendations.

These are future branches. Do not implement them in the current MVP unless explicitly requested.

---

## 12. Non-negotiable development rules

### Rule 1 — Inspect before changing
Always inspect the existing implementation and data schema before modifying it.

### Rule 2 — Do not guess
If behavior already exists in `poster-test`/the older implementation, study and reuse it instead of inventing a replacement.

### Rule 3 — Protect working flows
The Firebase → Smart Menu → Cart → Poster flow is the core working path. Changes outside the requested feature must not alter it.

### Rule 4 — No demo data in production path
Do not reintroduce `products.json`, demo restaurant data, or another mock source into the current Firebase-driven menu.

### Rule 5 — Small changes
Prefer small, isolated commits. Avoid rewriting large files when a focused change is possible.

### Rule 6 — Verify after changes
After frontend changes, test the real GitHub Pages URL with a real `restaurantId`.
After order changes, test the complete Poster order flow.

### Rule 7 — Preserve restaurantId architecture
The menu must remain restaurant-aware through the URL/query parameter and Firebase data. Do not hard-code `ciasift` into reusable logic.

### Rule 8 — Do not change unrelated behavior
If the task is translation, do not rewrite the cart. If the task is allergens, do not rewrite Poster ordering.

### Rule 9 — No fake capabilities
Do not show order statuses, nutritional values, allergens, or recommendations unless the application has reliable data for them.

### Rule 10 — Mobile first
The primary customer experience is a phone opened from a restaurant QR code. Every UI change must work well on small screens.

---

## 13. Verification checklist

Before considering a Smart Menu change complete:

- [ ] GitHub Pages loads.
- [ ] Correct restaurant is loaded from `restaurantId`.
- [ ] Firebase data loads.
- [ ] Categories work.
- [ ] Search works.
- [ ] Product cards work.
- [ ] Prices are correct.
- [ ] Cart works.
- [ ] Order submission still works if order code was touched.
- [ ] Success message behaves correctly.
- [ ] My Orders still records successful orders.
- [ ] Existing local data is not unintentionally deleted.
- [ ] Mobile layout is usable.
- [ ] No console errors related to the change.

For localization:

- [ ] RU works.
- [ ] HY works.
- [ ] EN works.
- [ ] language persists after reload.
- [ ] missing translations have a sensible fallback.

For allergens:

- [ ] selecting an allergen changes the visible dishes;
- [ ] dish count is recalculated;
- [ ] categories do not show incorrect counts;
- [ ] products without reliable allergen data are not falsely presented as safe.

---

## 14. Product philosophy

CIA Smart Menu should evolve from:

> QR menu + ordering

into:

> Smart restaurant menu and guest experience powered by the restaurant's existing Poster data.

The product should reduce restaurant work, improve customer understanding of dishes, and make ordering easier.

The best development strategy is incremental: make one feature reliable before building the next layer.