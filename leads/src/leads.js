/** Lead repository: write from imports, read with the score computed on the fly. */
import { abrirBanco } from "./db.js";
import { classificar } from "./dominio/classificar.js";
import { lerTelefone, podeWhatsApp } from "./dominio/telefone.js";
import { notaDoLead } from "./dominio/nota.js";

const db = () => abrirBanco();

export function estaBloqueado(telefone, chave) {
  return !!db().prepare(
    "SELECT 1 FROM bloqueio WHERE (telefone IS NOT NULL AND telefone = ?) OR (chave IS NOT NULL AND chave = ?) LIMIT 1"
  ).get(telefone ?? null, chave ?? null);
}

/**
 * Inserts or refreshes a place. Status, notes and history are yours and survive a re-import:
 * only Google's content is overwritten.
 * @returns {"novo"|"atualizado"|"bloqueado"}
 */
export function gravarLugar(l) {
  const c = classificar(l.website);
  const tel = lerTelefone(l.telefone, l.pais);
  if (estaBloqueado(tel?.e164, l.chave)) return "bloqueado";

  const existe = db().prepare("SELECT id FROM leads WHERE chave = ?").get(l.chave);
  const campos = [
    l.nome, l.categoria ?? null, l.endereco ?? null, l.bairro ?? null, l.cidade ?? null, l.estado ?? null,
    l.pais ?? null, l.lat ?? null, l.lng ?? null, l.telefone ?? null, tel?.e164 ?? null, tel?.tipo ?? null,
    l.website ?? null, c.websiteNormalizado, c.camada, c.siteFraco ? 1 : 0, c.igHandle, l.emails ?? null,
    l.nota ?? null, l.qtdAvaliacoes ?? 0, l.linkMaps ?? null, l.buscaId ?? null, l.naoReivindicado ? 1 : 0,
  ];
  if (existe) {
    db().prepare(`UPDATE leads SET nome=?, categoria=?, endereco=?, bairro=?, cidade=?, estado=?, pais=?, lat=?, lng=?,
      telefone_bruto=?, telefone_e164=?, tipo_telefone=?, website=?, website_normalizado=?, camada=?, site_fraco=?,
      ig_handle=COALESCE(?, ig_handle), emails=COALESCE(?, emails), nota=?, qtd_avaliacoes=?, link_maps=?,
      busca_id=COALESCE(?, busca_id), nao_reivindicado=?, atualizado_em=datetime('now') WHERE id=?`).run(...campos, existe.id);
    return "atualizado";
  }
  db().prepare(`INSERT INTO leads (nome, categoria, endereco, bairro, cidade, estado, pais, lat, lng,
      telefone_bruto, telefone_e164, tipo_telefone, website, website_normalizado, camada, site_fraco, ig_handle,
      emails, nota, qtd_avaliacoes, link_maps, busca_id, nao_reivindicado, chave) VALUES (${campos.map(() => "?").join(",")}, ?)`)
    .run(...campos, l.chave);
  return "novo";
}

/** Database row to the shape the UI and the rules use, with score and WhatsApp flag. */
export function paraLead(r) {
  const lead = {
    id: r.id, nome: r.nome, categoria: r.categoria, endereco: r.endereco, bairro: r.bairro,
    cidade: r.cidade, estado: r.estado, pais: r.pais, lat: r.lat, lng: r.lng,
    telefone: r.telefone_bruto, telefoneE164: r.telefone_e164, tipoTelefone: r.tipo_telefone,
    website: r.website, camada: r.camada, siteFraco: !!r.site_fraco, igHandle: r.ig_handle,
    emails: r.emails, nota: r.nota, qtdAvaliacoes: r.qtd_avaliacoes, linkMaps: r.link_maps,
    buscaId: r.busca_id, naoReivindicado: !!r.nao_reivindicado, status: r.status, notas: r.notas, contatadoEm: r.contatado_em, criadoEm: r.criado_em,
  };
  lead.score = notaDoLead({ ...lead, temEmail: !!(r.emails && r.emails.includes("@")) });
  lead.whatsapp = podeWhatsApp(r.tipo_telefone) && !!r.telefone_e164;
  return lead;
}

/**
 * @param {{camadas?: string[], status?: string[], cidade?: string, busca?: string, soWhatsApp?: boolean,
 *          minScore?: number, minAvaliacoes?: number, ordem?: "score"|"recente"|"avaliacoes", limite?: number}} f
 */
