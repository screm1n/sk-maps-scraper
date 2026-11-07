/**
 * Local SQLite database, using Node's built-in node:sqlite (no native module to compile).
 * The schema is idempotent and runs on every boot, which doubles as the migration.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS leads (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  chave               TEXT NOT NULL UNIQUE,      -- place_id, data_id, cid or link: dedupe across scrapes
  nome                TEXT NOT NULL,
  categoria           TEXT,
  endereco            TEXT,
  bairro              TEXT,
  cidade              TEXT,
  estado              TEXT,
  pais                TEXT,                      -- ISO-2
  lat                 REAL,
  lng                 REAL,
  telefone_bruto      TEXT,
  telefone_e164       TEXT,
  tipo_telefone       TEXT,                      -- celular | fixo | indefinido | outro
  website             TEXT,
  website_normalizado TEXT,
  camada              TEXT NOT NULL,             -- A | B | C
  site_fraco          INTEGER NOT NULL DEFAULT 0,
  ig_handle           TEXT,
  emails              TEXT,
  nota                REAL,
  qtd_avaliacoes      INTEGER NOT NULL DEFAULT 0,
  link_maps           TEXT,
  busca_id            TEXT,
  status              TEXT NOT NULL DEFAULT 'novo', -- novo | contatado | respondeu | cliente | descartado
  notas               TEXT,
  contatado_em        TEXT,
  criado_em           TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS leads_cidade ON leads(cidade);

CREATE TABLE IF NOT EXISTS templates (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nome      TEXT NOT NULL,
  corpo     TEXT NOT NULL,
  idioma    TEXT NOT NULL DEFAULT 'pt',          -- pt | es | en
  tipo      TEXT NOT NULL DEFAULT 'abertura',    -- abertura | poucas | followup | outro
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mensagens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id     INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES templates(id) ON DELETE SET NULL,
  corpo       TEXT NOT NULL,
  tipo        TEXT NOT NULL DEFAULT 'abertura',
  enviado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS respostas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id     INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  texto       TEXT NOT NULL,
  automatica  INTEGER NOT NULL DEFAULT 0,
  recebida_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bloqueio (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  telefone  TEXT,
  chave     TEXT,
  motivo    TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS importacoes (
  busca_id    TEXT PRIMARY KEY,
  nome        TEXT,
  pais        TEXT,
  lidos       INTEGER NOT NULL DEFAULT 0,
  novos       INTEGER NOT NULL DEFAULT 0,
  importado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

/** First messages ask, they don't sell (see README). Seeded only on an empty table. */
const TEMPLATES_INICIAIS = [
  ["Pergunta A (pt)", "pt", "abertura",
    "Oi, tudo bem? Vi a {{nome}} no Google, nota {{nota}} com {{qtd_avaliacoes}} avaliações, mas não achei um site de vocês.\n\nHoje o cliente novo chega mais por indicação ou vocês também pegam pelo Google?"],
  ["Pergunta B (pt)", "pt", "abertura",
    "Oi! Achei a {{nome}} pesquisando no Google, {{qtd_avaliacoes}} avaliações e nota {{nota}}, muito bom. Só não encontrei um site.\n\nA maioria dos clientes de vocês vem por indicação ou pelo Google mesmo?"],
  ["Pergunta, poucas avaliações (pt)", "pt", "poucas",
    "Oi, tudo bem? Vi a {{nome}} aparecendo no Google, mas não achei um site de vocês.\n\nHoje o cliente novo chega mais por indicação ou vocês também pegam pelo Google?"],
  ["Follow-up 48h (pt)", "pt", "followup",
    "Oi, passando aqui de novo. Te perguntei sobre os clientes da {{nome}} porque monto site pra negócio local, e faço a prévia antes de cobrar qualquer coisa.\n\nQuer que eu monte a de vocês e te mande uma imagem de como ficou? Se não tiver interesse, tranquilo, não te chamo mais."],
  ["Pregunta A (es)", "es", "abertura",
    "¡Hola! Vi {{nome}} en Google, {{nota}} estrellas con {{qtd_avaliacoes}} reseñas, pero no encontré su página web.\n\n¿Hoy los clientes nuevos les llegan más por recomendación o también por Google?"],
  ["Pregunta, pocas reseñas (es)", "es", "poucas",
    "¡Hola! Vi {{nome}} en Google, pero no encontré su página web.\n\n¿Hoy los clientes nuevos les llegan más por recomendación o también por Google?"],
  ["Seguimiento 48h (es)", "es", "followup",
    "¡Hola de nuevo! Les pregunté por los clientes de {{nome}} porque hago páginas web para negocios locales, y armo la vista previa antes de cobrar nada.\n\n¿Quieren que les arme la suya y les mande una imagen? Si no les interesa, no hay problema, no les escribo más."],
  ["Question A (en)", "en", "abertura",
    "Hi! I came across {{nome}} on Google, {{nota}} stars from {{qtd_avaliacoes}} reviews, but couldn't find your website.\n\nDo most of your new customers come from referrals, or do you also get them from Google?"],
  ["Question, few reviews (en)", "en", "poucas",
    "Hi! I came across {{nome}} on Google but couldn't find your website.\n\nDo most of your new customers come from referrals, or do you also get them from Google?"],
  ["Follow-up 48h (en)", "en", "followup",
    "Hi again! I asked about {{nome}}'s customers because I build websites for local businesses, and I make the preview before charging anything.\n\nWant me to build yours and send you a picture of it? If you're not interested, no worries, I won't reach out again."],
];

let _db = null;

export function abrirBanco(caminho = process.env.LEADS_DB || "./data/leads.db") {
  if (_db) return _db;
  if (caminho !== ":memory:") mkdirSync(dirname(resolve(caminho)), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM templates").get();
  if (n === 0) {
    const ins = db.prepare("INSERT INTO templates (nome, idioma, tipo, corpo) VALUES (?, ?, ?, ?)");
    for (const t of TEMPLATES_INICIAIS) ins.run(...t);
  }
  _db = db;
  return db;
}

/** Tests point the database at memory and start clean. */
export function fecharBanco() {
  _db?.close();
  _db = null;
}
