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
  tipo      TEXT NOT NULL DEFAULT 'abertura',    -- abertura | poucas | refazer | followup | outro
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

-- Settings: current scraping source and the API keys (local only, never sent back whole).
CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT
);

-- Searches that ran on Apify or Google Places. Local ones live in the scraper itself.
CREATE TABLE IF NOT EXISTS buscas_externas (
  id          TEXT PRIMARY KEY,
  nome        TEXT,
  fonte       TEXT NOT NULL,              -- apify | places
  status      TEXT NOT NULL,              -- pending | working | ok | failed
  pedido      TEXT NOT NULL,              -- the job body, JSON
  execucao    TEXT,                       -- Apify run id
  csv         TEXT,                       -- result in the scraper's 34-column CSV
  lugares     INTEGER NOT NULL DEFAULT 0,
  custo_usd   REAL,
  erro        TEXT,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now')),
  terminado_em TEXT
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
  // Layer C marked "site ruim": they have a site, so the question is whether it brings clients.
  ["Pergunta, site ruim (pt)", "pt", "refazer",
    "Oi, tudo bem? Vi a {{nome}} no Google, nota {{nota}} com {{qtd_avaliacoes}} avaliações, e entrei no site de vocês pelo celular.\n\nHoje o site traz cliente novo pra vocês ou fica mais como um cartão de visita?"],
  ["Pregunta, web floja (es)", "es", "refazer",
    "¡Hola! Vi {{nome}} en Google, {{nota}} estrellas con {{qtd_avaliacoes}} reseñas, y entré a su página desde el celular.\n\n¿Hoy la página les trae clientes nuevos o queda más como una tarjeta de presentación?"],
  ["Question, weak site (en)", "en", "refazer",
    "Hi! I came across {{nome}} on Google, {{nota}} stars from {{qtd_avaliacoes}} reviews, and opened your website on my phone.\n\nDoes the site bring you new customers today, or is it more of a business card?"],
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
  // CREATE TABLE IF NOT EXISTS doesn't add columns to an existing table.
  const colunas = db.prepare("PRAGMA table_info(leads)").all().map((c) => c.name);
  if (!colunas.includes("nao_reivindicado")) db.exec("ALTER TABLE leads ADD COLUMN nao_reivindicado INTEGER NOT NULL DEFAULT 0");
  // Layer C review: your verdict on the site ("ruim" = worth redoing, "bom" = leave it) and the auto check.
  if (!colunas.includes("avaliacao_site")) db.exec("ALTER TABLE leads ADD COLUMN avaliacao_site TEXT");
  if (!colunas.includes("site_check")) db.exec("ALTER TABLE leads ADD COLUMN site_check TEXT");
  if (!colunas.includes("site_checado_em")) db.exec("ALTER TABLE leads ADD COLUMN site_checado_em TEXT");
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM templates").get();
  const ins = db.prepare("INSERT INTO templates (nome, idioma, tipo, corpo) VALUES (?, ?, ?, ?)");
  if (n === 0) {
    for (const t of TEMPLATES_INICIAIS) ins.run(...t);
  } else {
    // New kinds of message reach databases created before them, without touching yours.
    const tem = db.prepare("SELECT 1 FROM templates WHERE tipo = ? AND idioma = ? LIMIT 1");
    for (const t of TEMPLATES_INICIAIS) if (t[2] === "refazer" && !tem.get(t[2], t[1])) ins.run(...t);
  }
  _db = db;
  return db;
}

/** Tests point the database at memory and start clean. */
export function fecharBanco() {
  _db?.close();
  _db = null;
}
