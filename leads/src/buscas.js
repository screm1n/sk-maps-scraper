/**
 * One job API for the three sources. Mapa and Painel keep calling /api/v1/jobs exactly as
 * the local scraper defines it; this module answers it:
 *
 *   local  -> forwarded to gosom/google-maps-scraper (free, runs on this machine)
 *   apify  -> run on Apify, tracked here, result stored as the scraper's CSV
 *   places -> Google Places Text Search, same
 *
 * Listing merges the local scraper's jobs with the external ones, so every screen sees all.
 */
import { randomUUID } from "node:crypto";
import { abrirBanco } from "./db.js";
import { fonteAtual, tokenApify, chavePlaces, contarConsultaPlaces } from "./config.js";
import { paraCsv, lugaresPorProfundidade } from "./fontes/formato.js";
import { iniciarApify, estadoApify, itensApify, abortarApify, estimarApify } from "./fontes/apify.js";
import { buscarPlaces } from "./fontes/places.js";

// Read when used, not at import: tests and the server can set the environment first.
const baseLocal = () => (process.env.GMAPS_URL || "http://localhost:8080").replace(/\/$/, "");
export const GMAPS_URL = baseLocal();
const db = () => abrirBanco();

export class ErroBusca extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

// ───────────────────────── local scraper ─────────────────────────

async function local(caminho, init = {}) {
  try {
    return await fetch(`${baseLocal()}${caminho}`, { ...init, signal: AbortSignal.timeout(init.timeout || 15000) });
  } catch {
    return null;
  }
}

export async function scraperLocalNoAr() {
  const r = await local("/api/v1/jobs", { timeout: 3000 });
  return !!r?.ok;
}

// ───────────────────────── external jobs as scraper jobs ─────────────────────────

function comoJob(b) {
  const pedido = JSON.parse(b.pedido);
  return {
    ID: b.id,
    // The source goes in the name, so every list (Mapa, Painel, Leads) shows where it came from.
    Name: `${b.nome} · ${b.fonte === "apify" ? "Apify" : "Google Places"}`,
    Date: b.criado_em.replace(" ", "T") + "Z",
    Status: b.status,
    Data: { ...pedido, fonte: b.fonte, lugares: b.lugares, custo_usd: b.custo_usd, erro: b.erro },
  };
}

const externa = (id) => db().prepare("SELECT * FROM buscas_externas WHERE id = ?").get(id);

/** Local jobs (if the scraper is up) + external ones, newest first. */
export async function listarJobs() {
  const r = await local("/api/v1/jobs");
  let locais = [];
  if (r?.ok) {
    const j = await r.json().catch(() => []);
    locais = (Array.isArray(j) ? j : []).map((x) => ({ ...x, Data: { ...(x.Data || x.data || {}), fonte: "local" } }));
  }
  const externas = db().prepare("SELECT * FROM buscas_externas ORDER BY criado_em DESC").all().map(comoJob);
  return [...externas, ...locais].sort((a, b) => String(b.Date || "").localeCompare(String(a.Date || "")));
}

export async function obterJob(id) {
  const b = externa(id);
  if (b) return comoJob(b);
  const r = await local(`/api/v1/jobs/${encodeURIComponent(id)}`);
  if (!r?.ok) throw new ErroBusca(r ? r.status : 502, r ? "busca não encontrada" : `scraper local fora do ar em ${baseLocal()}`);
  return r.json();
}

/** CSV of a finished job, whatever the source. */
export async function csvDoJob(id) {
  const b = externa(id);
  if (b) {
    if (b.status !== "ok") throw new ErroBusca(409, "essa busca ainda não terminou");
    return b.csv || paraCsv([]);
  }
  const r = await local(`/api/v1/jobs/${encodeURIComponent(id)}/download`, { timeout: 60000 });
  if (!r) throw new ErroBusca(502, `scraper local fora do ar em ${baseLocal()}`);
  if (!r.ok) throw new ErroBusca(r.status, `o scraper local respondeu ${r.status}`);
  return r.text();
}

