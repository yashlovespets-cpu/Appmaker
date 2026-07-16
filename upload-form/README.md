# Appmaker Image Intake

A tiny Google Apps Script web app for staging images before they get pushed
into Appmaker. Fill in **Page ID**, **Block Label**, and pick an image file —
the file is uploaded to a Drive folder, its metadata goes in a companion
Sheet, and the page renders every upload back out as a `data:` URL so it's
readable straight off the DOM.

Because storage is server-side (Drive + Sheets), uploads are shared across
every browser/device that opens the deployed URL — unlike a purely
client-side (IndexedDB) version, which is scoped to one browser profile.

## Files

- `Code.gs` — server logic: `doGet`, `submitUpload`, `listUploads`, `deleteUpload`.
- `Index.html` — the form + upload list UI, calling the server via `google.script.run`.
- `appsscript.json` — manifest; pre-sets the web app to run as the deploying
  account and restrict access to your Workspace domain (see below).

## Deploying

1. Go to [script.google.com](https://script.google.com), **New project**.
2. Rename it (e.g. "Appmaker Image Intake"), delete the default `Code.gs`
   stub content, and paste in this repo's `Code.gs`.
3. Add an HTML file named `Index` (**File → New → HTML**) and paste in this
   repo's `Index.html`.
4. Open **Project Settings → Show "appsscript.json" manifest file in editor**,
   then replace its contents with this repo's `appsscript.json`. This sets:
   - `"executeAs": "USER_DEPLOYING"` — Drive/Sheets calls always run under
     the account that deployed the script, so viewers don't need their own
     access to the underlying folder/sheet.
   - `"access": "DOMAIN"` — only people signed in with a Google account on
     your Workspace domain (e.g. `@supertails.com`) can open the web app at
     all. Google prompts them to sign in first.
5. **Deploy → New deployment → Web app**. Confirm "Execute as: Me" and
   "Who has access: Anyone within [your domain]" match the manifest (the UI
   should preselect them). Deploy, and copy the web app URL
   (`https://script.google.com/macros/s/XXXX/exec`).
6. Open that URL — it'll ask you to sign in if you aren't already, then show
   the form. The first successful upload auto-creates the `Appmaker Uploads`
   Drive folder and its metadata Sheet (both discoverable in your Drive).

If you'd rather deploy from the command line, this layout also works with
[`clasp`](https://github.com/google/clasp) (`clasp create`, `clasp push`,
`clasp deploy`) using the same three files.

## Data model

Each row in the Sheet / record returned by the server looks like:

```json
{
  "id": "uuid",
  "pageId": "home",
  "blockLabel": "hero-banner",
  "fileName": "banner.png",
  "mimeType": "image/png",
  "byteLength": 123456,
  "driveFileId": "1AbCdEf...",
  "createdAt": "2026-07-16T12:00:00.000Z",
  "uploadedBy": "someone@supertails.com",
  "imageDataUrl": "data:image/png;base64,...."
}
```

`imageDataUrl` is only present in the payloads the client actually renders
(`submitUpload`'s return value and each `listUploads` result) — it's fetched
from Drive and base64-encoded on demand, not stored anywhere.

Max image size is 20MB per upload (`MAX_IMAGE_BYTES` in `Code.gs`) — plenty
for block images, comfortably under Apps Script's payload limits.

## Reading it back out (for the Chrome extension / automation)

Open the deployed URL in a tab (already-authenticated Chrome sessions won't
even see the Google sign-in prompt), then read data straight out of the page
— same-origin, no `fetch`, no CORS, because it's a `data:` URL:

1. **Wait for load**, since the list populates asynchronously after the page
   loads: `await window.appmakerUploads.ready` (resolves once the initial
   `listUploads` call returns).

2. **DOM query** — each card is
   `<article class="upload-card" data-appmaker-upload data-page-id="..." data-block-label="...">`
   containing `<img data-role="upload-image" src="data:...">`. Find the card
   matching the Page ID / Block Label you want and read the `<img>`'s `src`.

3. **JS API** — `window.appmakerUploads.getAll()` / `.getById(id)` return the
   full records (including `imageDataUrl`) already loaded into the page.

   ```js
   await window.appmakerUploads.ready;
   const record = window.appmakerUploads
     .getAll()
     .find(r => r.pageId === "home" && r.blockLabel === "hero-banner");
   // record.imageDataUrl is ready to hand to Appmaker's upload field
   ```

4. **Direct-load via URL** — open
   `.../exec?pageId=home&blockLabel=hero-banner` and the page pre-fills those
   filters and loads only matching records before anything else, so there's
   no need to search a long list. Filters are substring, case-insensitive
   matches on each field.

To turn a data URL into a real `File`/`Blob` for a `<input type="file">`
target:

```js
const res = await fetch(record.imageDataUrl); // fetch on a data: URL never hits CORS
const blob = await res.blob();
const file = new File([blob], record.fileName, { type: record.mimeType });
```

## Limitations

- Access requires a Google account on the configured domain — there's no
  separate app-level auth to manage, but it also means it can't be opened
  by anyone outside that Workspace.
- Every `listUploads` call re-reads matching files from Drive and
  base64-encodes them on the fly; fine for a hand-fed intake tool with
  dozens of images, but if the library grows very large, narrow with the
  Page ID / Block Label filters (or the `?pageId=&blockLabel=` URL params)
  rather than loading everything.
- Deleting a record removes both the Sheet row and the Drive file — there's
  no undo, so double-check before deleting.
