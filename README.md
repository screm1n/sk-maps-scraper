<img src="assets/logo-sk-512.png" alt="Logo do SK Maps Scraper" width="120" align="right">

# SK Maps Scraper

**Raspa o Google Maps de graça, rodando na sua máquina, e transforma a lista em clientes.**

Sem API paga, sem crédito e sem limite por mês: o motor de raspagem roda num container Docker
no seu PC. Você busca "barbearia em Lisboa" e o SK Maps Scraper separa quem não tem site, dá
uma nota pra cada negócio, diz se o telefone é celular e monta a fila de WhatsApp com a
mensagem pronta.

![Mapa com o resultado de uma busca](docs/mapa.png)

## Como funciona

```mermaid
flowchart LR
    A[O que + onde] --> B[Motor local<br>raspa o Google Maps]
    B --> C[Importar]
    C --> D[Camada A/B/C<br>nota 0 a 100<br>celular ou fixo]
    D --> E[Fila do WhatsApp]
    E --> F[Respostas e métricas]
    F --> G[Proposta em PDF]
```

1. **Raspa.** No Mapa ou no Painel, você digita o tipo de negócio e o lugar (no Mapa, dá pra
   só clicar no bairro ou na cidade). O motor abre o
   Google Maps no seu PC e coleta nome, telefone, site, nota, avaliações, endereço e e-mail.
2. **Qualifica.** Em Leads, você importa a busca. Cada negócio ganha uma camada e uma nota de
   0 a 100, e o telefone é lido pelas regras do país dele.

   | Camada | O que tem no Google | Leitura |
   |---|---|---|
   | **A** | nada | invisível online |
   | **B** | só Instagram, linktree, WhatsApp ou página de agendamento (Booksy, Square, Vagaro...) | tem público, não tem site |
   | **C** | site próprio | vai pra **Revisar sites**: se o site for ruim, a oferta vira refazer |

3. **Aborda.** A fila mostra os melhores leads sem site, com a mensagem na língua de cada um
   (português, espanhol ou inglês). Você abre o WhatsApp com o texto pronto e envia.
4. **Mede e fecha.** Registra as respostas (resposta automática não conta), vê qual mensagem
   responde mais e gera a proposta em PDF com os dados reais do lead.

Reimportar uma busca só atualiza os dados do Google. Status, notas e histórico ficam.

![Leads com camada, nota e tipo de telefone](docs/leads.png)

![Fila do WhatsApp com as mensagens prontas](docs/fila.png)

## Revisar sites: quem já tem site também pode ser cliente

Negócio com site próprio não some da lista. Em **Revisar sites** ele aparece com o link pra
abrir e uma checagem automática que adianta o trabalho: o site abre? tem cadeado (HTTPS)?
foi feito pra celular? tem botão de WhatsApp? o rodapé parou em que ano? demora pra carregar?

Você abre, olha e decide com um clique (ou as teclas **R** e **B**): **ruim, refazer** ou
**bom, descartar**. Quem você marca como ruim ganha pontos na nota, entra na fila do WhatsApp
com uma mensagem própria ("hoje o site traz cliente ou fica mais como cartão de visita?") e a
proposta muda pra refazer o site, citando os problemas que a checagem achou.

![Revisar sites, com a checagem automática de cada um](docs/sites.png)

## Onde raspar: Local, Apify ou Google Places

No topo de toda busca (no Mapa e no Painel) tem o seletor **Onde raspar**. A fonte escolhida
vale pras próximas buscas, e o resto do app não muda: o resultado chega no mesmo formato e
entra nos Leads do mesmo jeito.

![Seletor Onde raspar, com saldo e estimativa](docs/fonte.png)

| Fonte | Custo | Quando usar |
|---|---|---|
| **Local** | grátis, sem limite | o dia a dia: o motor roda no seu PC |
| **Apify** | crédito do Apify (US$ 5 grátis por mês, cerca de 1.000 empresas) | volume grande, ou quando o Google bloquear o seu IP: o Apify troca de IP |
| **Google Places** | API oficial; 1.000 consultas grátis por mês, cada uma traz até 20 empresas | quando quiser a fonte oficial (precisa de faturamento ativo no Google Cloud) |

Escolheu Apify ou Google Places e ainda não tem a chave? Abre uma janela com o passo a passo
pra pegar a chave, que é testada antes de salvar. Com a chave salva, o seletor mostra o saldo
(no Apify, o crédito que sobra no mês; no Google, as consultas grátis restantes, contadas por
aqui) e a estimativa de custo da busca que você está montando.

A chave fica só na sua máquina, no banco local. Se preferir, dá pra colocar `APIFY_TOKEN` e
`GOOGLE_MAPS_API_KEY` no `.env`. E-mails só saem na raspagem Local.

## Começar

