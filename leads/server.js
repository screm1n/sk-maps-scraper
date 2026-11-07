/**
 * Leads server for the Google Maps Scraper Kit.
 *
 *   /leads-api/*   JSON API (leads, import, queue, templates, replies, metrics, proposal)
 *
 * In Docker, nginx serves the front-end and forwards /leads-api here. Run on its own
 * (`npm start`), it also serves the front-end and forwards /api/v1 to the scraper, so the
 * whole kit works from http://localhost:3000 without nginx.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { abrirBanco } from "./src/db.js";
import { listarLeads, obterLead, atualizarLead, bloquearLead, cidades, resumo, levantamento } from "./src/leads.js";
import { GMAPS_URL, importarBusca, listarBuscas } from "./src/importar.js";
import {
  listarTemplates, salvarTemplate, apagarTemplate, obterTemplate, montarMensagem, templateParaLead,
  montarFila, filaFollowup, registrarEnvio, registrarResposta, registrarRespostasEmLote, metricas,
  TETO_DIARIO, MIN_AVALIACOES_COPY,
} from "./src/abordagem.js";
import { validarTemplate, VARIAVEIS } from "./src/dominio/mensagem.js";

const aqui = dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.env.PORT || 3000);
const FRONTEND = resolve(process.env.FRONTEND_DIR || join(aqui, "..", "frontend"));

// ───────────────────────── helpers ─────────────────────────

class ErroHttp extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

function enviarJson(res, status, corpo) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(corpo));
}

async function lerCorpo(req) {
  const partes = [];
  let tamanho = 0;
  for await (const p of req) {
    tamanho += p.length;
    if (tamanho > 5_000_000) throw new ErroHttp(413, "corpo grande demais");
    partes.push(p);
  }
  const texto = Buffer.concat(partes).toString("utf8");
  if (!texto) return {};
  try { return JSON.parse(texto); } catch { throw new ErroHttp(400, "JSON inválido"); }
}

const lista = (v) => (v ? String(v).split(",").map((s) => s.trim()).filter(Boolean) : undefined);
const numero = (v, padrao) => (v == null || v === "" ? padrao : Number(v));
const id = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErroHttp(400, "id inválido");
  return n;
};

// ───────────────────────── routes ─────────────────────────

/** [method, pattern, handler(params, query, body)] */
const ROTAS = [
  ["GET", "/saude", async () => {
    let scraper = false;
    try { scraper = (await fetch(`${GMAPS_URL}/api/v1/jobs`, { signal: AbortSignal.timeout(3000) })).ok; } catch { /* down */ }
    return { ok: true, scraper, tetoDiario: TETO_DIARIO, minAvaliacoesCopy: MIN_AVALIACOES_COPY };
  }],
  ["GET", "/resumo", () => resumo()],
  ["GET", "/cidades", () => cidades()],

  ["GET", "/buscas", async () => {
    try { return await listarBuscas(); }
    catch (e) { throw new ErroHttp(502, `Não consegui falar com o scraper em ${GMAPS_URL}. Ele está rodando? (${e.message})`); }
  }],
  ["POST", "/buscas/:id/importar", async (p, _q, b) => {
    try { return await importarBusca(p.id, { pais: b.pais || null, nome: b.nome || null }); }
    catch (e) { throw new ErroHttp(502, e.message); }
  }],

  ["GET", "/leads", (_p, q) => listarLeads({
    camadas: lista(q.camadas), status: lista(q.status), cidade: q.cidade || undefined, busca: q.busca || undefined,
    soWhatsApp: q.soWhatsApp === "1", minScore: numero(q.minScore, 0), ordem: q.ordem || "score", limite: numero(q.limite, 300),
  })],
  ["GET", "/leads/:id", (p) => obterLead(id(p.id)) ?? (() => { throw new ErroHttp(404, "lead não encontrado"); })()],
  ["PATCH", "/leads/:id", (p, _q, b) => atualizarLead(id(p.id), { status: b.status, notas: b.notas })],
  ["POST", "/leads/:id/bloquear", (p, _q, b) => ({ ok: bloquearLead(id(p.id), b.motivo) })],

  ["POST", "/leads/:id/mensagem", (p, _q, b) => {
    const lead = obterLead(id(p.id));
    if (!lead) throw new ErroHttp(404, "lead não encontrado");
    const t = b.templateId ? obterTemplate(Number(b.templateId)) : templateParaLead(lead, b.tipo || "abertura");
    if (!t) throw new ErroHttp(404, "nenhum template pra esse lead");
    return montarMensagem(lead, t);
  }],
  ["POST", "/leads/:id/enviado", (p, _q, b) => {
    if (!b.corpo) throw new ErroHttp(400, "corpo obrigatório");
    return registrarEnvio(id(p.id), { templateId: b.templateId ?? null, corpo: b.corpo, tipo: b.tipo || "abertura" });
  }],
  ["POST", "/leads/:id/resposta", (p, _q, b) => {
    if (!b.texto) throw new ErroHttp(400, "texto obrigatório");
    return registrarResposta(id(p.id), b.texto);
  }],
  ["GET", "/leads/:id/proposta", (p) => {
    const lead = obterLead(id(p.id));
    if (!lead) throw new ErroHttp(404, "lead não encontrado");
    return { lead, levantamento: levantamento(lead.categoria, lead.cidade) };
  }],

  ["GET", "/fila", (_p, q) => montarFila({
    limite: numero(q.limite, 12), corteAvaliacoes: numero(q.corte, 15), minScore: numero(q.minScore, 0), cidade: q.cidade,
  })],
  ["GET", "/fila/followup", (_p, q) => filaFollowup({ dias: numero(q.dias, 2) })],
  ["POST", "/respostas/lote", (_p, _q, b) => registrarRespostasEmLote(b.conversas, { gravar: !!b.gravar })],

  ["GET", "/templates", () => ({ templates: listarTemplates(), variaveis: VARIAVEIS })],
  ["POST", "/templates", (_p, _q, b) => {
    if (!b.nome || !b.corpo) throw new ErroHttp(400, "nome e corpo obrigatórios");
    const r = salvarTemplate(b);
    if (!r.ok) throw new ErroHttp(400, r.erros.join(" "));
    return r;
  }],
  ["POST", "/templates/validar", (_p, _q, b) => validarTemplate(String(b.corpo || ""))],
  ["DELETE", "/templates/:id", (p) => { apagarTemplate(id(p.id)); return { ok: true }; }],

  ["GET", "/metricas", () => metricas()],
].map(([metodo, padrao, fn]) => {
  const chaves = [];
  const re = new RegExp("^" + padrao.replace(/:([a-z]+)/g, (_m, k) => { chaves.push(k); return "([^/]+)"; }) + "/?$");
  return { metodo, re, chaves, fn };
});

