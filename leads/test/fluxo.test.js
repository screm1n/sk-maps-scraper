// Whole pipeline on an in-memory database: import a real-format scraper CSV, queue,
// send, reply, metrics, block, re-import.
process.env.LEADS_DB = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { abrirBanco } from "../src/db.js";
import { lerCSV, importarLinhas, mapearLinha, codigoDoPais } from "../src/importar.js";
import { listarLeads, obterLead, atualizarLead, bloquearLead, levantamento } from "../src/leads.js";
import { mensagemParaLinha, montarFila, registrarEnvio, registrarResposta, registrarRespostasEmLote, metricas, listarTemplates } from "../src/abordagem.js";
import { validarTemplate } from "../src/dominio/mensagem.js";

const csv = readFileSync(new URL("./fixtures/busca.csv", import.meta.url), "utf8");
abrirBanco(":memory:");

const porNome = (nome) => listarLeads({ busca: nome }).leads[0];

test("os templates que vêm prontos passam na validação", () => {
  for (const t of listarTemplates()) assert.ok(validarTemplate(t.corpo).ok, `${t.nome}: ${validarTemplate(t.corpo).erros}`);
});

test("CSV do scraper: JSON do endereço e país", () => {
  const linhas = lerCSV(csv);
  assert.equal(linhas.length, 9);
  const l = mapearLinha(linhas[0], { buscaId: "job1" });
  assert.equal(l.bairro, "Savassi");
  assert.equal(l.cidade, "Belo Horizonte");
  assert.equal(l.pais, "BR");
  assert.equal(codigoDoPais("United States"), "US");
  assert.equal(codigoDoPais("Portugal"), "PT");
});

test("importa, classifica, ignora fechado e não duplica", () => {
  const r = importarLinhas(lerCSV(csv), { buscaId: "job1" });
  assert.equal(r.lidos, 9);
  assert.equal(r.novos, 7);        // 9 rows - 1 closed - 1 duplicate
  assert.equal(r.atualizados, 1);
  assert.equal(r.ignorados, 1);
  assert.deepEqual(r.camadas, { A: 3, B: 3, C: 1 });

  assert.equal(porNome("Clínica Leve").camada, "B");
  assert.equal(porNome("Clínica Leve").emails, "contato@clinicaleve.com.br");
  assert.equal(porNome("Lisboa Chic").tipoTelefone, "celular");
  assert.equal(porNome("Lisboa Chic").camada, "B"); // Booksy page, not a site
  assert.equal(porNome("Ateliê do Fixo").whatsapp, false);
  assert.equal(porNome("Salão Com Site").score.total, 0);
});

test("fila: só sem site, com WhatsApp, acima do corte, na língua do lead", () => {
  const { fila } = montarFila({ limite: 10, corteAvaliacoes: 15 });
  const nomes = fila.map((f) => f.lead.nome);
  assert.ok(nomes.some((n) => n.startsWith("Studio Bela Unha")));
  assert.ok(nomes.includes("Clínica Leve Estética"));
  assert.ok(!nomes.includes("Salão Com Site"));   // own site
  assert.ok(!nomes.includes("Ateliê do Fixo"));   // landline
  assert.ok(!nomes.includes("Esmalteria Pequena")); // 3 reviews, under the cut

  const studio = fila.find((f) => f.lead.nome.startsWith("Studio Bela Unha"));
  assert.match(studio.mensagem.corpo, /Studio Bela Unha/);
  assert.doesNotMatch(studio.mensagem.corpo, /\|/);
  assert.match(studio.mensagem.corpo, /4,9/);
  assert.match(studio.mensagem.link, /^https:\/\/web\.whatsapp\.com\/send\/\?phone=5531998765432&text=/);

  // Without the cut, the small one comes in with the version that doesn't quote reviews
  const semCorte = montarFila({ limite: 10, corteAvaliacoes: 0 }).fila.find((f) => f.lead.nome === "Esmalteria Pequena");
  assert.ok(semCorte);
  assert.doesNotMatch(semCorte.mensagem.corpo, /avalia/);
});

