# CIA Smart Menu Demo

Mobile-first demo of a smart restaurant QR menu with allergen filtering.

## MVP v0.1

- Restaurant menu with categories and search
- Personal allergen filters
- Two modes: show only suitable dishes / show all with warnings
- Dish details with ingredients and allergen status
- RU / EN / HY data structure
- Static JSON data for easy GitHub Pages hosting
- No API keys and no backend in the demo

## Local structure

```text
index.html
styles.css
app.js
data/
  allergens.json
  products.json
```

Later the static JSON will be replaced by a Poster API adapter while keeping the same UI model.
