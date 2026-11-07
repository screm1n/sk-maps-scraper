/**
 * Quick look at a business website, to help decide if it's worth redoing. It doesn't decide
 * for you: it flags what a client would notice (slow, no padlock, not made for phones, no
 * WhatsApp button, footer from years ago, page builder template). You still open and judge.
 */

const ANO = new Date().getFullYear();

/** Blocks this machine and the local network: the URL comes from Google, not from you. */
export function enderecoPermitido(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!["http:", "https:"].includes(u.protocol)) return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h === "0.0.0.0" || h === "[::1]") return false;
  if (/^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  return true;
}

/** Reads the page HTML into signals. Pure: tested without the network. */
export function analisarHtml(html, { https, ms, status, tamanhoKb }) {
  const h = String(html || "");
  const baixo = h.toLowerCase();
  const sinais = [];
  const add = (ok, texto, peso = 1) => sinais.push({ ok, texto, peso });

  add(status >= 200 && status < 400, status >= 200 && status < 400 ? "abre normalmente" : `não abre (erro ${status})`, 3);
  add(https, https ? "tem cadeado (HTTPS)" : "sem cadeado: o navegador avisa \"não seguro\"", 2);
  if (ms != null) add(ms < 3000, ms < 3000 ? `carregou em ${(ms / 1000).toFixed(1).replace(".", ",")} s` : `lento: ${(ms / 1000).toFixed(1).replace(".", ",")} s pra responder`, 2);
  if (tamanhoKb != null && tamanhoKb > 4000) add(false, `página pesada (${Math.round(tamanhoKb / 1024)} MB de HTML)`);

  const viewport = /<meta[^>]+name=["']?viewport/i.test(h);
  add(viewport, viewport ? "feito pra celular" : "não foi feito pra celular (sem viewport)", 3);

  const whats = /wa\.me\/|api\.whatsapp\.com|whatsapp:\/\/|web\.whatsapp\.com/i.test(h);
  add(whats, whats ? "tem botão de WhatsApp" : "sem botão de WhatsApp", 2);

  const anos = [...h.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})/gi)].map((m) => Number(m[1]));
  if (anos.length) {
    const ultimo = Math.max(...anos);
    add(ANO - ultimo <= 2, ANO - ultimo <= 2 ? `rodapé de ${ultimo}` : `rodapé parado em ${ultimo}: parece abandonado`);
  }

  const titulo = (h.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || "").trim();
  if (!titulo) add(false, "página sem título (aparece mal no Google)");
  else if (/^(home|início|inicio|página inicial|my site|meu site|untitled|welcome)$/i.test(titulo)) add(false, `título genérico: "${titulo}"`);

  const construtor = /wix\.com|wixstatic/i.test(baixo) ? "Wix"
    : /wp-content|wordpress/i.test(baixo) ? "WordPress"
    : /godaddy|websitebuilder/i.test(baixo) ? "GoDaddy"
    : /squarespace/i.test(baixo) ? "Squarespace"
    : /webnode/i.test(baixo) ? "Webnode"
    : /sites\.google\.com|gstatic\.com\/atari/i.test(baixo) ? "Google Sites" : null;
  if (/flash|\.swf/i.test(baixo) && /<object|<embed/i.test(baixo)) add(false, "usa Flash (não abre mais em lugar nenhum)", 2);
  if (/<table[^>]*width=["']?\d{3,}/i.test(h) && !viewport) add(false, "layout antigo em tabelas");

  const problemas = sinais.filter((s) => !s.ok);
  const peso = problemas.reduce((n, s) => n + s.peso, 0);
  const veredito = peso >= 4 ? "cabe refazer" : peso >= 2 ? "dá pra melhorar" : "parece bom";
  return { veredito, pesoProblemas: peso, sinais, titulo: titulo || null, construtor };
}

/** Opens the site from here (server side) and analyzes it. Never throws: errors become a signal. */
export async function checarSite(url) {
  const alvo = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  if (!enderecoPermitido(alvo)) return { veredito: "não checado", pesoProblemas: 0, sinais: [{ ok: false, texto: "endereço não permitido", peso: 0 }], url: alvo };
  const inicio = Date.now();
  try {
    const r = await fetch(alvo, {
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
      headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36", "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" },
    });
    const ms = Date.now() - inicio;
    const buf = Buffer.from(await r.arrayBuffer());
    const html = buf.subarray(0, 3_000_000).toString("utf8");
    const final = r.url || alvo;
    return { ...analisarHtml(html, { https: final.startsWith("https:"), ms, status: r.status, tamanhoKb: buf.length / 1024 }), url: final };
  } catch (e) {
    const tempo = e.name === "TimeoutError" || /timeout/i.test(e.message);
    return {
      veredito: "cabe refazer", pesoProblemas: 5, url: alvo,
      sinais: [{ ok: false, texto: tempo ? "não respondeu em 12 s" : "não abre (domínio fora do ar ou sem certificado)", peso: 5 }],
    };
  }
}