Precisa do [Docker Desktop](https://www.docker.com/products/docker-desktop).

```bash
git clone https://github.com/screm1n/sk-maps-scraper.git
```

```bash
cd sk-maps-scraper
```

```bash
docker compose up -d --build
```

Abre em **http://localhost:8080**. Mapa e Painel pra raspar, **Leads** pra qualificar e abordar.

Quer ver as telas antes de instalar o Docker? Com Node 22.13 ou mais novo, um scraper de
exemplo faz o papel do motor:

```bash
cd leads && npm install && node test/scraper-falso.js
```

E, em outro terminal:

```bash
cd leads && npm start
```

Abre em http://localhost:3000/leads.

### Atalho de app no Windows

```bash
powershell -ExecutionPolicy Bypass -File atalho\criar-atalhos.ps1
```

Cria o atalho **SK Maps Scraper** na Área de Trabalho e no menu Iniciar. Um clique sobe o que
precisa e abre o app numa janela própria, sem abas. Os servidores ficam ligados depois que você
fecha a janela: o atalho **Parar SK Maps Scraper**, no Iniciar, desliga tudo.

**Sem Docker, raspando de graça mesmo assim:** baixe o motor como programa do Windows. O script
pega o release oficial do gosom e só aceita o arquivo se o SHA-256 bater com o publicado.

```bash
powershell -ExecutionPolicy Bypass -File atalho\baixar-motor.ps1
```

A partir daí o atalho liga esse motor (só nesta máquina, em `127.0.0.1:8080`). Na primeira busca
ele baixa sozinho o navegador que usa pra raspar. Sem Docker e sem o motor, o atalho abre com o
scraper de exemplo, e Apify e Google Places funcionam igual.

Com o [Claude Code](https://claude.com/claude-code) aberto na pasta, dá pra pedir em português
mesmo: *"raspa dentistas em Curitiba"*. Também tem os comandos `/scrape`, `/scrape-batch`,
`/scrape-setup` e `/scrape-jobs`. O passo a passo detalhado está no [SETUP.md](SETUP.md).

## As telas

| Tela | Pra quê |
|---|---|
| **Mapa** e **Painel** | Criar buscas, acompanhar e ver os resultados no mapa ou em tabela |
| **Leads** | Lista com camada, nota e tipo de telefone. Clique num lead pra ver de onde vem a nota, registrar resposta e gerar proposta |
| **Importar buscas** | Transforma uma busca terminada em leads |
| **Fila do WhatsApp** | Mensagens prontas, follow-up de 48h e o medidor de envios do dia |
| **Mensagens** | Seus textos com `{{nome}}`, `{{nota}}`, `{{qtd_avaliacoes}}`, com checagem ao vivo |
| **Métricas** | Funil e taxa de resposta por mensagem |

## Use com cuidado

- **Raspar o Google Maps vai contra os termos do Google.** Faça uma busca por vez e comece
  com profundidade baixa. Exagerar bloqueia seu IP por algumas horas (sua conta Google não é
  afetada). Pra volume grande, use proxies.
- **Mensagem fria é tratamento de dado pessoal** (LGPD no Brasil, RGPD na Europa). Mande no
  máximo 10 a 15 primeiras mensagens por dia, com minutos entre elas, sempre com uma saída, e
  bloqueie quem pedir pra parar. Nos EUA, SMS frio é proibido por lei.

## Por dentro

```
docker-compose.yml   motor de raspagem + servidor de leads + nginx na porta 8080
frontend/            telas: Mapa, Painel, Leads e Proposta
leads/               servidor de leads: Node 22, SQLite embutido, uma dependência
  src/buscas.js      a API de buscas das três fontes (Local, Apify, Google Places)
  src/dominio/       as regras: camadas, nota, telefone, mensagens, respostas automáticas
  test/              npm test (regras e fluxo completo) e o scraper de exemplo
scripts/             scrape.py e scrape.sh pra raspar pela linha de comando
.claude/             skill e comandos pro Claude Code
```

Os dados ficam no seu PC: as buscas no volume `gmaps_data` e os leads no volume `leads_data`.
`docker compose down -v` apaga tudo.

## Créditos

- **Motor de raspagem:** [google-maps-scraper](https://github.com/gosom/google-maps-scraper),
  de **Georgios Komninos** ([@gosom](https://github.com/gosom)), licença MIT. É ele que faz a
  raspagem de verdade. Se o projeto te ajudou, deixa uma ⭐ no repositório dele.
- **Base do kit** (Docker, scripts, Mapa e Painel): Google Maps Scraper Kit, de Mahan
  ([@mahanjafari-dev](https://github.com/mahanjafari-dev)) e Felipe Nunes
  ([@felipenunes07](https://github.com/felipenunes07)), licença MIT.
- Licenças completas em [LICENSE](LICENSE) e [CREDITS.md](CREDITS.md).
