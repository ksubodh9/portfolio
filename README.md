# Subodh Kumar — Portfolio

Personal portfolio site for **Subodh Kumar, AI / ML Engineer**.
Live: <https://ksubodh9.github.io/>

It's a static site (deployable as-is to GitHub Pages), but the page is
**assembled from small section files and a projects data file** so it stays easy
to maintain. A tiny zero-dependency Node script stitches everything into
`index.html`.

## Quick start

```bash
npm run build     # assemble src/ -> index.html
npm run watch     # rebuild automatically while editing src/
npm run serve     # preview locally at http://localhost:5173
```

There are no dependencies to install — the build uses only the Node standard
library. `npm run serve` fetches a static file server on demand.

> `index.html` is **generated**. Don't edit it directly — edit the files in
> `src/` and run `npm run build`.

## Project structure

```
.
├── index.html                  # GENERATED output (do not edit)
├── package.json                # build / watch / serve scripts
├── scripts/
│   └── build.mjs               # zero-dep static builder
├── src/                        # everything you actually edit
│   ├── layout.html             # page shell (head + include markers)
│   ├── partials/               # one file per major section
│   │   ├── nav.html
│   │   ├── hero.html
│   │   ├── about.html
│   │   ├── journey.html
│   │   ├── skills.html
│   │   ├── projects.html       # shell only — cards come from data
│   │   ├── ai-showcase.html
│   │   ├── experience.html
│   │   ├── achievements.html
│   │   ├── philosophy.html
│   │   ├── contact.html
│   │   └── footer.html
│   └── data/
│       └── projects.json       # the projects grid, as data
├── assets/                     # all static assets
│   ├── css/                    # portfolio-ai + legacy-theme (+ modern for sub-pages)
│   ├── js/                     # portfolio-ai.js
│   ├── img/                    # favicon, og cover, and img/projects/<name>/
│   └── vendor/                 # third-party (FontAwesome, Bootstrap)
├── resources/
│   ├── resumes/                # résumé PDFs (4 role variants)
│   └── case-studies/           # long-form platform write-ups
├── privacy.html, terms.html, project.html
├── index.legacy.backup.html    # previous dark AI-native design (kept for reference)
└── archive/legacy-template/    # unused starter-template files (safe to delete)
```

## Editing content

**A section's copy** (about, experience, skills, …): edit the matching file in
`src/partials/` and run `npm run build`.

**Projects**: edit `src/data/projects.json` — each entry is one card. Reorder the
array to reorder the grid; the first entry with `"featured": true` renders as the
wide featured card. Two card shapes are supported:

```jsonc
// image card
{ "media": { "type": "image", "src": "assets/img/projects/<name>/x.png",
             "alt": "…", "width": 700, "height": 394 }, … }

// designed placeholder card (no screenshot yet)
{ "media": { "type": "placeholder", "variant": "teal", // teal | indigo
             "icon": "fas fa-file-alt", "badge": "Flagship · GenAI" }, … }
```

Then `npm run build`.

## Theming

- `assets/css/portfolio-ai.css` — the base design system (tokens + components).
- `assets/css/portfolio-legacy-theme.css` — light "modern" theme layered on top
  (recolours tokens, keeps the hero dark). Loaded after the base.

## Deployment

Push to the `main` branch of the GitHub Pages repo. GitHub serves `index.html`
directly — no CI build required, since the build is committed. (Run
`npm run build` before committing so the output is up to date.)

## License

MIT