async function api(req, res, caminho, query) {
  for (const r of ROTAS) {
    if (r.metodo !== req.method) continue;
    const m = caminho.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.chaves.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const body = ["POST", "PATCH", "PUT"].includes(req.method) ? await lerCorpo(req) : {};
    return enviarJson(res, 200, await r.fn(params, query, body));
  }
  throw new ErroHttp(404, "rota não encontrada");
}

// ───────────────────────── static + scraper passthrough (local mode) ─────────────────────────

const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon",
};
const PAGINAS = { "/": "index.html", "/painel": "painel.html", "/leads": "leads.html", "/proposta": "proposta.html" };

async function estatico(res, caminho) {
  let arquivo = PAGINAS[caminho];
  if (!arquivo && caminho.startsWith("/app/")) arquivo = caminho.slice(5);
  if (!arquivo) return false;
  const completo = normalize(join(FRONTEND, arquivo));
  if (!completo.startsWith(FRONTEND)) return false; // path traversal
  try {
    if (!(await stat(completo)).isFile()) return false;
    res.writeHead(200, { "Content-Type": TIPOS[extname(completo)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(await readFile(completo));
    return true;
  } catch {
    return false;
  }
}

async function repassarScraper(req, res, url) {
  const corpo = ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(await Array.fromAsync(req));
  const alvo = `${GMAPS_URL}${url.pathname}${url.search}`;
  try {
    const r = await fetch(alvo, { method: req.method, body: corpo, headers: { "content-type": req.headers["content-type"] || "" } });
    const cab = {};
    r.headers.forEach((v, k) => { if (!["content-encoding", "transfer-encoding", "connection"].includes(k)) cab[k] = v; });
    res.writeHead(r.status, cab);
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch {
    enviarJson(res, 502, { erro: `scraper fora do ar em ${GMAPS_URL}` });
  }
}

// ───────────────────────── server ─────────────────────────

abrirBanco();

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/leads-api/") || url.pathname === "/leads-api") {
      return await api(req, res, url.pathname.slice("/leads-api".length) || "/", Object.fromEntries(url.searchParams));
    }
    if (req.method === "GET" && (await estatico(res, url.pathname))) return;
    return await repassarScraper(req, res, url);
  } catch (e) {
    const status = e instanceof ErroHttp ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) enviarJson(res, status, { erro: e.message || "erro" });
  }
});

servidor.listen(PORTA, () => {
  console.log(`\n  Leads no ar em http://localhost:${PORTA}/leads`);
  console.log(`  scraper: ${GMAPS_URL}`);
  console.log(`  banco: ${resolve(process.env.LEADS_DB || "./data/leads.db")}\n`);
});
