# Pinfetch

Client-side Pinterest image downloader for GitHub Pages.

- Site: **https://daylennguyen.github.io/pinfetch/**
- Repo: **https://github.com/daylennguyen/pinfetch**

## URLs

| Paste this | Downloads |
| --- | --- |
| `https://www.pinterest.com/itmedaylen/` | **Unorganized Ideas** on that profile |
| `https://www.pinterest.com/itmedaylen/_saved/` | Same as above |
| `https://www.pinterest.com/itmedaylen/stuff-to-buy/` | That board |

## Full boards (100+ pins)

From GitHub Pages, Pinterest often exposes only the first page of pins in a board. For the full set:

1. Open the board on Pinterest (for Unorganized Ideas: `https://www.pinterest.com/USERNAME/_quick_saves/`).
2. Drag the **[export bookmarklet](https://daylenghuyen.github.io/pinfetch/)** from the live site into your bookmarks bar (or use the link on the page).
3. Run it on that board tab; it saves a `.json` file.
4. Import that JSON on **Pinfetch** and download the zip.

## Local preview

```bash
npx --yes serve .
```

## GitHub Pages

This repo is a **project site** (not `daylenghuyen.github.io` root), same pattern as [CryptokittiesFamilyTree](https://github.com/daylenghuyen/CryptokittiesFamilyTree):

**Settings → Pages → Deploy from branch → `main` / `(root)`**

Published URL: `https://daylenghuyen.github.io/pinfetch/`

## License

MIT