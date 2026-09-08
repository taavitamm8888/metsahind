# Pengo publishing: how it works and what breaks it

Installed 2026-09-09. Kit 1.1.0, format `pengo-json-v1`, site `metsahind.com`.

Pengo writes article JSON into this folder and commits it. Netlify then builds the
site and turns that JSON into real HTML pages. Pengo does not host anything, and
there is no CMS or database. Everything below is plain files in this repository.

## The build

Netlify runs, from `netlify.toml`:

```sh
node .pengo/build.mjs --source . --output .pengo-build
```

It copies every existing page and asset into `.pengo-build`, then adds the Pengo
articles, the article list, `/pengo-sitemap.xml`, `robots.txt` and the setup proof
at `/.well-known/pengo.json`. Netlify publishes `.pengo-build`, not the repo root.
Your own pages are copied through untouched. The builder never edits source files.

## Files, and what happens if you change them

| File | Safe to edit? | If you break it |
| --- | --- | --- |
| `.pengo/config.json` | **No** | Pengo pins this after connecting. Changing `siteUrl`, `blogPath` or `siteId` changes the manifest hash, the proof no longer matches and Pengo reports the install as broken. A `blogPath` change also moves every article URL and orphans the published ones. |
| `.pengo/build.mjs` | **No** | Supplied by Pengo, verified by checksum. Replace only with a newer official copy. |
| `.pengo/check-install.mjs` | **No** | Same. It is a local test tool and is never deployed. |
| `.pengo/template.html` | Yes, carefully | This is the design wrapper for every article. Keep exactly one PENGO_HEAD marker and one PENGO_BODY marker. Do not add a title, canonical, meta description or Article JSON+LD; the builder writes those and duplicates are a real SEO bug. |
| `.pengo/articles/*.json` | **No** | Written by Pengo. Each file is hash checked. Editing text, ids or the hash fails the build for that article. |
| `.pengo/assets/*` | **No** | Article images, named by their own SHA256. Renaming breaks the integrity check. |
| `teadmised/index.html` | Yes, carefully | Must keep exactly one PENGO_ARTICLES marker comment. Missing or duplicated, the build fails and the whole site stops deploying. |
| `netlify.toml` | Yes, carefully | Overrides the Netlify UI. Reverting `publish` to `.` silently drops every article and the proof file. |
| `.gitignore` | Yes | Must keep ignoring `.pengo-build/` and must never ignore `.pengo/`. |

## Things that will silently break publishing

1. **Re exporting the site from the page builder.** This repository looks like a
   static export. If the tool that produced these pages regenerates
   `teadmised/index.html`, it will wipe the PENGO_ARTICLES marker and the next
   deploy fails. After any re export, put the marker back and rerun the check below.
2. **Changing the canonical host.** `config.json` pins `https://www.metsahind.com`.
   The live site sends `metsahind.com` to `www` with a 301. If that redirect is
   ever reversed, the manifest, the proof and every article URL must be migrated
   together, and that needs a review on the Pengo side first.
3. **Adding a catch all redirect.** A SPA style `/* -> /index.html 200` rule in
   `_redirects` would make unknown article URLs return 200 instead of 404, which
   Pengo rejects.
4. **Committing `.pengo-build/`.** It is generated. A stale copy causes confusion.
5. **Adding a file named `pengo-sitemap.xml`** at the repo root. The builder
   refuses to overwrite it and the build fails.
6. **A new page whose folder collides with an article slug** under `/teadmised/`.
   The builder refuses rather than overwriting your page.

## Checking it still works

From the repository root, with Node 20 or newer:

```sh
node .pengo/check-install.mjs --root .
```

Expect `"result": "local_checks_pass"` and `"customerSourceModified": false`. It
builds a throwaway copy with one fake test article and never touches your files.
The fake article is local only. Never deploy the output it produces.

To preview a real build locally:

```sh
rm -rf .pengo-build && node .pengo/build.mjs --source . --output .pengo-build
```

## Current settings

- Articles are published to `/teadmised/<slug>/`, listed on `/teadmised/`.
- Article images are served from `/pengo-media/`.
- Setup proof: `https://www.metsahind.com/.well-known/pengo.json`.
- Manifest hash: `0cccb03de63c3582eaf811c2aad52c78a92280844fdcd96f864031ec687f890f`
  (recompute: SHA256 of `config.json` with keys in the order version, siteId,
  siteUrl, branch, blogPath, assetPath, format).
