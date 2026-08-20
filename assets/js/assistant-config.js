/* ═══════════════════════════════════════════
   ASSISTANT ENDPOINT — hand-edited, NOT generated.

   The frontend (GitHub Pages) and the backend (a container host) deploy on
   separate tracks, so the backend's address must not be baked into a build
   artifact. index.html IS generated — editing it is always wrong — so the
   endpoint lives here instead, in a file `npm run build` never touches.
   Changing backend host is a one-line edit and a commit; no rebuild.

   assistant.js reads window.ASSISTANT_API_BASE FIRST, ahead of the
   data-api-base attribute and ahead of the localhost autodetect.

   Leave it empty for local development: the widget then auto-targets
   http://localhost:8000 on a local hostname, and shows a graceful
   "companion is offline" message on a public one.

   Origin only — no trailing path, no trailing slash. It must also appear in
   the backend's ALLOWED_ORIGINS, or every request fails CORS preflight.
     e.g. "https://subodh24fd-portfolio-assistant-ai.hf.space"
═══════════════════════════════════════════ */
window.ASSISTANT_API_BASE = "";
