// Scraping sources: Apify and Google Places rows in the scraper's format, and a whole
// external search with Apify simulated (no credit spent).
process.env.LEADS_DB = ":memory:";
process.env.APIFY_POLL_MS = "5";
process.env.GMAPS_URL = "http://127.0.0.1:9"; // nothing listens here: the local scraper is "down"

import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBanco } from "../src/db.js";
import { gravarConfig, mascarar } from "../src/config.js";
import { linhaDoApify } from "../src/fontes/apify.js";
import { linhaDoPlaces } from "../src/fontes/places.js";
import { paraCsv, lugaresPorProfundidade } from "../src/fontes/formato.js";
import { lerCSV, mapearLinha, importarBusca } from "../src/importar.js";
import { criarJob, listarJobs, obterJob, csvDoJob, estimar } from "../src/buscas.js";
import { escolherFonte } from "../src/fontes/index.js";
import { obterLead, listarLeads } from "../src/leads.js";

abrirBanco(":memory:");

const ITEM_APIFY = {
  title: "Studio Unha Bela", categoryName: "Manicure", address: "Rua A, 10 - Savassi, Belo Horizonte - MG",
  street: "Rua A, 10", city: "Belo Horizonte", state: "Minas Gerais", postalCode: "30130-000", countryCode: "BR",
  neighborhood: "Savassi", phone: "(31) 99876-5432", phoneUnformatted: "+5531998765432", website: "https://instagram.com/unhabela",
  totalScore: 4.9, reviewsCount: 48, location: { lat: -19.93, lng: -43.93 }, placeId: "ChIJ_APIFY_1", url: "https://maps.google.com/?cid=1",
  claimThisBusiness: true,
};

test("linha do Apify vira lead com bairro, país, celular e ficha sem dono", () => {
  const [linha] = lerCSV(paraCsv([linhaDoApify(ITEM_APIFY)]));
  const l = mapearLinha(linha);
  assert.equal(l.nome, "Studio Unha Bela");
  assert.equal(l.bairro, "Savassi");
  assert.equal(l.pais, "BR");
  assert.equal(l.telefone, "+5531998765432");
  assert.equal(l.naoReivindicado, true);
  assert.equal(l.qtdAvaliacoes, 48);
});

test("linha do Google Places vira lead com os componentes do endereço", () => {
  const p = {
    id: "places/abc", displayName: { text: "Barbearia do Zé" }, formattedAddress: "R. B, 20, Lisboa, Portugal",
    addressComponents: [
      { longText: "Arroios", shortText: "Arroios", types: ["sublocality_level_1", "sublocality"] },
      { longText: "Lisboa", shortText: "Lisboa", types: ["locality"] },
      { longText: "Portugal", shortText: "PT", types: ["country"] },
    ],
    location: { latitude: 38.72, longitude: -9.14 }, internationalPhoneNumber: "+351 912 345 678",
    rating: 4.7, userRatingCount: 80, primaryTypeDisplayName: { text: "Barbearia" }, businessStatus: "OPERATIONAL",
  };
  const l = mapearLinha(lerCSV(paraCsv([linhaDoPlaces(p)]))[0]);
  assert.deepEqual([l.nome, l.bairro, l.cidade, l.pais, l.telefone, l.nota], ["Barbearia do Zé", "Arroios", "Lisboa", "PT", "+351 912 345 678", 4.7]);
});

test("profundidade do formulário em empresas por termo, e estimativa de custo", () => {
  assert.deepEqual([1, 5, 10, 20].map(lugaresPorProfundidade), [20, 60, 120, 200]);
  assert.deepEqual(estimar("apify", 2, 5), { lugaresMax: 120, custoUsd: 0.63 });
  assert.deepEqual(estimar("places", 2, 5), { lugaresMax: 120, consultas: 6 });
  assert.equal(mascarar("apify_api_1234567890abcd"), "apif••••abcd");
});

test("trocar pra uma fonte sem chave pede configuração", async () => {
  assert.deepEqual(await escolherFonte("places"), { precisaConfigurar: true, fonte: "places" });
});

test("busca inteira pelo Apify simulado: cria, acompanha, termina e importa", async () => {
  const chamadas = [];
  const fetchOriginal = globalThis.fetch;
  let consultas = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    chamadas.push(`${init.method || "GET"} ${u.replace(/token=[^&]+/, "token=***")}`);
    const json = (d) => new Response(JSON.stringify(d), { status: 200, headers: { "content-type": "application/json" } });
    if (u.startsWith("http://127.0.0.1:9")) throw new TypeError("fetch failed"); // local scraper down
    if (u.includes("/acts/compass~crawler-google-places/runs")) {
      const corpo = JSON.parse(init.body);
      assert.deepEqual(corpo.searchStringsArray, ["manicure em Belo Horizonte"]);
      assert.equal(corpo.maxCrawledPlacesPerSearch, 20);
      return json({ data: { id: "run1", defaultDatasetId: "ds1" } });
    }
    if (u.includes("/actor-runs/run1")) return json({ data: { status: ++consultas < 2 ? "RUNNING" : "SUCCEEDED", defaultDatasetId: "ds1", usageTotalUsd: 0.12 } });
    if (u.includes("/datasets/ds1/items")) return json([ITEM_APIFY, { ...ITEM_APIFY, title: "Outra", placeId: "ChIJ_APIFY_2", claimThisBusiness: false }]);
    throw new Error(`chamada inesperada: ${u}`);
  };
  try {
    gravarConfig("apify_token", "apify_api_teste");
    gravarConfig("fonte", "apify");
    const { status, corpo } = await criarJob({ name: "manicure · BH", keywords: ["manicure em Belo Horizonte"], depth: 1, lang: "pt-BR" });
    assert.equal(status, 201);
    assert.match(corpo.id, /^apify-/);

    let job;
    for (let i = 0; i < 100; i++) {
      job = await obterJob(corpo.id);
      if (["ok", "failed"].includes(job.Status)) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(job.Status, "ok", job.Data.erro);
    assert.equal(job.Name, "manicure · BH · Apify");
    assert.equal(job.Data.lugares, 2);
    assert.equal(job.Data.custo_usd, 0.12);

    const lista = await listarJobs(); // local scraper down: external jobs still listed
    assert.equal(lista.length, 1);
    assert.equal(lerCSV(await csvDoJob(corpo.id)).length, 2);

    const r = await importarBusca(corpo.id);
    assert.equal(r.novos, 2);
    const lead = listarLeads({ busca: "Studio Unha" }).leads[0];
    assert.ok(obterLead(lead.id).score.fatores.some((f) => f.nome === "google"));
    assert.ok(chamadas.every((c) => !c.includes("apify_api_teste")), "o token não pode aparecer em log");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test("sem a chave, criar busca externa é recusado com mensagem", async () => {
  gravarConfig("places_key", null);
  gravarConfig("fonte", "places");
  await assert.rejects(criarJob({ keywords: ["x"] }), /chave do Google Places/);
  gravarConfig("fonte", "local");
});
