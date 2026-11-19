# Pinfetch

Client-side Pinterest image downloader for GitHub Pages.

- Site: **https://daylennguyen.github.io/pinfetch/**
- Repo: **https://github.com/daylennguyen/pinfetch**

## URLs

| Paste this | Downloads |
| --- | --- |
| `https://www.pinterest.com/nationalgeographic/` | **Unorganized Ideas** on that profile |
| `https://www.pinterest.com/nationalgeographic/_saved/` | Same as above |
| `https://www.pinterest.com/nationalgeographic/animals/` | That board |

## Full boards (100+ pins)

From GitHub Pages, Pinterest often exposes only the first page of pins in a board. For the full set:

1. Open the board on Pinterest (for Unorganized Ideas: `https://www.pinterest.com/USERNAME/_quick_saves/`).
2. Drag the **[export bookmarklet](https://daylennguyen.github.io/pinfetch/)** from the live site into your bookmarks bar (or use the link on the page).
3. Run it on that board tab; it saves a `.json` file.
4. Import that JSON on **Pinfetch** and download the zip.

## Local preview

```bash
npm ci
npm run build:css   # edit src/input.css, then rebuild → styles.css
npx --yes serve .
npm test
```

Zip downloads use a CORS-safe fallback (`images.weserv.nl`) when Pinterest’s CDN blocks browser `fetch()` from GitHub Pages.

## GitHub Pages

This repo is a **project site** (not `daylennguyen.github.io` root), same pattern as [CryptokittiesFamilyTree](https://github.com/daylennguyen/CryptokittiesFamilyTree):

**Settings → Pages → Deploy from branch → `main` / `(root)`**

Published URL: `https://daylennguyen.github.io/pinfetch/`

## License

MIT