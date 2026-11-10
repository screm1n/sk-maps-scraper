/** WhatsApp queue, templates, sent log, replies and metrics. */
import { abrirBanco } from "./db.js";
import { listarLeads, obterLead, paraLead } from "./leads.js";
import { idiomaDoPais, renderizar, validarTemplate } from "./dominio/mensagem.js";
import { linkWhatsApp, lerTelefone, podeWhatsApp } from "./dominio/telefone.js";
import { classificar } from "./dominio/classificar.js";
import { mapearLinha } from "./importar.js";
import { ehAutomatica } from "./dominio/respostas.js";

const db = () => abrirBanco();

/** Below this, the opener that does not quote rating or reviews ("nota 5,0 com 2 avaliações" burns the contact). */
export const MIN_AVALIACOES_COPY = 10;
/** Safe daily cap of cold first messages per WhatsApp number (more than this got a number restricted). */
export const TETO_DIARIO = 15;

// ───────────────────────── templates ─────────────────────────

export const listarTemplates = () => db().prepare("SELECT * FROM templates ORDER BY idioma, tipo, id").all();
export const obterTemplate = (id) => db().prepare("SELECT * FROM templates WHERE id = ?").get(id);

export function salvarTemplate({ id, nome, corpo, idioma = "pt", tipo = "abertura" }) {
  const v = validarTemplate(corpo);
  if (!v.ok) return { ok: false, erros: v.erros };
  if (id) {
    db().prepare("UPDATE templates SET nome = ?, corpo = ?, idioma = ?, tipo = ? WHERE id = ?").run(nome, corpo, idioma, tipo, id);
    return { ok: true, id };
  }
  const r = db().prepare("INSERT INTO templates (nome, corpo, idioma, tipo) VALUES (?, ?, ?, ?)").run(nome, corpo, idioma, tipo);
  return { ok: true, id: Number(r.lastInsertRowid) };
}

export const apagarTemplate = (id) => db().prepare("DELETE FROM templates WHERE id = ?").run(id);

/**
 * Template for a lead: in the lead's language, the "few reviews" version under the cut,
 * and the openers of that language alternated by lead id so the same text does not go out
 * fifteen times in a row (and so the metrics can compare them).
 */
export function templateParaLead(lead, tipo = "abertura") {
  const idioma = idiomaDoPais(lead.pais);
  const pegar = (t, lang) => db().prepare("SELECT * FROM templates WHERE tipo = ? AND idioma = ? ORDER BY id").all(t, lang);
  let t = tipo;
  if (tipo === "abertura" && lead.camada === "C") t = "refazer"; // has a site: ask if it brings clients
  else if (tipo === "abertura" && ((lead.qtdAvaliacoes || 0) < MIN_AVALIACOES_COPY || lead.nota == null)) t = "poucas";
  let lista = pegar(t, idioma);
  if (!lista.length) lista = pegar(tipo, idioma);
  if (!lista.length) lista = pegar(tipo, "pt");
  return lista.length ? lista[lead.id % lista.length] : null;
}

export function montarMensagem(lead, template) {
  const idioma = idiomaDoPais(lead.pais);
  const { corpo, faltando } = renderizar(template.corpo, lead, idioma);
  return {
    templateId: template.id,
    template: template.nome,
    corpo,
    faltando,
    link: lead.whatsapp ? linkWhatsApp(lead.telefoneE164, corpo) : null,
  };
}

/**
 * Ready message for a business straight from a search result (Painel/Mapa), imported or not.
 * An imported lead keeps its own data and template rotation; otherwise the row is read the
 * same way the import reads it.
 * @param {Record<string,string>} linha row of the scraper CSV
 */
