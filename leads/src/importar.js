/**
 * Pulls a finished scraper job (gosom/google-maps-scraper CSV) into the lead database.
 */
import { abrirBanco } from "./db.js";
import { gravarLugar } from "./leads.js";

import { listarJobs, csvDoJob } from "./buscas.js";
export { GMAPS_URL } from "./buscas.js";

/** RFC 4180 CSV, same rules as the kit front-end (quoted fields, "" escapes, CRLF). */
export function lerCSV(texto) {
  const linhas = [];
  let linha = [], campo = "", aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ",") { linha.push(campo); campo = ""; }
    else if (c === "\n") { linha.push(campo); linhas.push(linha); linha = []; campo = ""; }
    else if (c !== "\r") campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  const [cab, ...corpo] = linhas;
  if (!cab) return [];
  cab[0] = cab[0].replace(/^﻿/, "");
  return corpo.filter((r) => r.length > 1).map((r) => Object.fromEntries(cab.map((h, i) => [h, r[i] ?? ""])));
}

function json(texto) {
  if (!texto || typeof texto !== "string") return null;
  try { return JSON.parse(texto); } catch { return null; }
}

/** Country name ("Portugal", "United States") or code to ISO-2. */
let _nomes = null;
// Retired codes Intl still names; without this "United Kingdom" would map to "UK" instead of "GB".
const OBSOLETOS = new Set(["DD", "DY", "HV", "FX", "YD", "UK", "BU", "ZR", "TP", "NT", "CS", "YU", "SU", "AN", "VD", "RH", "QU", "NH"]);
export function codigoDoPais(valor) {
  const v = String(valor || "").trim();
  if (!v) return null;
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  if (!_nomes) {
    _nomes = new Map();
    for (const lingua of ["en", "pt", "es"]) {
      const dn = new Intl.DisplayNames([lingua], { type: "region" });
      for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
        const cod = String.fromCharCode(a, b);
        if (OBSOLETOS.has(cod)) continue;
        try { const n = dn.of(cod); if (n && n !== cod) _nomes.set(n.toLowerCase(), cod); } catch { /* not a region */ }
      }
    }
    _nomes.set("usa", "US").set("eua", "US").set("brasil", "BR").set("uk", "GB");
  }
  return _nomes.get(v.toLowerCase()) ?? null;
}

/**
 * One CSV row to the internal place shape. Returns null for rows with no name or permanently closed.
 * @param {Record<string,string>} r
 * @param {{pais?: string|null, buscaId?: string}} ctx
 */
export function mapearLinha(r, ctx = {}) {
  const nome = (r.title || "").trim();
  if (!nome) return null;
  if (/permanent/i.test(r.status || "")) return null;

  const end = json(r.complete_address) || {};
  const pais = codigoDoPais(end.country) || (ctx.pais ? ctx.pais.toUpperCase() : null);
  const chave = r.place_id || r.data_id || r.cid || r.link || `${nome}|${r.address || ""}`;
  const nota = parseFloat(String(r.review_rating || "").replace(",", "."));
  const qtd = parseInt(String(r.review_count || "").replace(/\D/g, ""), 10);
  const emails = String(r.emails || "").split(/[\s,;]+/).filter((e) => e.includes("@")).join(", ");

  return {
    chave,
    nome,
    categoria: r.category || null,
    endereco: r.address || null,
    bairro: end.borough || null,
    cidade: end.city || null,
    estado: end.state || null,
    pais,
    lat: parseFloat(r.latitude) || null,
    lng: parseFloat(r.longitude) || null,
    telefone: r.phone || null,
    website: r.website || null,
    emails: emails || null,
    nota: Number.isFinite(nota) ? nota : null,
    qtdAvaliacoes: Number.isFinite(qtd) ? qtd : 0,
    linkMaps: r.link || null,
    // Only Apify knows it: nobody claimed the Google listing.
    naoReivindicado: r.claim_this_business === "true",
    buscaId: ctx.buscaId || null,
  };
}

/** Imports already-parsed rows. Used by the HTTP import and by the tests. */
export function importarLinhas(linhas, ctx = {}) {
  const conta = { lidos: linhas.length, novos: 0, atualizados: 0, bloqueados: 0, ignorados: 0, camadas: { A: 0, B: 0, C: 0 } };
  const db = abrirBanco();
  db.exec("BEGIN");
  try {
    for (const r of linhas) {
      const lugar = mapearLinha(r, ctx);
      if (!lugar) { conta.ignorados++; continue; }
      const res = gravarLugar(lugar);
      if (res === "novo") conta.novos++;
      else if (res === "atualizado") conta.atualizados++;
      else conta.bloqueados++;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  if (ctx.buscaId) {
    db.prepare(`INSERT INTO importacoes (busca_id, nome, pais, lidos, novos) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(busca_id) DO UPDATE SET lidos = excluded.lidos, novos = importacoes.novos + excluded.novos,
      pais = excluded.pais, importado_em = datetime('now')`)
      .run(ctx.buscaId, ctx.nome ?? null, ctx.pais ?? null, conta.lidos, conta.novos);
  }
  const porCamada = db.prepare(
    `SELECT camada, COUNT(*) n FROM leads WHERE busca_id = ? GROUP BY camada`
  ).all(ctx.buscaId ?? "");
  for (const x of porCamada) conta.camadas[x.camada] = x.n;
  return conta;
}

/** Jobs from every source (local scraper, Apify, Google Places), each flagged if already imported. */
export async function listarBuscas() {
  const jobs = await listarJobs();
  const feitas = new Map(abrirBanco().prepare("SELECT busca_id, lidos, novos, pais, importado_em FROM importacoes").all().map((x) => [x.busca_id, x]));
  return jobs.map((j) => {
    const d = j.Data || j.data || {};
    const id = j.ID || j.id;
    return {
      id,
      nome: j.Name || j.name || "",
      status: String(j.Status || j.status || "").toLowerCase(),
      criadoEm: j.Date || j.date || null,
      palavras: d.keywords || [],
      fonte: d.fonte || "local",
      importacao: feitas.get(id) || null,
    };
  });
}

export async function importarBusca(buscaId, { pais, nome } = {}) {
  const linhas = lerCSV(await csvDoJob(buscaId));
  return importarLinhas(linhas, { buscaId, pais: pais || null, nome });
}
