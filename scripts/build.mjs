#!/usr/bin/env node
/**
 * Static site builder — zero dependencies.
 *
 * Assembles src/layout.html + src/partials/*.html + src/data/projects.json
 * into a single static index.html at the repo root.
 *
 * Usage:
 *   node scripts/build.mjs        # build once
 *   node scripts/build.mjs --watch  # rebuild on change
 *
 * Include syntax inside layout/partials:  <!-- include: name -->
 *   -> inlines src/partials/name.html (recursively).
 * Projects grid:  <!-- projects:cards -->  inside partials/projects.html
 *   -> rendered from src/data/projects.json.
 */
import { readFileSync, writeFileSync, watch, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const PARTIALS = join(SRC, "partials");

const read = (p) => readFileSync(p, "utf8");

/* ---------- projects grid ---------- */
const CATEGORIES = {
  genai:   { label: "Gen AI",  cls: "cat-genai" },
  ml:      { label: "ML",      cls: "cat-ml" },
  backend: { label: "Backend", cls: "cat-backend" },
};

function renderProject(p) {
  const indent = "                ";
  const cat = CATEGORIES[p.category] || { label: p.type, cls: "cat-genai" };
  const flag = p.featured
    ? `\n                        <span class="project-flag"><i class="fas fa-star" aria-hidden="true"></i> Flagship</span>`
    : "";

  const media =
    p.media.type === "placeholder"
      ? `<a class="project-image ph ph-${p.media.variant}" href="${p.cardHref}" target="_blank" rel="noopener noreferrer" aria-label="${p.cardAria}">${flag}
                        <div class="ph-dots" aria-hidden="true"></div>
                        <i class="${p.media.icon} ph-icon" aria-hidden="true"></i>
                        <div class="project-overlay" aria-hidden="true">
                            <span><i class="${p.overlay.icon}"></i> ${p.overlay.label}</span>
                        </div>
                    </a>`
      : `<a class="project-image" href="${p.cardHref}" target="_blank" rel="noopener noreferrer" aria-label="${p.cardAria}">${flag}
                        <img src="${p.media.src}" alt="${p.media.alt}" loading="lazy" width="${p.media.width}" height="${p.media.height}">
                        <div class="project-overlay" aria-hidden="true">
                            <span><i class="${p.overlay.icon}"></i> ${p.overlay.label}</span>
                        </div>
                    </a>`;

  // Flagships get a headline stat row + more chips; standard cards stay lean.
  const chipLimit = p.featured ? 6 : 4;
  const chips = p.chips
    ? `
                        <div class="project-service-chips">
                            ${p.chips.slice(0, chipLimit).map((c) => `<span>${c}</span>`).join("")}
                        </div>`
    : "";

  const stats = (p.featured && p.stats)
    ? `
                        <div class="project-stats">
                            ${p.stats
                              .map((s) => `<span><i class="${s.icon}" aria-hidden="true"></i> ${s.text}</span>`)
                              .join("\n                            ")}
                        </div>`
    : "";

  const cls = p.featured ? "project-card is-flagship" : "project-card";

  return `${indent}<article class="${cls}" data-category="${p.category || "genai"}">
                    ${media}
                    <div class="project-body">
                        <div class="project-meta">
                            <span class="project-cat ${cat.cls}">${cat.label}</span>
                            <span class="project-tech">${p.tech}</span>
                        </div>
                        <h3>${p.title}</h3>
                        <p class="project-desc">${p.descHtml}</p>${stats}${chips}
                        <a class="project-link" href="${p.link.href}" target="_blank" rel="noopener noreferrer">
                            ${p.link.label} <i class="fas fa-arrow-right" aria-hidden="true"></i>
                        </a>
                    </div>
                </article>`;
}

function renderProjects(filter) {
  const data = JSON.parse(read(join(SRC, "data", "projects.json")));
  const list =
    filter === "featured"
      ? data.filter((p) => p.featured)
      : filter === "rest"
      ? data.filter((p) => !p.featured)
      : data;
  return list.map(renderProject).join("\n\n");
}

function projectsCount() {
  const data = JSON.parse(read(join(SRC, "data", "projects.json")));
  return `${data.length}+`;
}

/* ---------- includes ---------- */
function resolveIncludes(html, seen = new Set()) {
  return html.replace(/<!--\s*include:\s*([\w-]+)\s*-->/g, (_, name) => {
    if (seen.has(name)) throw new Error(`Circular include: ${name}`);
    const file = join(PARTIALS, `${name}.html`);
    if (!existsSync(file)) throw new Error(`Missing partial: ${name}.html`);
    const next = new Set(seen).add(name);
    return resolveIncludes(read(file), next).replace(/\n$/, "");
  });
}

/* ---------- build ---------- */
function build() {
  let html = resolveIncludes(read(join(SRC, "layout.html")));
  html = html.replace(/[ \t]*<!--\s*projects:featured\s*-->/, renderProjects("featured"));
  html = html.replace(/[ \t]*<!--\s*projects:rest\s*-->/, renderProjects("rest"));
  html = html.replace(/[ \t]*<!--\s*projects:cards\s*-->/, renderProjects());
  html = html.replace(/<!--\s*projects:count\s*-->/, projectsCount());
  const banner =
    "<!--\n  THIS FILE IS GENERATED — do not edit directly.\n" +
    "  Edit the sources in src/ (partials + data), then run: npm run build\n-->\n";
  writeFileSync(join(ROOT, "index.html"), banner + html);
  console.log(`[build] index.html written (${html.length} bytes) ${new Date().toLocaleTimeString()}`);
}

build();

if (process.argv.includes("--watch")) {
  console.log("[build] watching src/ for changes…");
  watch(SRC, { recursive: true }, () => {
    try {
      build();
    } catch (e) {
      console.error("[build] error:", e.message);
    }
  });
}
