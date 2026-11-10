/**
 * Outreach templates: {{variable}} rendering plus the guards that keep a bad message
 * from going out (em dash, missing opt-out).
 */

/** Language of a country, for picking the template and formatting the rating. */
export function idiomaDoPais(pais) {
  const p = (pais || "BR").toUpperCase();
  if (["BR", "PT", "AO", "MZ", "CV"].includes(p)) return "pt";
  if (["ES", "MX", "AR", "CO", "CL", "PE", "UY", "PY", "EC", "PA", "CR", "DO", "GT", "SV", "HN", "BO", "VE", "NI", "PR"].includes(p)) return "es";
  return "en";
}

/**
 * Google names often carry SEO glued on: "Kesya Souza - Psicóloga - Santa Amélia, BH" or
 * "Dra. Queila | Quiropraxia | Pilates". In a message that screams mass-sending, so only the
 * part before the first spaced " | " or " - " stays, if it is long enough to be a name.
 */
export function nomeCurto(nome) {
  const limpo = String(nome || "").trim();
  const primeiro = limpo.split(/\s+[|\-–—·]\s+/)[0].trim();
  return primeiro.length >= 3 ? primeiro : limpo;
}

const RE_VAR = /\{\{\s*([a-z_]+)\s*\}\}/g;

function variaveis(lead, idioma) {
  const nota = lead.nota != null ? Number(lead.nota).toFixed(1) : null;
  return {
    nome: lead.nome ? nomeCurto(lead.nome) : null,
    primeiro_nome: lead.nome ? String(lead.nome).trim().split(/\s+/)[0] : null,
    categoria: lead.categoria || null,
    cidade: lead.cidade || null,
    bairro: lead.bairro || null,
    // "5.0" gives away generated text in Portuguese and Spanish: there the decimal is a comma.
    nota: nota == null ? null : idioma === "en" ? nota : nota.replace(".", ","),
    // Zero reviews is not a number to compliment, it is missing data.
    qtd_avaliacoes: lead.qtdAvaliacoes ? String(lead.qtdAvaliacoes) : null,
    ig_handle: lead.igHandle || null,
  };
}

/** @returns {{corpo: string, faltando: string[]}} `faltando` blocks sending in the UI. */
export function renderizar(template, lead, idioma = "pt") {
  const vars = variaveis(lead, idioma);
  const faltando = [];
  const corpo = template
    .replace(RE_VAR, (_m, chave) => {
      const v = vars[chave];
      if (v == null || v === "") {
        if (!faltando.includes(chave)) faltando.push(chave);
        return "";
      }
      return v;
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.!?])/g, "$1")
    .trim();
  return { corpo, faltando };
}

export const VARIAVEIS = ["nome", "primeiro_nome", "categoria", "cidade", "bairro", "nota", "qtd_avaliacoes", "ig_handle"];

const RE_TRAVESSAO = /[—–]/;

/** Ways of offering a way out, in Portuguese, Spanish and English. */
const PADROES_OPTOUT = [
  /n[ãa]o (quiser|quer|queira|desejar) (mais )?(receber|que eu)/,
  /n[ãa]o (tiver|tiverem|ter|tem) interesse/,
  /n[ãa]o (for|for do) (seu )?interesse/,
  /sem interesse/,
  /n[ãa]o (for|seja|e) (o|um bom) momento/,
  /descadastr/,
  /sair da lista/,
  /(e|é) s[óo] (me )?(falar|avisar|dizer) que (eu )?paro/,
  /no (te|le|les) interesa/,
  /no hay problema/,
  /no (te|le) (vuelvo a )?escrib/,
  /not interested/,
  /no worries/,
  /won'?t (reach out|message|bother)/,
  /unsubscribe/,
];

/**
 * Signs that the message is offering something. With any of them the opt-out is required,
 * even if the text ends in a question ("Can I send you an idea?").
 */
const RE_OFERTA = /(faco |trabalho com|posso (te )?(mandar|enviar|montar|fazer|mostrar)|montei|previa|ofereco|orcamento|preco|hago |disen|puedo (enviar|mandar|hacer)|presupuesto|precio|i (build|make|design)|we (build|make|design)|can i (send|show)|preview|price|quote|https?:\/\/|www\.|r\$|us\$|€|£)/;

/**
 * An opener that only asks ("referrals or Google?") offers nothing, so there is nothing to
 * opt out of, and "if you're not interested" there gives the sale away. The way out comes
 * back in the follow-up and the offer.
 */
function perguntaPura(normalizado) {
  return normalizado.trim().endsWith("?") && !RE_OFERTA.test(normalizado);
}

/** @returns {{ok: boolean, erros: string[]}} */
export function validarTemplate(corpo) {
  const erros = [];
  if (RE_TRAVESSAO.test(corpo)) {
    erros.push("Tem travessão no texto. Travessão denuncia texto de IA: use vírgula, ponto ou parênteses.");
  }
  const normalizado = String(corpo).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (!PADROES_OPTOUT.some((re) => re.test(normalizado)) && !perguntaPura(normalizado)) {
    erros.push("Falta uma saída (\"se não tiver interesse, tranquilo\"). Só a primeira mensagem que apenas pergunta, sem oferecer nada, pode ir sem.");
  }
  return { ok: erros.length === 0, erros };
}
