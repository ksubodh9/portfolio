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
function renderProject(p) {
  const indent = "                ";
  const media =
    p.media.type === "placeholder"
      ? `<a class="project-image ph ph-${p.media.variant}" href="${p.cardHref}" target="_blank" rel="noopener noreferrer" aria-label="${p.cardAria}">
                        <span class="ph-badge">${p.media.badge}</span>
                        <div class="ph-dots" aria-hidden="true"></div>
                        <i class="${p.media.icon} ph-icon" aria-hidden="true"></i>
                        <div class="project-overlay" aria-hidden="true">
                            <span><i class="${p.overlay.icon}"></i> ${p.overlay.label}</span>
                        </div>
                    </a>`
      : `<a class="project-image" href="${p.cardHref}" target="_blank" rel="noopener noreferrer" aria-label="${p.cardAria}">
                        <img src="${p.media.src}" alt="${p.media.alt}" loading="lazy" width="${p.media.width}" height="${p.media.height}">
                        <div class="project-overlay" aria-hidden="true">
                            <span><i class="${p.overlay.icon}"></i> ${p.overlay.label}</span>
                        </div>
                    </a>`;

  const stats = p.stats
    ? `
                        <div class="project-stats">
                            ${p.stats
                              .map(
                                (s) =>
                                  `<span><i class="${s.icon}" aria-hidden="true"></i> ${s.text}</span>`
                              )
                              .join("\n                            ")}
                        </div>`
    : "";

  const chips = p.chips
    ? `
                        <div class="project-service-chips">
                            ${p.chips.map((c) => `<span>${c}</span>`).join("")}
                        </div>`
    : "";

  const cls = p.featured ? "project-card project-card-featured" : "project-card";

  return `${indent}<article class="${cls}">
                    ${media}
                    <div class="project-body${p.featured ? " project-body-with-bg" : ""}">
                        <div class="project-meta">
                            <span class="project-type">${p.type}</span>
                            <span class="project-tech">${p.tech}</span>
                        </div>
                        <h3>${p.title}</h3>
                        <p>${p.descHtml}</p>${stats}${chips}
                        <a class="project-link" href="${p.link.href}" target="_blank" rel="noopener noreferrer">
                            ${p.link.label} <i class="fas fa-arrow-right" aria-hidden="true"></i>
                        </a>
                    </div>
                </article>`;
}

function renderProjects() {
  const data = JSON.parse(read(join(SRC, "data", "projects.json")));
  return data.map(renderProject).join("\n\n");
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
  html = html.replace(/[ \t]*<!--\s*projects:cards\s*-->/, renderProjects());
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
