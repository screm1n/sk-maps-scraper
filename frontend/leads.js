/* Leads mode: lead list, import from the scraper, WhatsApp queue, templates and metrics.
   Talks to the leads server at /leads-api (see ../leads). */
(() => {
  "use strict";
  const API = "/leads-api";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString("pt-BR");
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "–");

  async function api(caminho, opcoes = {}) {
    const r = await fetch(API + caminho, {
      ...opcoes,
      headers: opcoes.body ? { "Content-Type": "application/json" } : undefined,
      body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
    });
    const dados = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(dados.erro || `erro ${r.status}`);
    return dados;
  }

  let toastTimer;
  function toast(msg) {
    $(".toast")?.remove();
    const t = document.createElement("div");
    t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 3800);
  }

  const STATUS = { novo: "Novo", contatado: "Contatado", respondeu: "Respondeu", cliente: "Cliente", descartado: "Descartado" };
  const TIPO_TEL = { celular: "celular", fixo: "fixo", indefinido: "pode ter WhatsApp", outro: "central" };
  const CAMADA = { A: "nada online", B: "só rede social ou agendamento", C: "tem site" };

  function scoreHtml(total) {
    const cor = total >= 70 ? "var(--green)" : total >= 45 ? "var(--yellow)" : "var(--red)";
    return `<span class="score" style="--p:${total};--c:${cor}" title="Nota do lead"><span>${total}</span></span>`;
  }

  // ───────────────────────── sections ─────────────────────────
  const SECOES = ["leads", "importar", "fila", "templates", "metricas"];
  const carregadas = {};
  function mostrar() {
    const atual = SECOES.includes(location.hash.slice(1)) ? location.hash.slice(1) : "leads";
    $$("section.secao").forEach((s) => (s.hidden = s.dataset.secao !== atual));
    $$(".nav-item").forEach((a) => a.classList.toggle("active", a.dataset.secao === atual));
    ({ leads: carregarLeads, importar: carregarBuscas, fila: () => carregadas.fila || montarFila(), templates: carregarTemplates, metricas: carregarMetricas })[atual]?.();
    window.scrollTo({ top: 0 });
  }
  window.addEventListener("hashchange", mostrar);

  // ───────────────────────── health + summary ─────────────────────────
  async function saude() {
    const el = $("#health");
    try {
      const s = await api("/saude");
      el.className = `health ${s.scraper ? "ok" : "down"}`;
      el.querySelector("span").textContent = s.scraper ? "scraper e leads no ar" : "leads no ar, scraper fora";
    } catch {
      el.className = "health down";
      el.querySelector("span").textContent = "servidor de leads fora do ar";
    }
  }

  async function carregarResumo() {
    const r = await api("/resumo");
    const c = r.porCamada, s = r.porStatus;
    const semSite = (c.A || 0) + (c.B || 0);
    const contatados = (s.contatado || 0) + (s.respondeu || 0) + (s.cliente || 0);
    const responderam = (s.respondeu || 0) + (s.cliente || 0);
    $("#k-total").textContent = fmt(r.total);
    $("#k-semsite").textContent = fmt(semSite);
    $("#k-semsite-hint").textContent = r.total ? `${pct(semSite, r.total)} das empresas` : " ";
    $("#k-wa").textContent = fmt(r.comWhatsApp);
    $("#k-contatados").textContent = fmt(contatados);
    $("#k-responderam").textContent = fmt(responderam);
    $("#k-taxa").textContent = contatados ? `${pct(responderam, contatados)} dos contatados` : " ";
    $("#k-clientes").textContent = fmt(s.cliente || 0);
  }

  async function carregarCidades() {
    const lista = await api("/cidades");
    for (const sel of [$("#f-cidade"), $("#q-cidade")]) {
      const atual = sel.value;
      sel.innerHTML = `<option value="">Todas</option>` + lista.map((c) => `<option value="${esc(c.cidade)}">${esc(c.cidade)}${c.pais ? ` (${esc(c.pais)})` : ""} · ${c.n}</option>`).join("");
      sel.value = atual;
    }
  }

  // ───────────────────────── leads ─────────────────────────
  let leadsCache = [];
  async function carregarLeads() {
    const q = new URLSearchParams({
      camadas: $("#f-camada").value, status: $("#f-status").value, cidade: $("#f-cidade").value,
      busca: $("#f-busca").value.trim(), ordem: $("#f-ordem").value, soWhatsApp: $("#f-wa").checked ? "1" : "", limite: "500",
    });
    for (const [k, v] of [...q]) if (!v) q.delete(k);
    const [dados] = await Promise.all([api(`/leads?${q}`), carregarResumo(), carregarCidades()]);
    leadsCache = dados.leads;
    const tbody = $("#tbody-leads");
    tbody.innerHTML = dados.leads.map((l) => `
      <tr data-id="${l.id}">
        <td>${scoreHtml(l.score.total)}</td>
        <td><div class="co-name">${esc(l.nome)}</div><div class="co-cat">${esc(l.categoria || "")}</div></td>
        <td><span class="camada ${l.camada}" title="${esc(CAMADA[l.camada])}">${l.camada}</span></td>
        <td class="addr">${esc([l.bairro, l.cidade].filter(Boolean).join(", "))}${l.pais ? ` <span class="co-cat">${esc(l.pais)}</span>` : ""}</td>
        <td><div class="contact">${l.telefone ? `<span>${esc(l.telefone)}</span>` : `<span class="none">sem telefone</span>`}
          ${l.tipoTelefone ? `<span class="tipo-tel ${l.tipoTelefone}">${esc(TIPO_TEL[l.tipoTelefone] || l.tipoTelefone)}</span>` : ""}
          ${l.emails ? `<span class="co-cat">${esc(l.emails.split(",")[0])}</span>` : ""}</div></td>
        <td class="num">${l.nota != null ? `<span class="stars">★</span> ${String(l.nota).replace(".", ",")}<span class="reviews">${fmt(l.qtdAvaliacoes)} avaliações</span>` : "–"}</td>
        <td><span class="badge-status ${l.status}">${STATUS[l.status]}</span></td>
      </tr>`).join("");
    $("#leads-vazio").hidden = dados.total > 0;
    $("#leads-conta").textContent = dados.total ? `${fmt(dados.total)} leads${dados.total > dados.leads.length ? `, mostrando ${fmt(dados.leads.length)}` : ""}. Clique num lead pra ver a nota detalhada, o histórico e registrar resposta.` : "";
    carregadas.leads = true;
  }

  let buscaTimer;
  $("#f-busca").addEventListener("input", () => { clearTimeout(buscaTimer); buscaTimer = setTimeout(carregarLeads, 250); });
  ["#f-camada", "#f-status", "#f-cidade", "#f-ordem", "#f-wa"].forEach((s) => $(s).addEventListener("change", carregarLeads));
  $("#tbody-leads").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (tr) abrirLead(Number(tr.dataset.id));
  });

  // ───────────────────────── lead drawer ─────────────────────────
  async function abrirLead(id) {
    const l = await api(`/leads/${id}`);
    const d = $("#drawer");
    const hist = [
      ...l.mensagens.map((m) => ({ quando: m.enviadoEm, html: `<li class="eu"><small>Você · ${esc(m.template || "mensagem")} · ${esc(m.enviadoEm)}</small>${esc(m.corpo)}</li>` })),
      ...l.respostas.map((r) => ({ quando: r.recebidaEm, html: `<li><small>${r.automatica ? "Resposta automática" : "Resposta"} · ${esc(r.recebidaEm)}</small>${esc(r.texto)}</li>` })),
    ].sort((a, b) => a.quando.localeCompare(b.quando)).map((x) => x.html).join("");
    d.innerHTML = `
      <div class="drawer-head">
        ${scoreHtml(l.score.total)}
        <div style="flex:1;min-width:0"><h2>${esc(l.nome)}</h2><p>${esc([l.categoria, l.bairro, l.cidade, l.pais].filter(Boolean).join(" · "))}</p></div>
        <button class="icon-btn btn-ghost btn sm" data-act="fechar" aria-label="Fechar">✕</button>
      </div>
      <div class="drawer-body">
        <div class="acoes">
          ${l.whatsapp ? `<a class="btn verde sm" href="https://wa.me/${esc(l.telefoneE164.replace(/\D/g, ""))}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
          ${l.linkMaps ? `<a class="btn sm" href="${esc(l.linkMaps)}" target="_blank" rel="noopener">Google Maps</a>` : ""}
          ${l.website ? `<a class="btn sm" href="${esc(/^https?:/.test(l.website) ? l.website : "https://" + l.website)}" target="_blank" rel="noopener">${l.camada === "C" ? "Site" : "Link no Google"}</a>` : ""}
          <a class="btn filled sm" href="/proposta?lead=${l.id}" target="_blank" rel="noopener">Gerar proposta</a>
        </div>
        <div><h3>Status</h3>
          <select class="input" data-act="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === l.status ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div><h3>De onde vem a nota</h3><ul class="fatores">${l.score.fatores.map((f) => `<li><span>${esc(f.detalhe)}</span><b class="${f.pontos < 0 ? "neg" : ""}">${f.pontos > 0 ? "+" : ""}${f.pontos}</b></li>`).join("")}</ul></div>
        <div><h3>Contato</h3><p style="font-size:13px">${esc(l.telefone || "sem telefone")} ${l.tipoTelefone ? `<span class="tipo-tel ${l.tipoTelefone}">${esc(TIPO_TEL[l.tipoTelefone])}</span>` : ""}${l.emails ? `<br>${esc(l.emails)}` : ""}${l.endereco ? `<br><span class="co-cat">${esc(l.endereco)}</span>` : ""}</p></div>
        <div><h3>Registrar resposta</h3>
          <textarea class="input" data-campo="resposta" placeholder="Cole aqui o que a pessoa respondeu. Resposta automática é reconhecida e não conta como interesse."></textarea>
          <div class="acoes" style="margin-top:6px"><button class="btn sm" data-act="resposta">Registrar</button></div></div>
        <div><h3>Notas</h3><textarea class="input" data-campo="notas" placeholder="Preço combinado, quando voltar a chamar...">${esc(l.notas || "")}</textarea>
          <div class="acoes" style="margin-top:6px"><button class="btn sm" data-act="notas">Salvar notas</button></div></div>
        <div><h3>Histórico</h3>${hist ? `<ul class="historico">${hist}</ul>` : `<p class="help">Nenhuma mensagem ainda.</p>`}</div>
        <div><button class="btn vermelho sm" data-act="bloquear">Pediu pra sair: bloquear</button>
          <p class="help" style="margin-top:6px">Bloqueia pelo telefone e pela ficha do Google. Não volta nem em busca nova.</p></div>
      </div>`;
    d.hidden = false;
    d.dataset.id = id;
  }

  $("#drawer").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.tagName === "SELECT") return;
    const d = $("#drawer"), id = Number(d.dataset.id);
    try {
      if (b.dataset.act === "fechar") { d.hidden = true; return; }
      if (b.dataset.act === "notas") { await api(`/leads/${id}`, { method: "PATCH", body: { notas: $("[data-campo=notas]", d).value } }); toast("Notas salvas."); }
      if (b.dataset.act === "resposta") {
        const texto = $("[data-campo=resposta]", d).value.trim();
        if (!texto) return;
        const r = await api(`/leads/${id}/resposta`, { method: "POST", body: { texto } });
        toast(r.automatica ? "Era resposta automática: anotada, mas não conta como resposta." : "Resposta registrada. Lead em \"Respondeu\".");
        await abrirLead(id);
      }
      if (b.dataset.act === "bloquear") {
        if (!confirm("Bloquear este lead? Ele sai da fila e não volta nem em busca nova.")) return;
        await api(`/leads/${id}/bloquear`, { method: "POST", body: {} });
        toast("Lead bloqueado."); d.hidden = true;
      }
      if (carregadas.leads) carregarLeads();
    } catch (err) { toast(err.message); }
  });
  $("#drawer").addEventListener("change", async (e) => {
    if (e.target.dataset.act !== "status") return;
    const id = Number($("#drawer").dataset.id);
    await api(`/leads/${id}`, { method: "PATCH", body: { status: e.target.value } });
    toast(`Status: ${STATUS[e.target.value]}.`);
    carregarLeads();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#drawer").hidden = true; });

  // ───────────────────────── import ─────────────────────────
  const PAISES = (() => {
    try {
      const dn = new Intl.DisplayNames(["pt-BR"], { type: "region", fallback: "none" });
      // Besides non-countries, drop retired codes (East Germany, "UK" for GB, Burma...) that Intl still names.
      const fora = new Set(["EU", "EZ", "UN", "QO", "XA", "XB", "ZZ", "AC", "CP", "DG", "EA", "IC", "TA", "CQ", "DD", "DY", "HV", "FX", "YD", "UK", "BU", "ZR", "TP", "NT", "CS", "YU", "SU", "AN", "VD", "RH", "QU", "NH"]);
      const l = [];
      for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
        const c = String.fromCharCode(a, b);
        if (fora.has(c)) continue;
        let n; try { n = dn.of(c); } catch { n = undefined; }
        if (n && n !== c) l.push([c, n]);
      }
      return l.sort((x, y) => x[1].localeCompare(y[1], "pt-BR"));
    } catch { return [["BR", "Brasil"], ["PT", "Portugal"], ["US", "Estados Unidos"]]; }
  })();
  const opcoesPais = `<option value="">Automático</option>` + PAISES.map(([c, n]) => `<option value="${c}">${esc(n)}</option>`).join("");
  const STATUS_BUSCA = { ok: "Pronta", working: "Coletando", pending: "Na fila", failed: "Falhou" };

  async function carregarBuscas() {
    const ul = $("#lista-buscas"), erro = $("#buscas-erro");
    erro.hidden = true;
    try {
      const buscas = await api("/buscas");
      if (!buscas.length) { ul.innerHTML = `<li class="vazio"><b>Nenhuma busca no scraper.</b>Crie uma no <a href="/">Mapa</a> ou no <a href="/painel">Painel</a>.</li>`; return; }
      ul.innerHTML = buscas.map((b) => {
        const imp = b.importacao;
        return `<li class="job ${esc(b.status)}" data-id="${esc(b.id)}" style="grid-template-columns:1fr auto auto;cursor:default">
          <div><div class="job-title">${esc(b.nome || b.palavras.join(", "))}</div>
            <div class="job-meta"><span class="status ${esc(b.status)}"><i class="dot ${esc(b.status)}"></i>${esc(STATUS_BUSCA[b.status] || b.status)}</span>
            ${b.palavras.length ? `<span>${esc(b.palavras.join(", "))}</span>` : ""}
            ${imp ? `<span>importada: ${fmt(imp.lidos)} empresas, ${fmt(imp.novos)} novas</span>` : ""}</div></div>
          <select class="input" data-campo="pais" style="height:30px;width:170px" aria-label="País dos telefones">${opcoesPais}</select>
          <button class="btn ${imp ? "" : "filled"} sm" data-act="importar" ${b.status === "ok" ? "" : "disabled"}>${imp ? "Importar de novo" : "Importar"}</button>
        </li>`;
      }).join("");
      $$("li[data-id]", ul).forEach((li) => {
        const b = buscas.find((x) => x.id === li.dataset.id);
        if (b?.importacao?.pais) $("select", li).value = b.importacao.pais;
      });
    } catch (e) {
      ul.innerHTML = "";
      erro.textContent = e.message;
      erro.hidden = false;
    }
  }
  $("#recarregar-buscas").addEventListener("click", carregarBuscas);
  $("#lista-buscas").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act=importar]");
    if (!b) return;
    const li = b.closest("li");
    b.disabled = true; b.textContent = "Importando…";
    try {
      const r = await api(`/buscas/${encodeURIComponent(li.dataset.id)}/importar`, { method: "POST", body: { pais: $("select", li).value || null, nome: $(".job-title", li).textContent } });
      toast(`${fmt(r.novos)} novos, ${fmt(r.atualizados)} atualizados. Sem site: ${fmt((r.camadas.A || 0) + (r.camadas.B || 0))}.${r.bloqueados ? ` ${r.bloqueados} bloqueados ignorados.` : ""}`);
      carregadas.fila = false;
      carregarBuscas();
    } catch (err) { toast(err.message); b.disabled = false; b.textContent = "Importar"; }
  });

  // ───────────────────────── queue ─────────────────────────
  function medidor(enviadas, teto) {
    $("#medidor-txt").textContent = `Hoje: ${enviadas} de ${teto}`;
    const i = $("#medidor-barra");
    i.style.width = `${Math.min(100, (enviadas / teto) * 100)}%`;
    i.classList.toggle("cheio", enviadas >= teto);
    const badge = $("#badge-fila");
    badge.hidden = enviadas < teto; badge.textContent = "!";
  }

  function avisoHorario() {
    const agora = new Date(), h = agora.getHours(), dom = agora.getDay() === 0;
    const el = $("#aviso-horario");
    if (dom || h < 8 || h >= 19) {
      el.hidden = false;
      el.textContent = dom ? "Hoje é domingo: dono de negócio não responde, e mensagem fria no fim de semana vira denúncia de spam. Melhor esperar."
        : `Agora são ${h}h, fora do horário comercial (8h às 19h). Mensagem fria fora de hora vira denúncia de spam. Atenção também ao fuso do país do lead.`;
    } else el.hidden = true;
  }

  function cartaoFila(item, tipo = "abertura") {
    const l = item.lead, m = item.mensagem;
    if (!m) return "";
    return `<article class="item-fila" data-id="${l.id}" data-template="${m.templateId}" data-tipo="${tipo}">
      <header>${scoreHtml(l.score.total)}<div><div class="nome">${esc(l.nome)}</div>
        <div class="meta">${esc([l.categoria, l.bairro, l.cidade].filter(Boolean).join(" · "))}${l.nota != null ? ` · ★ ${String(l.nota).replace(".", ",")} (${fmt(l.qtdAvaliacoes)})` : ""}</div></div>
        <span class="camada ${l.camada}">${l.camada}</span></header>
      <textarea class="input" aria-label="Mensagem">${esc(m.corpo)}</textarea>
      <footer>
        <a class="btn verde sm" data-act="abrir" href="${esc(m.link || "#")}" target="_blank" rel="noopener">Abrir no WhatsApp</a>
        <button class="btn sm" data-act="enviado">Marquei como enviado</button>
        <button class="btn btn-ghost sm" data-act="pular">Pular</button>
        <span class="tpl">${esc(m.template)}${l.tipoTelefone === "indefinido" ? " · número pode não ter WhatsApp" : ""}</span>
      </footer></article>`;
  }

  async function montarFila() {
    avisoHorario();
    const q = new URLSearchParams({ limite: $("#q-limite").value, corte: $("#q-corte").value, minScore: $("#q-score").value, cidade: $("#q-cidade").value });
    try {
      const [r] = await Promise.all([api(`/fila?${q}`), carregarCidades()]);
      $("#fila").innerHTML = r.fila.map((x) => cartaoFila(x)).join("");
      $("#fila-vazia").hidden = r.fila.length > 0;
      medidor(r.enviadasHoje, r.tetoDiario);
      carregadas.fila = true;
    } catch (e) { toast(e.message); }
  }
  $("#montar-fila").addEventListener("click", montarFila);

  $("#montar-followup").addEventListener("click", async () => {
    const lista = await api("/fila/followup");
    $("#followup").innerHTML = lista.length ? lista.map((x) => cartaoFila(x, "followup")).join("") : `<p class="help">Ninguém pra follow-up agora.</p>`;
  });

  function linkComTexto(card) {
    const a = $("[data-act=abrir]", card);
    const base = a.getAttribute("href").split("?")[0];
    a.href = `${base}?text=${encodeURIComponent($("textarea", card).value)}`;
  }
  document.addEventListener("input", (e) => { const c = e.target.closest(".item-fila"); if (c && e.target.tagName === "TEXTAREA") linkComTexto(c); });

  document.addEventListener("click", async (e) => {
    const b = e.target.closest(".item-fila [data-act]");
    if (!b) return;
    const card = b.closest(".item-fila");
    if (b.dataset.act === "abrir") { card.dataset.aberto = "1"; return; }
    if (b.dataset.act === "pular") { card.remove(); return; }
    if (b.dataset.act === "enviado") {
      if (!card.dataset.aberto && !confirm("Você ainda não abriu esta conversa por aqui. Marcar como enviada mesmo assim?")) return;
      try {
        const r = await api(`/leads/${card.dataset.id}/enviado`, { method: "POST", body: { templateId: Number(card.dataset.template) || null, corpo: $("textarea", card).value, tipo: card.dataset.tipo } });
        card.classList.add("feito");
        b.disabled = true; b.textContent = "Enviado";
        medidor(r.enviadasHoje, r.tetoDiario);
        if (r.enviadasHoje >= r.tetoDiario) toast(`Chegou a ${r.enviadasHoje} hoje. Pare por aqui pra não restringir o número.`);
      } catch (err) { toast(err.message); }
    }
  });

  // WhatsApp Web chat list reader: only reads the list on the left, opens nothing.
  const SNIPPET = `(() => {
  const itens = [...document.querySelectorAll('#pane-side [role="listitem"], #pane-side [role="row"]')];
  return JSON.stringify(itens.map((el) => {
    const s = [...el.querySelectorAll("span[title]")];
    const icones = [...el.querySelectorAll("svg title")].map((t) => t.textContent || "");
    const minha = icones.some((t) => /wds-ic-(read|deliver|sent|check|pending|clock|time|msg)/i.test(t)) || !!el.querySelector('[data-icon*="check"]');
    const rascunho = /(^|\\n)\\s*(Draft|Rascunho|Borrador):/i.test(el.innerText);
    return { titulo: s[0]?.title || "", previa: s[1]?.title || "", deles: !minha && !rascunho };
  }).filter((c) => c.titulo));
})();`;
  $("#snippet").textContent = SNIPPET;
  $("#copiar-snippet").addEventListener("click", async () => { await navigator.clipboard.writeText(SNIPPET); toast("Código copiado."); });

  async function respostasLote(gravar) {
    let conversas;
    try { conversas = JSON.parse($("#conversas").value.trim().replace(/^'|'$/g, "")); }
    catch { toast("Não consegui ler: cole exatamente o que o console devolveu."); return; }
    const r = await api("/respostas/lote", { method: "POST", body: { conversas, gravar } });
    $("#respostas-achadas").innerHTML = r.achados.length
      ? r.achados.map((a) => `<li><small>${esc(a.nome)} · ${a.automatica ? "resposta automática" : "resposta de gente"}</small>${esc(a.previa)}</li>`).join("")
      : `<li>Nenhum lead contatado respondeu nessa lista.</li>`;
    if (gravar) toast(`${r.achados.length} respostas gravadas.`);
  }
  $("#conferir-respostas").addEventListener("click", () => respostasLote(false));
  $("#gravar-respostas").addEventListener("click", () => respostasLote(true));

  // ───────────────────────── templates ─────────────────────────
  let templates = [];
  const EXEMPLO = { nome: "Studio Bela Unha | Manicure", categoria: "Manicure", cidade: "Belo Horizonte", bairro: "Savassi", nota: 4.9, qtdAvaliacoes: 48, igHandle: "studiobelaunha" };

  function renderLocal(corpo, idioma) {
    const nota = idioma === "en" ? "4.9" : "4,9";
    const vars = { nome: "Studio Bela Unha", primeiro_nome: "Studio", categoria: EXEMPLO.categoria, cidade: EXEMPLO.cidade, bairro: EXEMPLO.bairro, nota, qtd_avaliacoes: "48", ig_handle: EXEMPLO.igHandle };
    return corpo.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => vars[k] ?? m);
  }

  async function carregarTemplates() {
    const r = await api("/templates");
    templates = r.templates;
    const TIPO = { abertura: "primeira mensagem", poucas: "primeira, poucas avaliações", followup: "follow-up", outro: "outra" };
    const LINGUA = { pt: "português", es: "espanhol", en: "inglês" };
    $("#lista-tpl").innerHTML = templates.map((t) => `<li data-id="${t.id}" class="${String(t.id) === $("#tpl-id").value ? "on" : ""}"><b>${esc(t.nome)}</b><span>${LINGUA[t.idioma] || t.idioma} · ${TIPO[t.tipo] || t.tipo}</span></li>`).join("");
    $("#chips-var").innerHTML = r.variaveis.map((v) => `<button type="button" class="chip-var" data-var="${v}">{{${v}}}</button>`).join("");
    carregadas.templates = true;
    atualizarPrevia();
  }

  function editar(t) {
    $("#tpl-id").value = t?.id ?? "";
    $("#tpl-nome").value = t?.nome ?? "";
    $("#tpl-idioma").value = t?.idioma ?? "pt";
    $("#tpl-tipo").value = t?.tipo ?? "abertura";
    $("#tpl-corpo").value = t?.corpo ?? "";
    $("#tpl-titulo").textContent = t ? "Editar mensagem" : "Nova mensagem";
    $("#apagar-template").hidden = !t;
    $$("#lista-tpl li").forEach((li) => li.classList.toggle("on", t && li.dataset.id === String(t.id)));
    atualizarPrevia();
  }

  let validarTimer;
  function atualizarPrevia() {
    const corpo = $("#tpl-corpo").value;
    $("#tpl-previa").textContent = corpo ? renderLocal(corpo, $("#tpl-idioma").value) : "Escreva o texto ao lado.";
    clearTimeout(validarTimer);
    validarTimer = setTimeout(async () => {
      if (!corpo.trim()) { $("#tpl-erros").innerHTML = ""; return; }
      const v = await api("/templates/validar", { method: "POST", body: { corpo } });
      $("#tpl-erros").innerHTML = v.erros.map((e) => `<li>${esc(e)}</li>`).join("");
    }, 300);
  }
  ["#tpl-corpo", "#tpl-idioma"].forEach((s) => $(s).addEventListener("input", atualizarPrevia));
  $("#lista-tpl").addEventListener("click", (e) => { const li = e.target.closest("li[data-id]"); if (li) editar(templates.find((t) => String(t.id) === li.dataset.id)); });
  $("#novo-template").addEventListener("click", () => editar(null));
  $("#chips-var").addEventListener("click", (e) => {
    const b = e.target.closest("[data-var]"); if (!b) return;
    const ta = $("#tpl-corpo"), ins = `{{${b.dataset.var}}}`;
    ta.setRangeText(ins, ta.selectionStart, ta.selectionEnd, "end"); ta.focus(); atualizarPrevia();
  });
  $("#salvar-template").addEventListener("click", async () => {
    try {
      const r = await api("/templates", { method: "POST", body: {
        id: Number($("#tpl-id").value) || undefined, nome: $("#tpl-nome").value.trim(), corpo: $("#tpl-corpo").value.trim(),
        idioma: $("#tpl-idioma").value, tipo: $("#tpl-tipo").value } });
      $("#tpl-id").value = r.id;
      toast("Mensagem salva.");
      await carregarTemplates();
      editar(templates.find((t) => t.id === r.id));
      carregadas.fila = false;
    } catch (e) { toast(e.message); }
  });
  $("#apagar-template").addEventListener("click", async () => {
    if (!confirm("Apagar esta mensagem? O histórico de envios continua, só perde o nome.")) return;
    await api(`/templates/${$("#tpl-id").value}`, { method: "DELETE" });
    editar(null); carregarTemplates();
  });

  // ───────────────────────── metrics ─────────────────────────
  async function carregarMetricas() {
    const m = await api("/metricas");
    const f = m.funil, max = Math.max(1, f.importados);
    const etapas = [["Importados", f.importados], ["Sem site", f.semSite], ["Com WhatsApp", f.comWhatsApp], ["Contatados", f.contatados], ["Responderam", f.responderam], ["Clientes", f.clientes]];
    $("#funil").innerHTML = etapas.map(([n, v]) => `<div><span>${n}</span><span class="barra"><i style="width:${(v / max) * 100}%"></i></span><b>${fmt(v)}</b></div>`).join("");
    $("#tbody-metricas").innerHTML = m.porTemplate.length ? m.porTemplate.map((t) => `<tr style="cursor:default">
      <td>${esc(t.template)}</td><td class="num">${fmt(t.enviados)}</td><td class="num">${fmt(t.responderam)}</td>
      <td class="num"><span class="taxa ${t.enviados >= 10 ? (t.taxa >= 0.1 ? "boa" : "fraca") : ""}">${(t.taxa * 100).toFixed(1).replace(".", ",")}%</span></td>
      <td class="num">${fmt(t.automaticas)}</td><td class="num">${fmt(t.clientes)}</td><td>${esc((t.desde || "").slice(0, 10))}</td></tr>`).join("")
      : `<tr style="cursor:default"><td colspan="7" class="vazio">Nenhuma mensagem enviada ainda.</td></tr>`;
    const maxDia = Math.max(1, ...m.porDia.map((d) => d.n));
    $("#por-dia").innerHTML = m.porDia.length ? m.porDia.map((d) => `<div><span>${esc(d.dia)}</span><span class="barra"><i style="width:${(d.n / maxDia) * 100}%"></i></span><b>${d.n}</b></div>`).join("") : `<p class="help">Nada ainda.</p>`;
  }

  // ───────────────────────── boot ─────────────────────────
  saude();
  setInterval(saude, 30000);
  mostrar();
})();
