# Google Maps Scraper Kit

<p align="center">
  <img src="assets/banner.svg" alt="Google Maps Scraper Kit — run a free Google Maps scraper locally, let Claude drive it on autopilot" width="100%">
</p>

A **plug-and-play kit** that runs a free, open-source Google Maps scraper **on your own computer**
and lets **Claude** drive it on autopilot — give Claude a city + a business type, get back a clean
list of businesses (name, address, phone, website, rating, reviews, lat/lng, emails).

Built as a thin wrapper around [**`gosom/google-maps-scraper`**](https://github.com/gosom/google-maps-scraper)
by **Georgios Komninos** (MIT). See [CREDITS.md](CREDITS.md). This kit adds: a one-command Docker setup,
ready-to-run scripts, and a **Claude skill** so Claude knows exactly how to use the API the right way.

> ⚠️ **Before you scrape — over-use can get your IP temporarily blocked.**
> This runs a real scraper against Google Maps. Light use is fine, but big jobs back-to-back, very high
> `depth`, many keywords, or scheduled runs **without proxies** can make Google **temporarily rate-limit or
> block your IP** (usually clears in minutes–hours; jobs return empty/failed meanwhile). It does **not** ban
> your Google account. Stay safe: **one job at a time, start at `depth 5`, add proxies for large/repeated
> runs.** Scraping Maps is against Google's ToS — use responsibly and follow data law (GDPR/CCPA) for any
> contact data. Full guidance: [Rate limits, bans & responsible use](#️-rate-limits-bans--responsible-use).

---

## What you get

- 🐳 **One-command local setup** — `docker compose up -d` runs the scraper at `http://localhost:8080`.
- 🤖 **A Claude skill** — open this folder in Claude Code and just say *"scrape coffee shops in Austin"*. Claude does create → poll → download → clean results, following best practices automatically.
- 🛠️ **Standalone scripts** — `scripts/scrape.sh` (bash) and `scripts/scrape.py` (Python, no dependencies) if you'd rather not use Claude.
- 🎯 **Leads mode** — import any scrape into a local lead database: A/B/C layers (who has no website), a 0–100 lead score, mobile vs landline in any country, a WhatsApp queue with ready messages, reply tracking, metrics and one-click proposals. See [Leads mode](#-leads-mode-from-a-list-to-clients).
- 🔒 **Safe by default** — the scraper binds to `127.0.0.1` only, secrets are git-ignored, and the skill enforces rate-limit / legal / data-handling guardrails.

## What it scrapes (and what it doesn't)

- ✅ **Google Maps business listings** → a clean **lead list** by default: `name, phone, email, website, category, address, rating, review count`. The scraper captures ~34 raw fields, but the kit **strips the noise** (geo coordinates, IDs, hours, images, review blobs) so you only get data you can actually use for outreach. Want everything? `scrape.py --full`.
- ➕ **Optional socials** (`--socials`): also pulls each business's **Instagram / Facebook / LinkedIn** by scanning its website. **Token cost: 0** — it runs in code (HTTP + regex), no AI. It only adds ~40–50 tokens *per business* if you later load the rows into an AI chat (≈+2k for 50 leads; nothing if you keep the file on disk). It's slower (one fetch per site) and coverage is partial (only businesses that link socials on their site).
- ❌ **Not** a social-media scraper. It cannot touch Instagram / TikTok / YouTube.

## Why use this instead of asking an AI to "just scrape Google Maps"

Tested head-to-head: a chat AI fetching `maps.google.com` directly hits a **consent wall** and
**JavaScript-rendered** content, so it returns **~0 structured results**. This kit reliably returns
**dozens–hundreds of clean rows per query**. For Google Maps, it's the difference between *can't* and *can*.

---

## Quick start (3 steps)

```bash
# 1. Start the scraper (needs Docker Desktop)
docker compose up -d

# 2. Check it's alive — should print a JSON list (probably empty [])
curl http://localhost:8080/api/v1/jobs

# 3a. Scrape with the script…
./scripts/scrape.sh "coffee shops in Austin TX" 30.2672 -97.7431 5

# 3b. …or open this folder in Claude Code and say:
#     "Scrape gyms in Miami and give me phones + websites."
```

Full instructions: **[SETUP.md](SETUP.md)**. How Claude uses it: **[.claude/skills/google-maps-scraper/SKILL.md](.claude/skills/google-maps-scraper/SKILL.md)**.

---

## Invoking it in Claude Code

### Slash commands
| Command | What it does |
|---|---|
| `/scrape <business> in <city, ST> [depth]` | Run a scrape and get a clean table |
| `/scrape-batch <keywords-file> [--city "City, ST"]` | Scrape many queries in one job |
| `/scrape-setup` | Start the local scraper + health check |
| `/scrape-jobs [list \| delete <id>]` | List or delete jobs |

Example: `/scrape dentists in Denver CO 10`

### Or just talk to it — the skill auto-triggers on phrases like:
- "scrape coffee shops in Austin"
- "find all gyms in Miami with phone numbers"
- "build me a lead list of dentists in Denver, CO"
- "pull Google Maps listings for plumbers in Phoenix"

It intentionally **does not** trigger for social media (Instagram/TikTok) — that's not what it does.

---

## 🎯 Leads mode: from a list to clients

Open **http://localhost:8080/leads**. Every finished scrape can be imported into a local lead
database that does the qualifying for you:

| | What it does |
|---|---|
| **A / B / C layers** | Reads each business's website field. **A** = nothing online. **B** = only a social profile, link-in-bio, WhatsApp link or a booking/directory page (Booksy, Square, Vagaro, Fresha, Doctoralia...) instead of a site. **C** = own website, leaves the queue. |
| **Lead score 0–100** | Layer, mobile phone, review count, rating, e-mail. The lead panel shows where every point came from. |
| **Mobile vs landline, any country** | Phones are read with each country's numbering plan ([libphonenumber-js](https://github.com/catamphetamine/libphonenumber-js)), plus Brazil's own rules. Landlines stay out of the WhatsApp queue; US/Canada numbers (where the plan can't tell) come in as "may have WhatsApp". |
| **WhatsApp queue** | Best uncontacted leads with the message already written **in the lead's language** (Portuguese, Spanish, English). Opens the chat with the text typed; you press send. Daily cap meter (15) and an out-of-hours warning. |
| **Messages** | Templates with `{{nome}}`, `{{nota}}`, `{{qtd_avaliacoes}}`... Openers alternate so you can compare them. Live check blocks em dashes and offers with no way out. SEO junk is cut from names ("Studio X \| Nails \| Lashes" becomes "Studio X"). |
| **Sent log, replies, follow-up** | Mark what you sent; paste replies (auto-replies are recognized and don't count) or read them in bulk from the WhatsApp Web chat list; 48h follow-up list. |
| **Metrics** | Funnel (imported → no site → WhatsApp → contacted → replied → client) and reply rate per message. |
| **Proposal** | One click from a lead: a 3-page A4 proposal built from its real rating and reviews and how many same-category businesses in the city have a site. Save as PDF from the browser. |
| **Block list** | "Asked to stop" blocks by phone and by place, so it never comes back, even in a new scrape. |

Re-importing a scrape only refreshes Google's data; your statuses, notes and history are kept.
The database lives in the `leads_data` Docker volume (or `leads/data/leads.db` without Docker).

> **Use it responsibly.** Cold messages are personal-data processing (LGPD/GDPR). Keep the volume
> low (10–15 first messages a day, minutes apart), always offer a way out, and honor every "stop".
> In the US, cold SMS is illegal (TCPA).

## ⚠️ Rate limits, bans & responsible use

The upstream project's guidance (and ours): *"Please use this scraper responsibly and in accordance with
applicable laws and regulations. Unauthorized scraping may violate terms of service."* There's **no
published ban threshold**, so be conservative.

**What "over-use" looks like** and the risk:
- Big jobs back-to-back, very high `depth`, many keywords at once, or scheduled runs **without proxies**.
- Risk: Google **temporarily rate-limits/blocks your IP** (minutes–hours, then clears). Your Google
  **account is not banned**. While blocked, jobs come back `failed` or with empty/short results.

**Block signals to watch:** jobs returning `failed`, suddenly empty results, or far fewer rows than an
identical earlier run. If you see these, **slow down** — pause, lower `depth`, or add proxies.

**Stay safe:**
- One job at a time; start at `depth 5` and raise only as needed.
- Turn on `email` extraction only when you need emails (it's much slower).
- Treat results as **leads to verify**, not a redistributable dataset. Don't resell raw Google data.
- Scraped phones/emails are **personal data** → follow GDPR/CCPA/CAN-SPAM if you store or contact them.

**When to add proxies** (*"For larger scraping jobs, proxies help avoid rate limiting"*): large jobs, many
keywords, repeated/scheduled runs, or after you hit block signals. Set the `proxies` array in the job body:
```json
"proxies": ["socks5://user:pass@host:port", "http://host2:port2"]
```
Types: `socks5`, `socks5h`, `http`, `https` (auth optional). The scraper rotates them automatically.
For reference, upstream measures ~120 places/min at `-c 8 -depth 1`.

> Claude's rule here is **warn, don't block**: if you ask for a large scrape, it'll flag the risk and
> suggest proxies, then run it anyway. It only refuses clearly abusive use.

---

## What's inside

```
google-maps-scraper-kit/
├── README.md            ← you are here
├── SETUP.md             ← detailed, copy-paste setup (start here)
├── CLAUDE.md            ← auto-loaded instructions for Claude Code
├── CREDITS.md           ← attribution to the upstream author (gosom)
├── LICENSE              ← MIT (this kit)
├── docker-compose.yml   ← runs the scraper, the leads server and nginx on :8080
├── .env.example         ← config template
├── .gitignore
├── frontend/            ← Mapa, Painel and Leads screens (+ proposta.html)
├── leads/               ← leads server: Node 22, built-in SQLite, one dependency
│   ├── server.js        ← API at /leads-api (+ serves the front-end when run alone)
│   ├── src/dominio/     ← the rules: layers, score, phones, messages, auto-replies
│   └── test/            ← `npm test`, plus a fake scraper to try it without Docker
├── scripts/
│   ├── scrape.sh        ← one-shot bash scraper (single keyword)
│   └── scrape.py        ← Python scraper: single, batch, + auto-geocoding (stdlib only)
├── examples/
│   ├── queries.example.json   ← reference job body + coordinate cheatsheet
│   └── queries.example.txt    ← batch keyword list (one per line)
└── .claude/
    ├── settings.json    ← pre-approves local commands so Claude runs on autopilot
    ├── commands/        ← /scrape, /scrape-batch, /scrape-setup, /scrape-jobs
    └── skills/
        └── google-maps-scraper/
            └── SKILL.md ← THE skill that teaches Claude to use the API well
```

## Credits & license

This kit orchestrates **[google-maps-scraper](https://github.com/gosom/google-maps-scraper)** by
**Georgios Komninos**, used under the MIT License. The kit's own code is MIT licensed too. Full
attribution in **[CREDITS.md](CREDITS.md)**. Please respect Google's Terms of Service and applicable
data-protection law (GDPR/CCPA) when using scraped data — see the Safety section in the skill.
