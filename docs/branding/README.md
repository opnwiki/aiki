# AIKI branding

The approved logo uses an astronomical spiral galaxy and a lowercase serif
wordmark with orbital strokes. Both are independent assets.

- `public/aiki-galaxy.png`: transparent galaxy source extracted from the approved logo.
- `public/aiki-galaxy.webp`: small transparent galaxy for the header.
- `public/aiki-wordmark.svg`: actual vector outlines, including the orbital strokes;
  no embedded bitmap and no external font dependency.
- `aiki-wordmark-reference.png`: cropped lettering from the approved logo.
- `public/aiki-app-icon.png`: 1024px square app icon on `#0b1d2a`.
- `public/icon-{16,32,180,192,512}.png`: browser, Apple and PWA sizes.
- `public/icon-512-maskable.png`: the complete galaxy fits in the central safe circle.
- `public/favicon.ico`: 16, 32, 48 and 64px representations.

The header renders the transparent galaxy and SVG wordmark separately. CSS
inverts the dark wordmark in the dark theme. The home link supplies the
accessible name, and both images have empty alternative text.

Rebuild the SVG with Python plus Pillow and NumPy:

```sh
python scripts/branding/trace-wordmark.py docs/branding/aiki-wordmark-reference.png public/aiki-wordmark.svg
```

Rebuild raster icons with Node.js and the optional Sharp image-processing tool:

```sh
node scripts/branding/build-icons.mjs /absolute/path/to/sharp
```

Omit the module path if Sharp is installed in the local tooling environment.
Neither asset-building tool is required by the app at runtime.