export function mensagemParaLinha(linha) {
  const l = mapearLinha(linha);
  if (!l) return null;
  const salvo = db().prepare("SELECT id FROM leads WHERE chave = ?").get(l.chave);
  let lead;
  if (salvo) lead = obterLead(salvo.id);
  else {
    const tel = lerTelefone(l.telefone, l.pais);
    let id = 0;
    for (const c of String(l.chave)) id = (id * 31 + c.charCodeAt(0)) >>> 0;
    lead = { ...l, id, camada: classificar(l.website).camada, telefoneE164: tel?.e164 ?? null, tipoTelefone: tel?.tipo ?? null };
    lead.whatsapp = !!tel && podeWhatsApp(tel.tipo);
  }
  const t = templateParaLead(lead);
  if (!t) return { leadId: salvo?.id ?? null, whatsapp: lead.whatsapp, tipoTelefone: lead.tipoTelefone, link: null, corpo: null };
  return { leadId: salvo?.id ?? null, whatsapp: lead.whatsapp, tipoTelefone: lead.tipoTelefone, ...montarMensagem(lead, t) };
}

// ───────────────────────── queue ─────────────────────────

export function enviadasHoje() {
  return db().prepare("SELECT COUNT(*) n FROM mensagens WHERE tipo = 'abertura' AND date(enviado_em, 'localtime') = date('now', 'localtime')").get().n;
}

/**
 * Best uncontacted leads with WhatsApp. Below `corteAvaliacoes` the business is usually just
 * starting and won't pay, so it stays out (0 turns the cut off).
 */
export function montarFila({ limite = 12, corteAvaliacoes = 15, minScore = 0, cidade } = {}) {
  const { leads } = listarLeads({
    camadas: ["A", "B", "R"], status: ["novo"], soWhatsApp: true, cidade: cidade || undefined,
    minAvaliacoes: corteAvaliacoes || undefined, minScore, limite: limite * 3,
  });
  const fila = [];
  for (const lead of leads) {
    const t = templateParaLead(lead);
    if (!t) continue;
    const m = montarMensagem(lead, t);
    if (m.faltando.length) continue; // would go out with a hole in the text
    fila.push({ lead, mensagem: m });
    if (fila.length >= limite) break;
  }
  return { fila, enviadasHoje: enviadasHoje(), tetoDiario: TETO_DIARIO };
}

/** Follow-up list: contacted 2+ days ago, no reply, only one message so far. */
export function filaFollowup({ dias = 2, limite = 20 } = {}) {
  const linhas = db().prepare(`SELECT l.* FROM leads l
    WHERE l.status = 'contatado' AND l.contatado_em <= datetime('now', ?)
      AND (SELECT COUNT(*) FROM mensagens m WHERE m.lead_id = l.id) = 1
    ORDER BY l.contatado_em LIMIT ?`).all(`-${dias} days`, limite);
  return linhas.map(paraLead).map((lead) => {
    const t = templateParaLead(lead, "followup");
    return { lead, mensagem: t ? montarMensagem(lead, t) : null };
  });
}

/** Called after you actually sent it. Logs the text and the template, marks the lead contacted. */
export function registrarEnvio(leadId, { templateId = null, corpo, tipo = "abertura" }) {
  db().prepare("INSERT INTO mensagens (lead_id, template_id, corpo, tipo) VALUES (?, ?, ?, ?)").run(leadId, templateId, corpo, tipo);
  db().prepare(`UPDATE leads SET status = CASE WHEN status = 'novo' THEN 'contatado' ELSE status END,
    contatado_em = COALESCE(contatado_em, datetime('now')), atualizado_em = datetime('now') WHERE id = ?`).run(leadId);
  return { enviadasHoje: enviadasHoje(), tetoDiario: TETO_DIARIO };
}

// ───────────────────────── replies ─────────────────────────

/** A reply from a person moves the lead to "respondeu"; an auto-reply is only noted. */
export function registrarResposta(leadId, texto) {
  const automatica = ehAutomatica(texto);
  db().prepare("INSERT INTO respostas (lead_id, texto, automatica) VALUES (?, ?, ?)").run(leadId, String(texto).slice(0, 2000), automatica ? 1 : 0);
  if (!automatica) {
    db().prepare(`UPDATE leads SET status = CASE WHEN status IN ('novo','contatado') THEN 'respondeu' ELSE status END,
      atualizado_em = datetime('now') WHERE id = ?`).run(leadId);
  }
  return { automatica, lead: obterLead(leadId) };
}

