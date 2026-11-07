/* Builds the 3-page proposal from the lead's real data (rating, reviews, layer, how many
   businesses of the same category in the city have a site). Ctrl+P turns it into a PDF. */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const MIN_AVALIACOES = 10;

  const nomeCurto = (n) => String(n || "").split(/\s+[|\-–—·]\s+/)[0].trim() || n;
  const notaBr = (n) => Number(n).toFixed(1).replace(".", ",");
  const reais = (v) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: Number(v) % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const dataExtenso = (d) => `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
  function tomClaro(hex, mistura = 0.9) {
    const h = hex.replace("#", "");
    const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).map((v) => Math.round(v + (255 - v) * mistura));
    return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  }

  let lead = null, lev = null, imagem = null;
  const salvo = (() => { try { return JSON.parse(localStorage.getItem("proposta:config") || "{}"); } catch { return {}; } })();
  for (const k of ["marca", "assinatura", "vista", "parcelas", "mensal", "prazo", "validade"]) if (salvo[k] != null) $(`#e-${k}`).value = salvo[k];

  function textos() {
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
      ["Profissional com site cobra melhor", "Uma presença organizada muda a percepção antes do primeiro contato, e isso aparece no valor que você consegue cobrar."],
    ];
    const itens = [
      ["Site profissional", "O da prévia, ajustado do seu jeito."], ["Seus trabalhos e avaliações", "Fotos reais e a nota do Google em destaque."],
      ["Botão direto pro WhatsApp", "Quem decidiu fala com você na hora."], ["Endereço com mapa", "O mapa do Google dentro do site."],
      ["Domínio próprio", "Seu nome no endereço, primeiro ano incluso."], ["Google Meu Negócio revisado", "Perfil completo e ligado ao site."],
      ["Ajustes inclusos", "Textos, fotos e serviços do seu jeito."], ["Suporte no WhatsApp", "Mudou algo, me manda que eu atualizo."],
    ];
    return { gancho, abertura, linhas, titulo: soRede ? "Por que um site, se você já tem rede social" : "Por que ir além do perfil no Google", motivos, itens };
  }

  function render() {
    if (!lead) return;
    const v = (id) => $(`#e-${id}`).value;
    const cor = v("cor");
    document.documentElement.style.setProperty("--acento", cor);
    document.documentElement.style.setProperty("--acento-fundo", tomClaro(cor));
    const marca = v("marca") || "Seu Estúdio";
    const assinatura = v("assinatura") || marca;
    const vista = Number(v("vista")) || 0;
    const parcelas = Math.max(1, Number(v("parcelas")) || 1);
    const total = Number(v("total")) || vista;
    const mensal = Number(v("mensal")) || 0;
    const prazo = Number(v("prazo")) || 3;
    const validadeDias = Number(v("validade")) || 7;
    const site = v("site").trim();
    const hoje = new Date();
    const validade = new Date(hoje.getTime() + validadeDias * 864e5);
    const t = textos();
    const cliente = nomeCurto(lead.nome);
    const local = [lead.bairro, lead.cidade].filter(Boolean).join(", ");
    const rodape = (n) => `<footer class="rodape"><span>${esc(marca)}</span><span>0${n} / 03</span></footer>`;
    const topo = (direita) => `<header class="topo"><div class="marca">${esc(marca)}</div><div class="meta">${direita}</div></header>`;

    $("#folhas").innerHTML = `
      <section class="folha">
        ${topo(`Proposta comercial<br>${dataExtenso(hoje)}`)}
        <p class="para">Para <b>${esc(cliente)}</b>${local ? ` · ${esc(local)}` : ""}</p>
        <h1 class="gancho">${esc(t.gancho[0])}<em>${esc(t.gancho[1])}</em></h1>
        <p class="abre">${esc(t.abertura)}</p>
        <div class="achados"><h3>O que eu encontrei</h3>
          ${t.linhas.map(([n, p]) => `<div class="linha-dado"><span class="numero">${esc(n)}</span><p>${esc(p)}</p></div>`).join("")}</div>
        <div class="chamada"><p>A prévia do seu site já está pronta.</p><span>Ela está na próxima página</span></div>
        ${rodape(1)}
      </section>
      <section class="folha">
        ${topo(esc(cliente))}
        <h2 style="margin-top:12mm">${esc(t.titulo)}</h2>
        <div class="motivos">${t.motivos.map(([b, p], i) => `<div class="motivo"><span class="n">${i + 1}</span><div><b>${esc(b)}</b><p>${esc(p)}</p></div></div>`).join("")}</div>
        <div class="previa"><div class="janela">
          <div class="barra"><i></i><i></i><i></i><small>${esc(site.replace(/^https?:\/\//, "").replace(/\/$/, "") || "sua prévia")}</small></div>
          ${imagem ? `<img src="${imagem}" alt="Prévia do site">` : `<div class="sem-print">Escolha o print da prévia no painel ao lado</div>`}</div>
          <div class="legenda"><span>Feita com as suas fotos, os seus serviços e a sua marca.</span>${site ? `<a href="${esc(site)}">Abrir a prévia</a>` : ""}</div></div>
        ${rodape(2)}
      </section>
      <section class="folha">
        ${topo(esc(cliente))}
        <h2 style="margin-top:9mm">O que está incluso</h2>
        <div class="incluso">${t.itens.map(([b, p]) => `<div class="item"><b>${esc(b)}</b><p>${esc(p)}</p></div>`).join("")}</div>
        <div class="passos">
          <div class="passo"><small>Você aprova</small><p>Responde esta mensagem e me diz o que quer mudar.</p></div>
          <div class="passo"><small>Em até ${prazo} dias</small><p>Ajusto tudo e publico no seu endereço.</p></div>
          <div class="passo"><small>No ar</small><p>Você divulga, eu sigo cuidando do site.</p></div>
        </div>
        <div class="investimento"><h2>Investimento</h2>
          <div class="cartoes">
            <div class="cartao forte"><small>À vista no Pix</small><div class="valor"><sup>R$</sup>${reais(vista)}</div><p>Pagamento único.</p></div>
            <div class="cartao"><small>Parcelado</small><div class="valor"><sup>${parcelas}x R$</sup>${reais(total / parcelas)}</div><p>${total === vista ? `Sem juros, total de R$ ${reais(total)}.` : `Total de R$ ${reais(total)}.`}</p></div>
          </div>
          ${mensal ? `<p class="extra">Opcional: <b>manutenção por R$ ${reais(mensal)}/mês</b>, com domínio, hospedagem, backup e as alterações do mês inclusos.</p>` : ""}
          <p class="extra">Proposta válida até <b>${validade.toLocaleDateString("pt-BR")}</b>.</p>
        </div>
        <div class="chamada" style="margin-top:7mm;margin-bottom:5mm"><p>Pra começar, é só responder <b>sim</b> por aqui.</p><span>${esc(assinatura)}</span></div>
        ${rodape(3)}
      </section>`;
    document.title = `Proposta para ${cliente}`;
    try { localStorage.setItem("proposta:config", JSON.stringify({ marca, assinatura: v("assinatura"), vista, parcelas, mensal, prazo, validade: validadeDias })); } catch { /* private mode */ }
  }

  $("#editor").addEventListener("input", render);
  $("#e-print").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { imagem = r.result; render(); };
    r.readAsDataURL(f);
  });
  $("#imprimir").addEventListener("click", () => window.print());

  const id = new URLSearchParams(location.search).get("lead");
  if (!id) { $("#ajuda").innerHTML = `<span class="erro">Abra a proposta a partir de um lead, na tela de Leads.</span>`; return; }
  fetch(`/leads-api/leads/${encodeURIComponent(id)}/proposta`).then((r) => r.ok ? r.json() : Promise.reject(r.status)).then((d) => {
    lead = d.lead; lev = d.levantamento;
    $("#ajuda").textContent = `${lead.nome}. Preencha o preço e o link da prévia: a proposta ao lado atualiza na hora.`;
    render();
  }).catch(() => { $("#ajuda").innerHTML = `<span class="erro">Não achei esse lead. O servidor de leads está rodando?</span>`; });
})();