test("envio, resposta de robô, resposta de gente e métricas", () => {
  const studio = porNome("Studio Bela Unha");
  const clinica = porNome("Clínica Leve");
  const { fila } = montarFila({ limite: 10 });
  for (const lead of [studio, clinica]) {
    const m = fila.find((f) => f.lead.id === lead.id).mensagem;
    registrarEnvio(lead.id, { templateId: m.templateId, corpo: m.corpo });
  }
  assert.equal(obterLead(studio.id).status, "contatado");
  assert.equal(montarFila({ limite: 10 }).fila.some((f) => f.lead.id === studio.id), false);

  assert.equal(registrarResposta(clinica.id, "Olá! Agradecemos seu contato, em breve retornaremos.").automatica, true);
  assert.equal(obterLead(clinica.id).status, "contatado");
  assert.equal(registrarResposta(studio.id, "Só indicação mesmo").automatica, false);
  assert.equal(obterLead(studio.id).status, "respondeu");

  const m = metricas();
  const enviados = m.porTemplate.reduce((s, t) => s + t.enviados, 0);
  const responderam = m.porTemplate.reduce((s, t) => s + t.responderam, 0);
  assert.equal(enviados, 2);
  assert.equal(responderam, 1);
  assert.equal(m.funil.contatados, 2);
  assert.equal(m.enviadasHoje, 2);
});

test("respostas em lote pela lista do WhatsApp Web", () => {
  const clinica = porNome("Clínica Leve");
  const r = registrarRespostasEmLote([
    { titulo: "+55 31 98888-1111", previa: "Quanto fica?", deles: true },
    { titulo: "+55 31 90000-0000", previa: "oi", deles: true },
    { titulo: "Alguém", previa: "minha", deles: false },
  ], { gravar: true });
  assert.equal(r.achados.length, 1);
  assert.equal(r.achados[0].leadId, clinica.id);
  assert.equal(obterLead(clinica.id).status, "respondeu");
});

test("bloqueio sobrevive a uma nova importação", () => {
  const lisboa = porNome("Lisboa Chic");
  bloquearLead(lisboa.id);
  assert.equal(obterLead(lisboa.id).status, "descartado");
  const r = importarLinhas(lerCSV(csv), { buscaId: "job2" });
  assert.equal(r.bloqueados, 1);
  assert.equal(r.novos, 0);
});

test("reimportar não apaga status nem notas", () => {
  const studio = porNome("Studio Bela Unha");
  atualizarLead(studio.id, { status: "cliente", notas: "fechou R$ 399" });
  importarLinhas(lerCSV(csv), { buscaId: "job3" });
  const depois = obterLead(studio.id);
  assert.equal(depois.status, "cliente");
  assert.equal(depois.notas, "fechou R$ 399");
});

test("levantamento só com 5+ do mesmo ramo na cidade", () => {
  assert.equal(levantamento("Manicure", "Belo Horizonte"), null); // only 3 manicures
});

test("WhatsApp do Painel: mensagem do lead direto da linha da busca, importada ou não", () => {
  const [linha] = lerCSV(csv);
  const m = mensagemParaLinha(linha);
  assert.ok(m.whatsapp);
  assert.match(m.link, /^https:\/\/web\.whatsapp\.com\/send\/\?phone=\d+&text=/);
  assert.ok(m.corpo.length > 20);
  assert.doesNotMatch(m.corpo, /\{\{/);
  // A business that never got imported still gets its own message.
  const nova = { ...linha, title: "Ateliê Nunca Importado", place_id: "nunca-importado", review_count: "3", review_rating: "5" };
  const n = mensagemParaLinha(nova);
  assert.equal(n.leadId, null);
  assert.match(n.corpo, /Ateliê Nunca Importado/);
  assert.equal(mensagemParaLinha({ title: "" }), null);
});