export async function apagarJob(id) {
  const b = externa(id);
  if (b) {
    if (b.fonte === "apify" && b.execucao && ["pending", "working"].includes(b.status) && tokenApify()) await abortarApify(tokenApify(), b.execucao);
    db().prepare("DELETE FROM buscas_externas WHERE id = ?").run(id);
    return { ok: true };
  }
  const r = await local(`/api/v1/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r) throw new ErroBusca(502, `scraper local fora do ar em ${baseLocal()}`);
  return { ok: r.ok };
}

/**
 * Creates a search on the current source. The body is the one the local scraper expects
 * (keywords, lang, depth, lat, lon, radius, max_time...), so the forms don't change.
 * @returns {Promise<{status: number, corpo: unknown}>}
 */
export async function criarJob(pedido) {
  const fonte = fonteAtual();
  if (!Array.isArray(pedido.keywords) || !pedido.keywords.length) throw new ErroBusca(422, "keywords é obrigatório");

  if (fonte === "local") {
    const r = await local("/api/v1/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pedido) });
    if (!r) throw new ErroBusca(502, "O scraper local está fora do ar. Rode docker compose up -d, ou troque a fonte pra Apify ou Google Places.");
    return { status: r.status, corpo: await r.json().catch(() => ({})) };
  }

  if (fonte === "apify" && !tokenApify()) throw new ErroBusca(409, "Configure o token do Apify antes de buscar por ele.");
  if (fonte === "places" && !chavePlaces()) throw new ErroBusca(409, "Configure a chave do Google Places antes de buscar por ela.");

  const id = `${fonte}-${randomUUID()}`;
  const nome = pedido.name || pedido.keywords.join(", ");
  db().prepare("INSERT INTO buscas_externas (id, nome, fonte, status, pedido) VALUES (?, ?, ?, 'pending', ?)")
    .run(id, nome, fonte, JSON.stringify(pedido));
  executar(id).catch(() => {}); // runs in the background; status is polled like a local job
  return { status: 201, corpo: { id } };
}

/** Cost estimate for the form, before spending. */
export function estimar(fonte, termos, depth) {
  const porTermo = lugaresPorProfundidade(depth);
  if (fonte === "apify") return { lugaresMax: termos * porTermo, custoUsd: estimarApify(termos, porTermo) };
  if (fonte === "places") return { lugaresMax: termos * Math.min(60, porTermo), consultas: termos * Math.min(3, Math.ceil(porTermo / 20)) };
  return { lugaresMax: termos * porTermo, custoUsd: 0 };
}

// ───────────────────────── runner ─────────────────────────

const esperaMs = () => Number(process.env.APIFY_POLL_MS || 5000);
const TETO_MS = 30 * 60_000;

function atualizar(id, campos) {
  const chaves = Object.keys(campos);
  db().prepare(`UPDATE buscas_externas SET ${chaves.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...chaves.map((k) => campos[k]), id);
}

async function executar(id) {
  const b = externa(id);
  const pedido = JSON.parse(b.pedido);
  const porTermo = lugaresPorProfundidade(pedido.depth);
  try {
    atualizar(id, { status: "working" });
    let linhas, custo = null;
    if (b.fonte === "apify") {
      const token = tokenApify();
      let execucao = b.execucao; // resuming after a restart: the run already exists and is paid
      if (!execucao) {
        ({ execucao } = await iniciarApify(token, pedido, porTermo));
        atualizar(id, { execucao });
      }
      const inicio = Date.now();
      let estado;
      do {
        await new Promise((ok) => setTimeout(ok, esperaMs()));
        if (!externa(id)) return abortarApify(token, execucao); // deleted meanwhile
        estado = await estadoApify(token, execucao);
        if (Date.now() - inicio > TETO_MS) { await abortarApify(token, execucao); throw new Error("passou de 30 minutos, cancelei pra não gastar mais"); }
      } while (["READY", "RUNNING"].includes(estado.status));
      if (estado.status !== "SUCCEEDED") throw new Error(`a execução no Apify terminou como ${estado.status}`);
      linhas = await itensApify(token, estado.dataset);
      custo = estado.custo;
    } else {
      linhas = await buscarPlaces(chavePlaces(), pedido, Math.min(3, Math.ceil(porTermo / 20)), (n) => contarConsultaPlaces(n));
    }
    if (!externa(id)) return;
    atualizar(id, { status: "ok", csv: paraCsv(linhas), lugares: linhas.length, custo_usd: custo, terminado_em: new Date().toISOString() });
  } catch (e) {
    if (externa(id)) atualizar(id, { status: "failed", erro: e.message, terminado_em: new Date().toISOString() });
  }
}

/**
 * After a restart: an Apify run that already started is followed again (it is paid for);
 * anything else left halfway is marked failed.
 */
export function recuperarPendentes() {
  const pendentes = db().prepare("SELECT id, fonte, execucao FROM buscas_externas WHERE status IN ('pending','working')").all();
  for (const b of pendentes) {
    if (b.fonte === "apify" && b.execucao && tokenApify()) executar(b.id).catch(() => {});
    else atualizar(b.id, { status: "failed", erro: "o servidor reiniciou no meio da busca", terminado_em: new Date().toISOString() });
  }
}
