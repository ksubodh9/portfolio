# Subodh Kumar — Portfolio

Personal portfolio site for **Subodh Kumar, AI / ML Engineer**, plus a grounded
RAG assistant that answers questions about his work.
Live: <https://ksubodh9.github.io/portfolio/>

The site is static (deployable as-is to GitHub Pages), but the page is
**assembled from small section files and a projects data file** so it stays easy
to maintain. A tiny zero-dependency Node script stitches everything into
`index.html`.

📖 **Full technical documentation:** [`docs/TECHNICAL.md`](docs/TECHNICAL.md)

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

To run the assistant backend locally:

```bash
cd assistant
cp .env.example .env      # add GEMINI_API_KEY
pip install -r requirements.txt
python ingest.py          # build the vector index
uvicorn server:app --reload --port 8000
```

## Project structure

```
.
├── index.html                  # GENERATED output (do not edit)
├── package.json                # build / watch / serve scripts
├── scripts/build.mjs           # zero-dep static builder
│
├── src/                        # everything you actually edit
│   ├── layout.html             # page shell (head + include markers)
│   ├── partials/               # one file per major section
│   │   ├── nav.html  mobile-menu.html  hero.html  tech-strip.html
│   │   ├── about.html  journey.html  skills.html
│   │   ├── projects.html       # shell only — cards come from data
│   │   ├── ai-showcase.html  experience.html  achievements.html
│   │   ├── philosophy.html  contact.html  footer.html
│   │   └── assistant.html      # the AI companion widget markup
│   └── data/projects.json      # the projects grid, as data
│
├── assets/
│   ├── css/                    # portfolio-ai (base) + legacy-theme (light)
│   │                           # + assistant + bunny-widget (companion)
│   │                           # + portfolio-modern (sub-pages only)
│   ├── js/                     # portfolio-ai.js (site)
│   │                           # assistant.js / -voice.js / -avatar.js (companion)
│   ├── img/                    # favicon, og cover, and img/projects/<name>/
│   └── vendor/                 # third-party (FontAwesome, Bootstrap)
│
├── assistant/                  # FastAPI RAG backend for the companion
│   ├── server.py  retriever.py  llm.py  prompt.py  ingest.py  common.py
│   ├── knowledge/              # the KB: *.md + profile.json + manifest.json
│   ├── eval/                   # retrieval quality gate + E2E pipeline test
│   └── Dockerfile  docker-compose.yml  .env.example
│
├── resources/
│   ├── resumes/                # résumé PDFs (4 role variants)
│   └── case-studies/           # long-form platform write-ups
│
├── docs/
│   ├── TECHNICAL.md            # full technical documentation
│   └── ai-avatar-assistant-plan.md
└── privacy.html, terms.html, project.html
```

## Editing content

**A section's copy** (about, experience, skills, …): edit the matching file in
`src/partials/` and run `npm run build`.

**Projects**: edit `src/data/projects.json` — each entry is one card. Reorder the
array to reorder the grid; entries with `"featured": true` render as wide
flagship cards with a stat row. Two card shapes are supported:

```jsonc
// image card
{ "media": { "type": "image", "src": "assets/img/projects/<name>/x.png",
             "alt": "…", "width": 700, "height": 394 }, … }

// designed placeholder card (no screenshot yet)
{ "media": { "type": "placeholder", "variant": "teal", // teal | indigo
             "icon": "fas fa-file-alt" }, … }
```

Then `npm run build`.

> Adding a project to the grid does **not** teach the assistant about it. Also
> add it to `assistant/knowledge/projects.md` and re-run `python ingest.py`.

**Assistant knowledge**: edit `assistant/knowledge/*.md` (chunked and embedded)
or `profile.json` (the always-on core-facts card), then re-run
`python ingest.py` and redeploy the backend.

## Theming

- `assets/css/portfolio-ai.css` — the base design system (tokens + components).
- `assets/css/portfolio-legacy-theme.css` — light "modern" theme layered on top
  (recolours tokens, keeps the hero dark). Loaded after the base.
- `assets/css/assistant.css` + `bunny-widget.css` — the companion widget,
  consuming the same tokens. They share exactly one selector by design; don't
  re-declare `.asst-*` rules across both.

## Deployment

Push to the `main` branch. GitHub serves `index.html` directly — no CI build
required, since the build is committed. Run `npm run build` before committing so
the output is up to date.

The repo is `ksubodh9/portfolio`, so Pages serves it from the **`/portfolio/`
sub-path** — absolute self-references (`canonical`, `og:url`, `og:image`,
JSON-LD `url`) must include it.

The assistant backend deploys separately as a container. See
[`docs/TECHNICAL.md` §6](docs/TECHNICAL.md) for the going-live checklist.

## License

MIT
