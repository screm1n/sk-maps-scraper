# CLAUDE.md — Google Maps Scraper Kit

You are working inside the **Google Maps Scraper Kit**. This folder runs a local Google Maps scraper
and you drive it for the user.

## What this project is
A Docker-based local deployment of the open-source `gosom/google-maps-scraper`, exposed as a REST API
at **`http://localhost:8080`**, plus a skill that teaches you to use it. It scrapes **Google Maps
business listings only** (not social media).

## When the user asks to scrape businesses / get a list of places / lead-gen data
**Load and follow the `google-maps-scraper` skill** (`.claude/skills/google-maps-scraper/SKILL.md`).
It has the exact API flow, the required fields, and the best-practice + safety rules. Don't improvise
the API calls from memory — use the skill.

## Slash commands
This kit ships commands in `.claude/commands/` that map to the skill: `/scrape` (single query),
`/scrape-batch` (many queries, one job), `/scrape-setup` (start the scraper), `/scrape-jobs` (list/delete).
Local commands are pre-approved in `.claude/settings.json` so you can run them without prompting the user.

## Rate limits — warn, don't block
If a request is large/high-volume (high `depth`, many keywords, repeated runs, or `email:true`), **proceed**
but first print ONE short warning that over-use can get the user's IP temporarily rate-limited by Google,
and suggest proxies. Do NOT gate or demand confirmation for a normal big scrape. Refuse only clearly
abusive use (surveilling individuals, spam). Full guidance is in the skill.

## Hard facts you must not get wrong
- API base: `http://localhost:8080` — **no auth** (it's localhost-only). Never expose it publicly.
- Create a job: `POST /api/v1/jobs`. **Required** body fields or it 422s:
  `max_time` (in **seconds**, e.g. `300`), `lat` & `lon` (as **strings**), plus `keywords` (array).
- The create response returns `{"id":"<uuid>"}` (lowercase `id`). Status checks use `GET /api/v1/jobs/{id}` whose field is `"Status"` and becomes `"ok"` when done.
- **Poll in the background.** The Bash tool blocks foreground `sleep`; run the poll loop as a
  background command (`run_in_background: true`) and read its output file when notified.
- Before a big job (high depth / many keywords), **confirm with the user** — cost is time + IP-block risk.
- Scraped emails/phones are **personal data**; don't dump huge CSVs into chat — summarize + save to disk.

## Leads mode
`/leads` (served by the `leads` service, code in `./leads`) turns finished jobs into a qualified lead
database: A/B/C layers, score, mobile vs landline per country, WhatsApp queue, templates, replies,
metrics, proposals. Its API is `http://localhost:8080/leads-api/*` (e.g. `POST /leads-api/buscas/<job-id>/importar`,
`GET /leads-api/fila`, `GET /leads-api/metricas`). When the user wants leads *qualified* or *contacted*
(not just listed), import the job there instead of dumping a CSV. Never send WhatsApp messages on the
user's behalf without explicit confirmation of who receives what. The rules live in `leads/src/dominio`
and are covered by `cd leads && npm test`; keep them passing.

## Scraping source (Local / Apify / Google Places)
`/api/v1/jobs` is answered by the leads server, not the scraper: it forwards to the local scraper
when the source is **Local**, and runs the search on **Apify** or **Google Places** otherwise (same job
shape, same 34-column CSV). The source and the keys live in the leads database
(`GET/POST /leads-api/fontes`). Apify and Places cost the user money or quota: before creating a job on
them, say which source is active and the estimate (`GET /leads-api/fontes/estimativa?termos=&depth=`).
Never print the keys.

## Setup
If the container isn't running: `docker compose up -d`, then verify `curl http://localhost:8080/api/v1/jobs`.
Full setup is in `SETUP.md`.

## Attribution
This wraps `gosom/google-maps-scraper` (MIT, © Georgios Komninos). Keep `CREDITS.md` + `LICENSE` intact.
