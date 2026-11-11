/* Builds the 3-page proposal from the lead's real data (rating, reviews, layer, how many
   businesses of the same category in the city have a site). Ctrl+P turns it into a PDF. */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const MIN_AVALIACOES = 10;
  /** Mercado Pago payment-link installment fees (official table, Nov 2026), passed on to the buyer. */
  const TAXAS_MP = { 2: 2.53, 3: 4.62, 4: 6.69, 5: 8.66, 6: 9.96, 7: 11.24, 8: 12.5, 9: 13.73, 10: 14.93, 11: 16.12, 12: 17.28 };

  const nomeCurto = (n) => String(n || "").split(/\s+[|\-–—·]\s+/)[0].trim() || n;
  const notaBr = (n) => Number(n).toFixed(1).replace(".", ",");
  const reais = (v) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: Number(v) % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const dataExtenso = (d) => `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
  function tomClaro(hex, mistura = 0.9) {
    const h = hex.replace("#", "");
    const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).map((v) => Math.round(v + (255 - v) * mistura));
    return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  }

  let lead = null, lev = null, imagem = null, celular = null;
  let logo = (() => { try { return localStorage.getItem("proposta:logo"); } catch { return null; } })();
  const salvo = (() => { try { return JSON.parse(localStorage.getItem("proposta:config") || "{}"); } catch { return {}; } })();
  for (const k of ["marca", "cheio", "vista", "pix", "cartao", "mensal", "validade", "gratis", "taxaedicao"]) if (salvo[k] != null) $(`#e-${k}`).value = salvo[k];
  if (salvo.diagnostico === false) $("#e-diagnostico").checked = false;

  /** Problems the site check found, as short lines for "O que eu encontrei". */
  const PROBLEMAS = [
    [/celular/, "Celular", "o site não foi feito pra celular, que é onde a maioria abre."],
    [/cadeado/, "Inseguro", "não tem cadeado: o navegador avisa \"não seguro\" pra quem entra."],
    [/lento|não respondeu/, "Lento", "demora pra abrir, e quem está no celular desiste antes."],
    [/WhatsApp/, "Contato", "não tem um botão pra pessoa te chamar no WhatsApp na hora."],
    [/rodapé parado/, "Parado", "o rodapé parou no tempo, e isso passa a ideia de abandono."],
    [/não abre/, "Fora do ar", "o endereço do seu site não está abrindo."],
    [/título/, "Invisível", "o site aparece mal no Google, sem um título que diga o que você faz."],
  ];
  function problemasDoSite() {
    const falhas = (lead.siteCheck?.sinais || []).filter((s) => !s.ok).map((s) => s.texto);
    return PROBLEMAS.filter(([re]) => falhas.some((t) => re.test(t))).map(([, n, p]) => [n, p]);
  }

  function textos() {
    if (lead.camada === "C") return textosRefazer();
    const nome = nomeCurto(lead.nome);
    const poucas = (lead.qtdAvaliacoes || 0) < MIN_AVALIACOES || lead.nota == null;
    const soRede = lead.camada === "B";
    const gancho = poucas ? [`${nome} aparece no Google.`, "Mas não tem site."] : [`Nota ${notaBr(lead.nota)} em ${lead.qtdAvaliacoes} avaliações.`, "Nenhum site no Google."];
    const destino = soRede
      ? "quem te encontra na busca cai direto na rede social, e ela não responde o que essa pessoa quer saber antes de chamar"
      : "quem te encontra na busca só vê o endereço e o telefone, sem nenhum lugar pra conhecer o seu trabalho antes de decidir";
    const abertura = poucas
      ? `Você já está no Google, o que muita gente ainda não conseguiu. Só que ${destino}. Esta proposta coloca um site seu entre a busca e o seu WhatsApp.`
      : `Você já tem o que quase ninguém tem no Google: uma reputação de verdade. Só que ${destino}. Esta proposta coloca um site seu entre a busca e o seu WhatsApp.`;

    const linhas = [];
    if (!poucas) linhas.push([notaBr(lead.nota), `de nota no Google, com ${lead.qtdAvaliacoes} avaliações. Reputação de quem já entrega.`]);
    if (lev) {
      // The number only sells if the sentence says what it means for them.
      const conclusao = lev.comSite / lev.total < 0.35 ? "Ter o seu já te coloca entre os poucos." : "Quem não tem fica pra trás na comparação.";
      linhas.push([`${lev.comSite} de ${lev.total}`, `negócios do seu ramo que eu mapeei em ${lead.cidade} têm site próprio. ${conclusao}`]);
    }
    linhas.push(soRede ? ["Sem site", "o seu perfil no Google leva pra uma rede social ou página de terceiros. Não existe um site seu."]
      : ["Nenhum link", "no seu perfil do Google. Quem te acha não tem pra onde ir."]);

    const segundo = soRede
      ? ["A rede social não responde quem ainda não te conhece", "Onde fica, o que você faz, como marcar. O feed mostra o dia a dia, o site responde isso em dez segundos."]
      : ["Sem site, a busca termina no endereço", "Quem te acha no mapa não tem como ver o seu trabalho, então vai olhar o próximo resultado."];
    const motivos = [
      ["Quem procura no Google decide rápido", "A pessoa compara dois ou três resultados e chama quem passa mais confiança. Quem tem site sai na frente de quem não tem."],
      segundo,
      ["Profissional com site vende mais fácil", "Uma presença organizada muda a percepção antes do primeiro contato, e isso impacta diretamente na sua facilidade de vender."],
    ];
    const itens = [
      ["Site profissional", "O da prévia, ajustado do seu jeito."], ["Seus trabalhos e avaliações", "Fotos reais e a nota do Google em destaque."],
      ["Botão direto pro WhatsApp", "Quem decidiu fala com você na hora."], ["Endereço com mapa", "O mapa do Google dentro do site."],
      ["Domínio próprio", "Seu nome no endereço, primeiro ano incluso."], ["Google Meu Negócio revisado", "Perfil completo e ligado ao site."],
      ["Ajustes inclusos", "Textos, fotos e serviços do seu jeito."], ["Suporte no WhatsApp", "Mudou algo, me manda que eu atualizo."],
    ];
    return { gancho, abertura, linhas, titulo: soRede ? "Por que um site, se você já tem rede social" : "Por que ir além do perfil no Google", motivos, itens };
  }

  /** The lead already has a site: the offer is to redo it. */
  function textosRefazer() {
    const nome = nomeCurto(lead.nome);
    const poucas = (lead.qtdAvaliacoes || 0) < MIN_AVALIACOES || lead.nota == null;
    const problemas = problemasDoSite();
    const gancho = poucas ? [`${nome} tem site.`, "Mas ele não trabalha por você."] : [`Nota ${notaBr(lead.nota)} em ${lead.qtdAvaliacoes} avaliações.`, "O site não acompanha."];
    const abertura = `Você já tem site, o que muita gente ainda não tem. Só que quem chega por ele pelo Google ${problemas.length
      ? "encontra problemas que fazem a pessoa voltar pra busca e chamar o próximo"
      : "não encontra um caminho rápido até o seu WhatsApp"}. Esta proposta troca o site atual por um feito pra trazer cliente.`;
    const linhas = [];
    if (!poucas) linhas.push([notaBr(lead.nota), `de nota no Google, com ${lead.qtdAvaliacoes} avaliações. A reputação é melhor que o site.`]);
    linhas.push(...problemas.slice(0, poucas ? 3 : 2));
    if (linhas.length < 2) linhas.push(["Contato", "o caminho até falar com você não está claro no site."]);
    return {
      gancho, abertura, linhas,
      titulo: "Por que refazer um site que já existe",
      motivos: [
        ["Quem procura no Google decide rápido", "A pessoa compara dois ou três resultados e chama quem passa mais confiança. Um site datado faz você perder pra quem tem um melhor."],
        ["Site velho espanta quem já ia comprar", "Quem abre um site lento, sem botão de contato ou quebrado no celular volta pro Google e chama o próximo."],
        ["Profissional com site bom vende mais fácil", "Uma presença organizada muda a percepção antes do primeiro contato, e isso impacta diretamente na sua facilidade de vender."],
      ],
      itens: [
        ["Site novo", "Feito pra celular, rápido e com a sua marca."], ["Seus trabalhos e avaliações", "Fotos reais e a nota do Google em destaque."],
        ["Botão direto pro WhatsApp", "Quem decidiu fala com você na hora."], ["Endereço com mapa", "O mapa do Google dentro do site."],
        ["Mesmo domínio", "Mantenho o seu endereço, sem perder quem já te acha."], ["Google Meu Negócio revisado", "Perfil completo e ligado ao site."],
        ["Ajustes inclusos", "Textos, fotos e serviços do seu jeito."], ["Suporte no WhatsApp", "Mudou algo, me manda que eu atualizo."],
      ],
    };
  }

  function render() {
    if (!lead) return;
    const v = (id) => $(`#e-${id}`).value;
    const cor = v("cor");
    document.documentElement.style.setProperty("--acento", cor);
    document.documentElement.style.setProperty("--acento-fundo", tomClaro(cor));
    const marca = v("marca") || "Seu Estúdio";
    const vista = Number(v("vista")) || 0;
    const cheio = Number(v("cheio")) || 0;
    const desconto = cheio > vista ? cheio - vista : 0;
    const pix = Math.max(1, Number(v("pix")) || 1);
    const cartao = Math.max(1, Number(v("cartao")) || 1);
    const centavos = (x) => Math.ceil(x * 100) / 100;
    const parcelasCartao = Array.from({ length: Math.min(cartao, 12) - 1 }, (_, i) => i + 2)
      .map((n) => [n, centavos(vista * (1 + TAXAS_MP[n] / 100) / n)]);
    const recado = v("recado").trim();
    const gratis = Math.max(0, Number(v("gratis")) || 0);
    const taxaEdicao = Math.max(0, Number(v("taxaedicao")) || 0);
    const comDiagnostico = $("#e-diagnostico").checked;
    const mensal = Number(v("mensal")) || 0;
    const validadeDias = Number(v("validade")) || 0;
    const site = v("site").trim();
    const hoje = new Date();
    const validade = new Date(hoje.getTime() + validadeDias * 864e5);
    const t = textos();
    // The included items follow the conditions: free edits replace "suporte", and without a
    // monthly fee there is no own domain (it would need a yearly renewal).
    t.itens = t.itens.map(([b, d]) => {
      if (b === "Suporte no WhatsApp" && gratis) return [`${gratis} ${gratis > 1 ? "meses" : "mês"} de edição grátis`, `Depois de publicado, mudanças sem custo por ${gratis > 1 ? `${gratis} meses` : "30 dias"}.`];
      if (b === "Ajustes inclusos" && gratis) return [b, "Tudo o que você quiser mudar antes de publicar."];
      return [b, d];
    }).filter(([b]) => mensal || b !== "Domínio próprio"); // without a monthly fee the site stays on the free address
    const condicoes = [];
    if (!mensal) condicoes.push(["Sem mensalidade", "Pagou uma vez, o site fica no ar permanentemente, sem mensalidade."]);
    if (gratis) condicoes.push([`${gratis} ${gratis > 1 ? "meses" : "mês"} de edição grátis`, `Qualquer mudança ${gratis > 1 ? `nos primeiros ${gratis} meses` : "no primeiro mês"} depois de publicar sai sem custo.`]);
    if (taxaEdicao) condicoes.push([`Depois, R$ ${reais(taxaEdicao)} por conjunto de mudanças`, "Só quando você pedir. Sem pedido, sem cobrança."]);
    const cliente = nomeCurto(lead.nome);
    const local = [lead.bairro, lead.cidade].filter(Boolean).join(", ");
    const totalFolhas = comDiagnostico ? 3 : 2;
    const rodape = (n) => `<footer class="rodape"><span>${esc(marca)}</span><span>0${n - (comDiagnostico ? 0 : 1)} / 0${totalFolhas}</span></footer>`;
    const topo = (direita) => `<header class="topo"><div class="marca">${logo ? `<img src="${logo}" alt="">` : ""}${esc(marca)}</div><div class="meta">${direita}</div></header>`;
    const previa = imagem || celular
      ? `<div class="mockup">
          ${imagem ? `<div class="note${celular ? "" : " so"}"><div class="tela"><img src="${imagem}" alt="Prévia do site no computador"></div><div class="base"></div></div>` : ""}
          ${celular ? `<div class="cel"${imagem ? "" : ' style="position:static;margin:0 auto;width:34%"'}><div class="tela-cel"><img src="${celular}" alt="Prévia do site no celular"></div><div class="ilha"></div></div>` : ""}
        </div>`
      : `<div class="janela"><div class="barra"><i></i><i></i><i></i><small>${esc(site.replace(/^https?:\/\//, "").replace(/\/$/, "") || "sua prévia")}</small></div><div class="sem-print">Escolha os prints da prévia no painel ao lado</div></div>`;

    $("#folhas").innerHTML = (comDiagnostico ? `
      <section class="folha">
        ${topo(`Proposta comercial<br>${dataExtenso(hoje)}`)}
        <p class="para">Para <b>${esc(cliente)}</b>${local ? ` · ${esc(local)}` : ""}</p>
        <h1 class="gancho">${esc(t.gancho[0])}<em>${esc(t.gancho[1])}</em></h1>
        <p class="abre">${esc(t.abertura)}</p>
        <div class="achados"><h3>O que eu encontrei</h3>
          ${t.linhas.map(([n, p]) => `<div class="linha-dado"><span class="numero">${esc(n)}</span><p>${esc(p)}</p></div>`).join("")}</div>
        <div class="chamada"><p>A prévia do seu site já está pronta.</p><span>Ela está na próxima página</span></div>
        ${rodape(1)}
      </section>` : "") + `
      <section class="folha">
        ${topo(esc(cliente))}
        <h2 style="margin-top:12mm">${esc(t.titulo)}</h2>
        <div class="motivos">${t.motivos.map(([b, p], i) => `<div class="motivo"><span class="n">${i + 1}</span><div><b>${esc(b)}</b><p>${esc(p)}</p></div></div>`).join("")}</div>
        <div class="previa">${previa}
          <div class="legenda"><span>Feita com as suas fotos, os seus serviços e a sua marca.</span>${site ? `<a href="${esc(site)}">Abrir a prévia</a>` : ""}</div></div>
        ${rodape(2)}
      </section>
      <section class="folha">
        ${topo(esc(cliente))}
        <h2 style="margin-top:7mm">O que está incluso</h2>
        <div class="incluso">${t.itens.map(([b, p]) => `<div class="item"><b>${esc(b)}</b><p>${esc(p)}</p></div>`).join("")}</div>
        <div class="investimento"><h2>Investimento${mensal ? "" : ` <span style="font-size:13pt;font-weight:500;letter-spacing:-0.01em;color:var(--suave)">(Pagamento único, site permanente)</span>`}</h2>
          ${recado ? `<p class="recado">${esc(recado)}</p>` : ""}
          ${desconto ? `<div class="oferta"><s>De R$ ${reais(cheio)}</s><b>por R$ ${reais(vista)}</b><span class="selo">Desconto de R$ ${reais(desconto)}</span></div>` : ""}
          <div class="cartoes" style="--colunas:${1 + (pix > 1) + (cartao > 1)}">
            <div class="cartao forte"><small>À vista no Pix</small><div class="valor"><sup>R$</sup>${reais(vista)}</div><p>Pagamento único.</p></div>
            ${pix > 1 ? `<div class="cartao"><small>Pix em ${pix}x</small><div class="valor"><sup>${pix}x R$</sup>${reais(vista / pix)}</div><p>Sem acréscimo, metade agora e metade no mês que vem.</p></div>` : ""}
            ${cartao > 1 ? `<div class="cartao"><small>Cartão de crédito, qualquer bandeira</small>
              <ul class="tabela-parcelas">${parcelasCartao.map(([n, val]) => `<li><span>${n}x</span><b>R$ ${reais(val)}</b></li>`).join("")}</ul>
              <p>Por link de pagamento do Mercado Pago, que aceita todas as bandeiras. Valores já com o acréscimo.</p></div>` : ""}
          </div>
          ${condicoes.length ? `<div class="condicoes" style="--colunas:${condicoes.length}">${condicoes.map(([b, d]) => `<div><b>${esc(b)}</b><p>${esc(d)}</p></div>`).join("")}</div>` : ""}
          ${mensal ? `<p class="extra">Opcional: <b>manutenção por R$ ${reais(mensal)}/mês</b>, com domínio, hospedagem, backup e as alterações do mês inclusos.</p>` : ""}
          ${validadeDias ? `<p class="extra">Proposta válida até <b>${validade.toLocaleDateString("pt-BR")}</b>.</p>` : ""}
        </div>
        ${rodape(3)}
      </section>`;
    document.title = `Proposta para ${cliente}`;
    try { localStorage.setItem("proposta:config", JSON.stringify({ marca, cheio: v("cheio"), vista, pix, cartao, mensal, validade: v("validade"), gratis, taxaedicao: taxaEdicao, diagnostico: comDiagnostico })); } catch { /* private mode */ }
  }

  $("#editor").addEventListener("input", render);
  const lerImagem = (id, pronto) => $(id).addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { pronto(r.result); render(); };
    r.readAsDataURL(f);
  });
  lerImagem("#e-print", (d) => { imagem = d; });
  lerImagem("#e-celular", (d) => { celular = d; });
  // The logo is the same on every proposal, so it stays saved in this browser.
  lerImagem("#e-logo", (d) => { logo = d; try { localStorage.setItem("proposta:logo", d); } catch { /* too big or private mode */ } });
  $("#imprimir").addEventListener("click", () => window.print());

  const id = new URLSearchParams(location.search).get("lead");
  if (!id) { $("#ajuda").innerHTML = `<span class="erro">Abra a proposta a partir de um lead, na tela de Leads.</span>`; return; }
  fetch(`/leads-api/leads/${encodeURIComponent(id)}/proposta`).then((r) => r.ok ? r.json() : Promise.reject(r.status)).then((d) => {
    lead = d.lead; lev = d.levantamento;
    $("#ajuda").textContent = `${lead.nome}. Preencha o preço e o link da prévia: a proposta ao lado atualiza na hora.`;
    render();
  }).catch(() => { $("#ajuda").innerHTML = `<span class="erro">Não achei esse lead. O servidor de leads está rodando?</span>`; });
})();