export function listarLeads(f = {}) {
  const where = ["1=1"];
  const args = [];
  if (f.camadas?.length) { where.push(`camada IN (${f.camadas.map(() => "?").join(",")})`); args.push(...f.camadas); }
  if (f.status?.length) { where.push(`status IN (${f.status.map(() => "?").join(",")})`); args.push(...f.status); }
  if (f.cidade) { where.push("cidade = ?"); args.push(f.cidade); }
  if (f.busca) { where.push("(nome LIKE ? OR categoria LIKE ? OR bairro LIKE ?)"); args.push(...Array(3).fill(`%${f.busca}%`)); }
  if (f.soWhatsApp) where.push("tipo_telefone IN ('celular','indefinido') AND telefone_e164 IS NOT NULL");
  if (f.minAvaliacoes) { where.push("qtd_avaliacoes >= ?"); args.push(f.minAvaliacoes); }

  let leads = db().prepare(`SELECT * FROM leads WHERE ${where.join(" AND ")}`).all(...args).map(paraLead);
  if (f.minScore) leads = leads.filter((l) => l.score.total >= f.minScore);
  const ordem = f.ordem || "score";
  leads.sort((a, b) =>
    ordem === "recente" ? b.id - a.id
    : ordem === "avaliacoes" ? b.qtdAvaliacoes - a.qtdAvaliacoes
    : b.score.total - a.score.total || b.qtdAvaliacoes - a.qtdAvaliacoes);
  const total = leads.length;
  return { total, leads: leads.slice(0, f.limite || 500) };
}

export function obterLead(id) {
  const r = db().prepare("SELECT * FROM leads WHERE id = ?").get(id);
  if (!r) return null;
  const lead = paraLead(r);
  lead.mensagens = db().prepare(
    "SELECT m.id, m.corpo, m.tipo, m.enviado_em AS enviadoEm, t.nome AS template FROM mensagens m LEFT JOIN templates t ON t.id = m.template_id WHERE m.lead_id = ? ORDER BY m.id"
  ).all(id);
  lead.respostas = db().prepare(
    "SELECT id, texto, automatica, recebida_em AS recebidaEm FROM respostas WHERE lead_id = ? ORDER BY id"
  ).all(id).map((x) => ({ ...x, automatica: !!x.automatica }));
  return lead;
}

const STATUS = ["novo", "contatado", "respondeu", "cliente", "descartado"];

export function atualizarLead(id, { status, notas }) {
  if (status && !STATUS.includes(status)) throw new Error("status inválido");
  db().prepare(`UPDATE leads SET status = COALESCE(?, status), notas = COALESCE(?, notas),
    contatado_em = CASE WHEN ? = 'contatado' AND contatado_em IS NULL THEN datetime('now') ELSE contatado_em END,
    atualizado_em = datetime('now') WHERE id = ?`).run(status ?? null, notas ?? null, status ?? null, id);
  return obterLead(id);
}

/** Asked to stop: blocked by phone and by place, never comes back even in a new scrape. */
export function bloquearLead(id, motivo = "pediu para sair") {
  const l = db().prepare("SELECT telefone_e164, chave FROM leads WHERE id = ?").get(id);
  if (!l) return false;
  db().prepare("INSERT INTO bloqueio (telefone, chave, motivo) VALUES (?, ?, ?)").run(l.telefone_e164, l.chave, motivo);
  db().prepare("UPDATE leads SET status = 'descartado', atualizado_em = datetime('now') WHERE id = ?").run(id);
  return true;
}

export function cidades() {
  return db().prepare("SELECT cidade, pais, COUNT(*) AS n FROM leads WHERE cidade IS NOT NULL GROUP BY cidade, pais ORDER BY n DESC").all();
}

export function resumo() {
  const porCamada = Object.fromEntries(db().prepare("SELECT camada, COUNT(*) n FROM leads GROUP BY camada").all().map((x) => [x.camada, x.n]));
  const porStatus = Object.fromEntries(db().prepare("SELECT status, COUNT(*) n FROM leads GROUP BY status").all().map((x) => [x.status, x.n]));
  const total = db().prepare("SELECT COUNT(*) n FROM leads").get().n;
  const comWhatsApp = db().prepare("SELECT COUNT(*) n FROM leads WHERE camada IN ('A','B') AND tipo_telefone IN ('celular','indefinido')").get().n;
  return { total, porCamada, porStatus, comWhatsApp };
}

/** How many businesses of the same category in the same city have their own site (for the proposal). */
export function levantamento(categoria, cidade) {
  if (!categoria || !cidade) return null;
  const r = db().prepare("SELECT COUNT(*) total, SUM(camada = 'C') com_site FROM leads WHERE categoria = ? AND cidade = ?").get(categoria, cidade);
  return r.total >= 5 ? { total: r.total, comSite: r.com_site } : null;
}
