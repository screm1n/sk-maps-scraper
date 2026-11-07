// Layer C: reviewing own websites. The check reads the HTML (no network here), and a site you
// mark "ruim" enters the queue with the "refazer" message.
process.env.LEADS_DB = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analisarHtml, enderecoPermitido } from "../src/dominio/site.js";
import { abrirBanco } from "../src/db.js";
import { lerCSV, importarLinhas } from "../src/importar.js";
import { listarLeads, atualizarLead, obterLead, resumo } from "../src/leads.js";
import { montarFila } from "../src/abordagem.js";

abrirBanco(":memory:");

test("site antigo: sem celular, sem cadeado, sem WhatsApp, rodapé velho", () => {
  const html = `<html><head><title>Home</title></head><body><table width="800"><tr><td>Bem-vindo</td></tr></table>
    <p>© 2014 Salão Antigo</p></body></html>`;
  const r = analisarHtml(html, { https: false, ms: 4200, status: 200 });
  assert.equal(r.veredito, "cabe refazer");
  const textos = r.sinais.filter((s) => !s.ok).map((s) => s.texto).join(" | ");
  for (const t of ["celular", "cadeado", "WhatsApp", "2014", "lento", "genérico"]) assert.match(textos, new RegExp(t));
});

test("site bom: celular, HTTPS, WhatsApp e rodapé recente", () => {
  const ano = new Date().getFullYear();
  const html = `<html><head><meta name="viewport" content="width=device-width"><title>Studio Bela | Unhas em BH</title></head>
    <body><a href="https://wa.me/5531999998888">Fale comigo</a><footer>© ${ano} Studio Bela</footer></body></html>`;
  const r = analisarHtml(html, { https: true, ms: 800, status: 200 });
  assert.equal(r.veredito, "parece bom");
  assert.equal(r.pesoProblemas, 0);
});

test("detecta o construtor do site", () => {
  assert.equal(analisarHtml('<script src="https://static.wixstatic.com/x.js"></script>', { https: true, ms: 500, status: 200 }).construtor, "Wix");
  assert.equal(analisarHtml('<link href="/wp-content/themes/x.css">', { https: true, ms: 500, status: 200 }).construtor, "WordPress");
});

test("não deixa checar endereço da máquina ou da rede local", () => {
  for (const u of ["http://localhost:3000", "http://127.0.0.1", "http://192.168.0.1", "http://10.0.0.5/admin", "file:///etc/passwd", "http://172.20.1.1"]) {
    assert.equal(enderecoPermitido(u), false, u);
  }
  assert.equal(enderecoPermitido("https://salaocomsite.com.br"), true);
});

test("site próprio fica guardado, e marcado como ruim entra na fila com a mensagem de refazer", () => {
  importarLinhas(lerCSV(readFileSync(new URL("./fixtures/busca.csv", import.meta.url), "utf8")), { buscaId: "j" });
  const comSite = listarLeads({ avaliacaoSite: "pendente" }).leads;
  assert.equal(comSite.length, 1);
  const c = comSite[0];
  assert.equal(c.nome, "Salão Com Site");
  assert.equal(c.score.total, 0);
  assert.equal(resumo().sites.pendentes, 1);
  assert.ok(!montarFila({ limite: 20 }).fila.some((f) => f.lead.id === c.id));

  atualizarLead(c.id, { avaliacaoSite: "ruim" });
  const depois = obterLead(c.id);
  assert.ok(depois.score.total > 0);
  assert.ok(depois.score.fatores.some((f) => /cabe refazer/.test(f.detalhe)));
  assert.equal(listarLeads({ camadas: ["R"] }).leads.length, 1);
  assert.equal(resumo().sites.ruins, 1);

  const item = montarFila({ limite: 20 }).fila.find((f) => f.lead.id === c.id);
  assert.ok(item, "site ruim tem que entrar na fila");
  assert.match(item.mensagem.corpo, /site de vocês pelo celular/);
  assert.match(item.mensagem.template, /site ruim/);

  atualizarLead(c.id, { avaliacaoSite: "bom" });
  assert.equal(obterLead(c.id).score.total, 0);
  assert.ok(!montarFila({ limite: 20 }).fila.some((f) => f.lead.id === c.id));
});
