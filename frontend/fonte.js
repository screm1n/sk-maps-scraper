/* Scraping source switch: Local (free, this machine), Apify (credit) or Google Places (official API).
   Shown at the top of the search form (Mapa, Painel) and of "Importar buscas" (Leads).
   Choosing a source with no key opens the setup; with a key, it switches and shows the balance.
   Talks to the leads server (/leads-api/fontes). */
(() => {
  "use strict";
  const API = "/leads-api/fontes";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const usd = (v) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const OPCOES = {
    local: { nome: "Local", tag: "grátis", sub: "Motor no seu PC, sem limite" },
    apify: { nome: "Apify", tag: "crédito", sub: "Na nuvem, troca de IP" },
    places: { nome: "Google Places", tag: "API oficial", sub: "Do próprio Google" },
  };
  const CONFIG = {
    apify: {
      titulo: "Conectar o Apify",
      texto: "O Apify raspa o Google Maps nas máquinas dele, trocando de IP, então o seu nunca é bloqueado. O plano grátis dá US$ 5 por mês, sem cartão (cerca de 1.000 empresas).",
      passos: [
        'Crie a conta em <a href="https://console.apify.com/sign-up" target="_blank" rel="noopener">console.apify.com</a>.',
        'Abra <a href="https://console.apify.com/settings/integrations" target="_blank" rel="noopener">Settings, API &amp; Integrations</a>.',
        "Copie o <b>Personal API token</b> e cole aqui.",
      ],
      rotulo: "Token do Apify", placeholder: "apify_api_...",
    },
    places: {
      titulo: "Conectar o Google Places",
      texto: "A API oficial do Google. Precisa de um projeto no Google Cloud com faturamento ativo; as primeiras 1.000 consultas do mês são grátis (cada uma traz até 20 empresas).",
      passos: [
        'No <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud</a>, crie um projeto e ligue uma conta de faturamento.',
        'Ative a <a href="https://console.cloud.google.com/apis/library/places.googleapis.com" target="_blank" rel="noopener">Places API (New)</a>.',
        'Em <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Credenciais</a>, crie uma chave de API e cole aqui.',
      ],
      rotulo: "Chave de API do Google", placeholder: "AIza...",
    },
  };

  let estado = null;
  const cards = [];

  async function pedir(caminho = "", opcoes = {}) {
    const r = await fetch(API + caminho, {
      ...opcoes,
      headers: opcoes.body ? { "Content-Type": "application/json" } : undefined,
      body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.erro || `erro ${r.status}`);
    return d;
  }

  const info = (id) => estado?.fontes.find((f) => f.id === id);
  function luz(f) {
    if (!f) return "";
    if (f.erro) return "erro";
    if (!f.configurada) return "";
    return f.pronta ? "ok" : "atencao";
  }

  function renderizar() {
    for (const el of cards) {
      if (!estado) { el.innerHTML = `<div class="fonte-topo"><b>Onde raspar</b><span>carregando…</span></div>`; continue; }
      const atual = info(estado.atual);
      const op = Object.entries(OPCOES).map(([id, o]) => {
        const f = info(id);
        const sub = !f?.configurada && id !== "local" ? "Toque pra conectar" : o.sub;
        return `<button type="button" class="fonte-op" role="radio" aria-checked="${estado.atual === id}" data-fonte="${id}">
          <span class="nome"><i class="${luz(f)}"></i>${o.nome}</span><span class="tag">${o.tag}</span><span class="sub">${sub}</span></button>`;
      }).join("");
      const saldo = atual?.erro
        ? `<p class="fonte-erro">${esc(atual.erro)}</p>`
        : `<div class="fonte-saldo"><b>${esc(atual?.saldo?.texto || "")}</b><small>${esc(atual?.saldo?.detalhe || "")}</small>
           ${estado.atual !== "local" ? `<button type="button" class="acao" data-config="${estado.atual}">Trocar chave</button>` : ""}</div>`;
      const aviso = estado.atual !== "local" && el.closest("#search-form")
        ? `<p class="fonte-aviso">E-mails só saem na raspagem Local. Por ${OPCOES[estado.atual].nome} vêm nome, telefone, site, nota e endereço.</p>` : "";
      el.innerHTML = `<div class="fonte-topo"><b>Onde raspar</b><span>a fonte vale pras próximas buscas</span></div>
        <div class="fonte-opcoes" role="radiogroup" aria-label="Fonte da raspagem">${op}</div>${saldo}<p class="fonte-custo" hidden></p>${aviso}`;
    }
    for (const p of document.querySelectorAll("[data-fonte-pilula]")) {
      const a = estado && info(estado.atual);
      p.innerHTML = a ? `<i style="background:${luz(a) === "ok" ? "#34a853" : luz(a) === "erro" ? "#ea4335" : "#fbbc04"}"></i><span>Raspando com ${esc(OPCOES[estado.atual].nome)}${a.saldo && estado.atual === "apify" ? ` · US$ ${usd(a.saldo.usdRestante)}` : ""}</span>` : "";
      p.title = a?.saldo ? `${a.saldo.texto}. ${a.saldo.detalhe}` : "";
    }
    estimativa();
  }

  // Cost of the search being typed, for the paid sources.
  let timer;
  function estimativa() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      for (const el of cards) {
        const p = el.querySelector(".fonte-custo");
        if (!p) continue;
        const form = el.closest("#search-form");
        if (!form || !estado || estado.atual === "local") { p.hidden = true; continue; }
        const termos = (document.querySelector("#keyword")?.value || "").split(",").map((t) => t.trim()).filter(Boolean).length || 1;
        const sel = document.querySelector(".chip.selected[data-depth], .seg button.on[data-depth], [data-depth][aria-checked='true']");
        const depth = sel ? sel.dataset.depth : 5;
        try {
          const e = await fetch(`${API}/estimativa?termos=${termos}&depth=${depth}`).then((r) => r.json());
          const a = info(estado.atual);
          if (estado.atual === "apify") {
            const caro = a?.saldo && e.custoUsd > a.saldo.usdRestante;
            p.className = `fonte-custo${caro ? " caro" : ""}`;
            p.innerHTML = `Esta busca: até <b>${e.lugaresMax} empresas</b>, custo máximo <b>US$ ${usd(e.custoUsd)}</b>${caro ? " (mais que o seu saldo)" : ""}.`;
          } else {
            p.className = "fonte-custo";
            p.innerHTML = `Esta busca: até <b>${e.lugaresMax} empresas</b> em <b>${e.consultas} consultas</b> da sua cota.`;
          }
          p.hidden = false;
        } catch { p.hidden = true; }
      }
    }, 250);
  }
  document.addEventListener("input", (e) => { if (e.target.id === "keyword") estimativa(); });
  document.addEventListener("click", (e) => { if (e.target.closest("[data-depth]")) estimativa(); });

  async function carregar() {
    try { estado = await pedir(); } catch { estado = null; }
    renderizar();
  }

  async function escolher(fonte) {
    if (estado?.atual === fonte) return;
    try {
      const r = await pedir("/atual", { method: "POST", body: { fonte } });
      if (r.precisaConfigurar) return abrirConfig(fonte);
      estado = r;
      renderizar();
      avisar(`Agora as buscas vão por ${OPCOES[fonte].nome}.`);
    } catch (e) { avisar(e.message); }
  }

  function avisar(msg) {
    document.querySelector(".fonte-toast")?.remove();
    const t = document.createElement("div");
    t.className = "toast fonte-toast"; t.setAttribute("role", "status"); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  // ───── key setup dialog ─────
  let dialogo;
  function abrirConfig(fonte) {
    const c = CONFIG[fonte], f = info(fonte);
    dialogo?.remove();
    dialogo = document.createElement("dialog");
    dialogo.className = "fonte-dialogo";
    dialogo.innerHTML = `<form method="dialog">
      <h2>${c.titulo}</h2>
      <p>${c.texto}</p>
      <ol>${c.passos.map((p) => `<li>${p}</li>`).join("")}</ol>
      <div><label for="fonte-chave">${c.rotulo}</label>
        <input id="fonte-chave" type="password" autocomplete="off" spellcheck="false" placeholder="${f?.chave ? `atual: ${esc(f.chave)}` : c.placeholder}"></div>
      <p class="erro" hidden></p>
      <p class="nota">A chave fica só nesta máquina, no banco local. Antes de salvar, ela é testada no ${OPCOES[fonte].nome}.</p>
      <div class="botoes">
        ${f?.configurada && f?.origem === "tela" ? `<button type="button" class="remover">Remover chave</button>` : ""}
        <button type="button" class="secundario" value="cancelar">Cancelar</button>
        <button type="submit" class="principal">Testar e usar</button>
      </div></form>`;
    document.body.appendChild(dialogo);
    const form = dialogo.querySelector("form"), erro = dialogo.querySelector(".erro"), botao = dialogo.querySelector(".principal");
    dialogo.querySelector(".secundario").addEventListener("click", () => dialogo.close());
    dialogo.querySelector(".remover")?.addEventListener("click", async () => {
      estado = await pedir(`/${fonte}/chave`, { method: "DELETE" });
      dialogo.close(); renderizar(); avisar(`Chave do ${OPCOES[fonte].nome} removida. Voltei pra Local.`);
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const chave = dialogo.querySelector("#fonte-chave").value.trim();
      if (!chave) return;
      botao.disabled = true; botao.textContent = "Testando…"; erro.hidden = true;
      try {
        estado = await pedir(`/${fonte}/chave`, { method: "POST", body: { chave } });
        dialogo.close(); renderizar();
        const s = info(fonte)?.saldo;
        avisar(`${OPCOES[fonte].nome} conectado${s ? `: ${s.texto}` : ""}.`);
      } catch (err) {
        erro.textContent = err.message; erro.hidden = false;
        botao.disabled = false; botao.textContent = "Testar e usar";
      }
    });
    dialogo.showModal();
    dialogo.querySelector("#fonte-chave").focus();
  }

  document.addEventListener("click", (e) => {
    const op = e.target.closest(".fonte [data-fonte]");
    if (op) return escolher(op.dataset.fonte);
    const cfg = e.target.closest(".fonte [data-config]");
    if (cfg) return abrirConfig(cfg.dataset.config);
    if (e.target.closest("[data-fonte-pilula]")) {
      const alvo = document.querySelector(".fonte");
      if (alvo) alvo.scrollIntoView({ behavior: "smooth", block: "center" });
      else location.href = "/painel#sec-new";
    }
  });

  // ───── mount ─────
  function montar() {
    // At the top of every search form, plus any explicit placeholder (Leads > Importar).
    for (const form of document.querySelectorAll("#search-form")) {
      const el = document.createElement("div");
      el.className = "fonte";
      form.prepend(el);
      cards.push(el);
    }
    for (const el of document.querySelectorAll("[data-fonte-card]")) { el.classList.add("fonte"); cards.push(el); }
    carregar();
    setInterval(carregar, 60000); // keeps the balance fresh
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", montar);
  else montar();
})();