const digitos = (s) => String(s || "").replace(/\D/g, "");
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/**
 * Chat list read from WhatsApp Web (leads/whatsapp-conversas.js). Unsaved numbers show up as
 * the phone, saved ones as the name. Only chats whose last message is theirs count.
 * @param {{titulo: string, previa: string, deles: boolean}[]} conversas
 */
export function registrarRespostasEmLote(conversas, { gravar = false } = {}) {
  const contatados = db().prepare("SELECT * FROM leads WHERE status = 'contatado'").all();
  const achados = [];
  for (const c of conversas || []) {
    if (!c?.deles) continue;
    const d = digitos(c.titulo);
    let lead = null;
    if (d.length >= 8) lead = contatados.find((l) => l.telefone_e164 && digitos(l.telefone_e164).slice(-8) === d.slice(-8));
    else lead = contatados.find((l) => semAcento(l.nome) === semAcento(c.titulo));
    if (!lead) continue;
    const automatica = ehAutomatica(c.previa);
    achados.push({ leadId: lead.id, nome: lead.nome, previa: c.previa, automatica });
    if (gravar) registrarResposta(lead.id, c.previa || "(resposta)");
  }
  return { achados, gravado: gravar };
}

// ───────────────────────── metrics ─────────────────────────

/** Reply rate per template, counting each lead's first message only. */
export function metricas() {
  const porTemplate = db().prepare(`
    WITH primeira AS (
      SELECT lead_id, template_id, MIN(enviado_em) em FROM mensagens WHERE tipo = 'abertura' GROUP BY lead_id
    )
    SELECT p.template_id AS templateId, COALESCE(t.nome, '(sem template)') AS template,
      COUNT(*) AS enviados,
      SUM(l.status IN ('respondeu','cliente')) AS responderam,
      SUM(l.status = 'cliente') AS clientes,
      SUM(EXISTS (SELECT 1 FROM respostas r WHERE r.lead_id = l.id AND r.automatica = 1)
          AND l.status NOT IN ('respondeu','cliente')) AS automaticas,
      MIN(p.em) AS desde
    FROM primeira p JOIN leads l ON l.id = p.lead_id LEFT JOIN templates t ON t.id = p.template_id
    GROUP BY p.template_id ORDER BY enviados DESC`).all()
    .map((x) => ({ ...x, taxa: x.enviados ? x.responderam / x.enviados : 0 }));

  const q = (sql) => db().prepare(sql).get().n;
  const funil = {
    importados: q("SELECT COUNT(*) n FROM leads"),
    semSite: q("SELECT COUNT(*) n FROM leads WHERE camada IN ('A','B')"),
    comWhatsApp: q("SELECT COUNT(*) n FROM leads WHERE camada IN ('A','B') AND tipo_telefone IN ('celular','indefinido')"),
    sitesRuins: q("SELECT COUNT(*) n FROM leads WHERE camada = 'C' AND avaliacao_site = 'ruim'"),
    contatados: q("SELECT COUNT(*) n FROM leads WHERE status IN ('contatado','respondeu','cliente')"),
    responderam: q("SELECT COUNT(*) n FROM leads WHERE status IN ('respondeu','cliente')"),
    clientes: q("SELECT COUNT(*) n FROM leads WHERE status = 'cliente'"),
  };
  const porDia = db().prepare(`SELECT date(enviado_em, 'localtime') dia, COUNT(*) n FROM mensagens
    WHERE tipo = 'abertura' GROUP BY dia ORDER BY dia DESC LIMIT 14`).all();
  return { porTemplate, funil, porDia, enviadasHoje: enviadasHoje(), tetoDiario: TETO_DIARIO };
}
