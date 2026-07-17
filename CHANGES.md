# Portfolio Transformation — AI / ML Engineer

Repositioned the portfolio from "Backend Engineer who does some AI" to **AI / ML Engineer with a strong backend foundation**, with a dark, AI-native design inspired by OpenAI, Anthropic, Linear, and Vercel.

---

## 1. Summary of changes

- Rebuilt the homepage (`index.html`) in place — same single page, refactored, not a set of disconnected pages.
- New cohesive dark design system: `css/portfolio-ai.css` (replaces the light `portfolio-modern.css` for the homepage).
- New interaction layer: `js/portfolio-ai.js` — replaces AOS and jQuery with a lightweight IntersectionObserver reveal and vanilla JS.
- Removed render-blocking / heavy dependencies (jQuery, Bootstrap JS, AOS library). Only one small CDN script remains (Typed.js), loaded with `defer`.
- AI-first content throughout, sourced by merging the résumé and the GitHub project analysis.
- Original homepage preserved as `index.legacy.backup.html` (also recoverable via git).

## 2. New content generated

- **Hero**: headline "Building intelligent systems with AI", AI-focused value proposition, AI metrics (4.5+ yrs, 10+ AI/ML projects, 4 LLM providers, 85%+ accuracy), an animated `rag_pipeline.py` code card, and a typed tagline cycling AI roles.
- **About**: rewritten as an authentic career-journey narrative — backend → AI as a deliberate progression, not a pivot.
- **AI Journey** timeline: 2020 → 2026 (Backend → Advanced Backend → Data Science/ML → GenAI/RAG → AI Product Builder).
- **Skills**: regrouped AI-first — Generative AI, Machine Learning, Data Science, Backend & APIs, Databases, Cloud & DevOps (no skill bars).
- **Projects** as case-study cards (Problem / Solution / Architecture / Impact + metrics + stack + GitHub/Live/Architecture buttons): DocIntel (flagship), Predictive Maintenance, Smart AI Assistant, Career Compass, Churn & House Price, Walmart, and MaddoxPay (framed as backend foundation + first ML-in-production).
- **AI Showcase ("Under the Hood")**: visual RAG pipeline diagram (Documents → Chunk+Embed → Vector Store → Retrieve → LLM) plus a feature grid (chunking, embeddings, vector DB, semantic search, multi-LLM, citations).
- **Experience**: timeline rewritten to lead with the applied-ML / model-serving work.
- **Achievements + GitHub**: six achievement cards and a GitHub stat band with animated technology-distribution bars.
- **Engineering Philosophy**: three authentic principle cards (production over prototype, explainable & grounded, always be learning) — replaces fake testimonials.
- **Contact**: redesigned with "Let's build something intelligent", direct links, three résumé variants, and a working mailto form.

## 3. Design improvements

- Dark navy/slate palette (`#070b16`) with electric-blue (`#3b82f6`) + cyan (`#22d3ee`) accents; restrained, professional, not flashy.
- Glassmorphism cards, gradient borders, soft glows, animated background orbs and a masked grid in the hero.
- Typography: Sora (headings), Inter (body), JetBrains Mono (code/labels) — an AI-tooling feel.
- Consistent component system: pill buttons, eyebrow labels, mono micro-labels, hover lifts, gradient text.
- Subtle, tasteful motion: scroll reveal, marquee tech strip, typed tagline, pulsing status dots, animated stat bars — all disabled under `prefers-reduced-motion`.

## 4. Components added

Dark nav + glass blur, animated hero code card, marquee tech strip, AI Journey timeline, AI-first skill cards, case-study project cards (with designed gradient "art" cards for image-less projects), RAG pipeline diagram, achievement cards, GitHub stat band with animated bars, philosophy cards, redesigned contact + form.

## 5. Components removed

- jQuery, Bootstrap JS/CSS, and the AOS library (replaced by ~3 KB of vanilla JS + CSS).
- Fintech-first framing in hero/about/skills; standalone Certifications, Education, and FAQ sections (folded their essence into About/Journey/Philosophy to keep the page focused).
- Fake testimonial section → replaced by Engineering Philosophy.

## 6. SEO improvements

- Title, description, keywords rewritten around AI Engineer / ML Engineer / Generative AI / RAG / FastAPI / Data Scientist.
- Open Graph + Twitter card metadata updated; added `canonical` and `theme-color`.
- Added **JSON-LD `Person` structured data** (`jobTitle`, `knowsAbout`, `sameAs`) for rich search results.
- Semantic landmarks (`<main>`, `<header>`, `<nav>`, `<section>`, `<article>`), a skip link, and descriptive `alt` text and ARIA labels.

## 7. Performance recommendations

- **Done:** dropped jQuery/Bootstrap/AOS; deferred scripts; lazy-loaded project images; CSS-only animations.
- **Next:** self-host the two web fonts (and Typed.js) to remove third-party round-trips; subset to used weights.
- Compress/convert images to WebP/AVIF (several PNG screenshots are >100 KB) and add explicit `width`/`height` everywhere to avoid layout shift.
- Self-host FontAwesome subset (only ~30 icons are used) instead of the full `fontawesome-all.css`.
- Add a `manifest.json`, `sitemap.xml`, and cache headers when deploying.

## 8. Future enhancements

- Live, embedded demos for DocIntel and the Streamlit apps (iframe or recorded loops).
- A dedicated DocIntel case-study page mirroring the depth of the fintech case study.
- Light/dark toggle, blog/notes section, and a real backend for the contact form (e.g. a serverless function) instead of mailto.
- Add comprehensive `pytest` coverage and CI badges to surface engineering rigor; pull live GitHub stats via the API.

## 9. Notes / things to personalize

- Replace the hero/profile avatar placeholder (`fa-user-astronaut`) with a real professional photo (`images/` → reference in `.profile-avatar`).
- "Career Compass" GitHub button points to the profile (no public repo URL was provided) — update if a repo exists.
- DocIntel "Architecture" button anchors to the on-page AI Showcase; swap for a live URL when available.

---

**Files:** `index.html` (refactored), `css/portfolio-ai.css` (new), `js/portfolio-ai.js` (new), `index.legacy.backup.html` (original backup).
