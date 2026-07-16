# Appmaker Image Intake Form

A single self-contained HTML page for staging images before they get pushed
into Appmaker. Fill in **Page ID**, **Block Label**, and pick an image file —
the page reads the file locally and stores it as a `data:` URL in the
browser's IndexedDB, then renders it straight into the DOM.

No backend, no external requests, no build step.

## Why data URLs

The whole point of this page is to make the uploaded image readable by
same-origin JavaScript with zero friction. If you instead uploaded the image
to some other host and pointed an `<img>` tag at it, reading the raw bytes
back out via JS (`fetch` + `blob`, canvas `toDataURL`, etc.) would depend on
that host's CORS headers. A `data:` URL has no origin at all — it's just text
sitting in the page — so anything with JS access to this tab (including a
browser extension driving the page) can read it directly, with no CORS check
possible.

## Hosting it

Any static host works, since there's no server component:

- **GitHub Pages**: enable Pages for this repo pointed at `/upload-form`, or
  copy `index.html` into a `docs/` folder if that's your Pages source.
- **Local server**: `python3 -m http.server` from this directory, then open
  `http://localhost:8000`.
- **Netlify / Vercel / any static bucket**: drop `index.html` in and serve it.

Avoid opening it via a bare `file://` URL if you can — IndexedDB behavior
over `file://` is inconsistent across browsers. A trivial local static server
is enough.

## Data model

Each upload is stored as:

```json
{
  "id": "uuid",
  "pageId": "home",
  "blockLabel": "hero-banner",
  "fileName": "banner.png",
  "mimeType": "image/png",
  "byteLength": 123456,
  "imageDataUrl": "data:image/png;base64,....",
  "createdAt": "2026-07-16T12:00:00.000Z"
}
```

Storage is per-browser-profile (IndexedDB), not synced anywhere. Use the
**Export JSON** button if you need a portable snapshot.

## Reading it back out (for the Chrome extension / automation)

Two ways to grab the data once this page is open in a tab, both same-origin
and CORS-free:

1. **DOM query** — each card is `<article class="upload-card" data-appmaker-upload
   data-page-id="..." data-block-label="...">` and contains
   `<img data-role="upload-image" src="data:...">`. Query for the card
   matching the Page ID / Block Label you want, then read the `<img>`'s `src`
   attribute directly — that's the full data URL, no fetch needed.

2. **JS API** — the page exposes `window.appmakerUploads`:
   - `appmakerUploads.getAll()` → array of all stored records (including
     `imageDataUrl`)
   - `appmakerUploads.getById(id)` → single record
   - `appmakerUploads.refresh()` → reload from IndexedDB

   e.g. from an extension content script or devtools-driven automation:

   ```js
   const record = window.appmakerUploads
     .getAll()
     .find(r => r.pageId === "home" && r.blockLabel === "hero-banner");
   // record.imageDataUrl is ready to hand to Appmaker's upload field
   ```

From there, convert the data URL to a `File`/`Blob` if the target upload
field needs a real file object:

```js
const res = await fetch(record.imageDataUrl); // fetch on a data: URL never hits CORS
const blob = await res.blob();
const file = new File([blob], record.fileName, { type: record.mimeType });
```

## Limitations

- Storage lives in one browser profile — it won't follow you across devices.
- No auth: anyone with access to the page/browser can see and clear entries.
- Intended as a staging/hand-off tool, not a permanent image store. Once an
  upload has been pulled into Appmaker, delete it here (or periodically
  **Clear All**) to keep IndexedDB from growing unbounded.
