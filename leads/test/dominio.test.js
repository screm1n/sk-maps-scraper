import { test } from "node:test";
import assert from "node:assert/strict";
import { classificar } from "../src/dominio/classificar.js";
import { lerTelefone, linkWhatsApp } from "../src/dominio/telefone.js";
import { notaDoLead } from "../src/dominio/nota.js";
import { renderizar, validarTemplate, nomeCurto, idiomaDoPais } from "../src/dominio/mensagem.js";
import { ehAutomatica } from "../src/dominio/respostas.js";

test("camadas: sem site, rede social/agendamento, site próprio", () => {
  assert.equal(classificar("").camada, "A");
  assert.equal(classificar(null).camada, "A");
  assert.deepEqual(classificar("https://www.instagram.com/clinicaleve/"), {
    camada: "B", igHandle: "clinicaleve", siteFraco: false, websiteNormalizado: "instagram.com/clinicaleve",
  });
  for (const u of ["https://linktr.ee/x", "https://wa.me/5531999998888", "https://booksy.com/pt-pt/1",
    "https://x.square.site/", "https://www.vagaro.com/abc", "https://www.fresha.com/a/b"]) {
    assert.equal(classificar(u).camada, "B", u);
  }
  assert.equal(classificar("https://salaocomsite.com.br/").camada, "C");
  assert.equal(classificar("https://meusalao.wixsite.com/site").siteFraco, true);
  assert.equal(classificar("https://l.instagram.com/?u=https%3A%2F%2Fwa.me%2F5531999998888").camada, "B");
});

test("telefone: Brasil, Portugal, Espanha e EUA", () => {
  assert.deepEqual(lerTelefone("(31) 99876-5432"), { e164: "+5531998765432", tipo: "celular" });
  assert.deepEqual(lerTelefone("(31) 3333-4444"), { e164: "+553133334444", tipo: "fixo" });
  assert.equal(lerTelefone("(31) 9876-5432").e164, "+5531998765432"); // old 8-digit mobile
  assert.equal(lerTelefone("0800 123 4567").tipo, "outro");
  assert.equal(lerTelefone("+351 912 345 678", "PT").tipo, "celular");
  assert.equal(lerTelefone("+351 213 456 789", "PT").tipo, "fixo");
  assert.deepEqual(lerTelefone("612 34 56 78", "ES"), { e164: "+34612345678", tipo: "celular" });
  assert.deepEqual(lerTelefone("(305) 555-0142", "US"), { e164: "+13055550142", tipo: "indefinido" });
  assert.equal(lerTelefone("+351 12", "PT"), null);
  assert.equal(lerTelefone("+1 212 736 5000").tipo, "indefinido"); // +1 with no country also works
  assert.equal(lerTelefone("11987654321").e164, "+5511987654321"); // no + means Brazil
  assert.equal(linkWhatsApp("+5531999998888", "Oi, tudo?"), "https://web.whatsapp.com/send/?phone=5531999998888&text=Oi%2C%20tudo%3F&type=phone_number&app_absent=0");
});

test("nota: site próprio zera, sem site e celular sobe", () => {
  assert.equal(notaDoLead({ camada: "C", tipoTelefone: "celular", qtdAvaliacoes: 200, nota: 5 }).total, 0);
  const b = notaDoLead({ camada: "B", tipoTelefone: "celular", qtdAvaliacoes: 130, nota: 4.8, temEmail: true });
  assert.equal(b.total, 40 + 15 + 20 + 10 + 5);
  const fixo = notaDoLead({ camada: "A", tipoTelefone: "fixo", qtdAvaliacoes: 25, nota: 4.6 });
  assert.ok(fixo.total < b.total);
  assert.equal(notaDoLead({ camada: "A", tipoTelefone: null, qtdAvaliacoes: 0, nota: null }).total, 0);
});

test("mensagem: nome sem SEO, nota com vírgula em pt e ponto em en", () => {
  assert.equal(nomeCurto("Studio Bela Unha | Manicure | Esmalteria"), "Studio Bela Unha");
  assert.equal(nomeCurto("Kesya Souza - Psicóloga - Santa Amélia"), "Kesya Souza");
  assert.equal(nomeCurto("Pet-Shop Amigo"), "Pet-Shop Amigo");
  const lead = { nome: "Studio X | Unhas", nota: 4.9, qtdAvaliacoes: 48 };
  assert.equal(renderizar("{{nome}}: {{nota}} ({{qtd_avaliacoes}})", lead, "pt").corpo, "Studio X: 4,9 (48)");
  assert.equal(renderizar("{{nota}}", lead, "en").corpo, "4.9");
  assert.deepEqual(renderizar("{{qtd_avaliacoes}} reviews", { ...lead, qtdAvaliacoes: 0 }, "en").faltando, ["qtd_avaliacoes"]);
  assert.equal(idiomaDoPais("PT"), "pt");
  assert.equal(idiomaDoPais("MX"), "es");
  assert.equal(idiomaDoPais("US"), "en");
});

test("validação: travessão barra, pergunta pura passa, oferta sem saída barra", () => {
  assert.equal(validarTemplate("Oi — tudo bem? Se não tiver interesse, tranquilo.").ok, false);
  assert.equal(validarTemplate("Oi! Vi vocês no Google. Hoje o cliente chega por indicação ou pelo Google?").ok, true);
  assert.equal(validarTemplate("Oi, faço sites. Posso te mandar uma ideia?").ok, false);
  assert.equal(validarTemplate("Hi! I build websites. Can I send you a preview?").ok, false);
  assert.equal(validarTemplate("Oi! Já fiz uma prévia pro seu site. Posso enviar? Se não for o momento, sem problema.").ok, true);
  assert.equal(validarTemplate("Hi! Want a preview? If you're not interested, no worries.").ok, true);
  assert.equal(validarTemplate("¡Hola! Hago páginas web. Si no te interesa, no hay problema.").ok, true);
});

test("resposta automática x pessoa", () => {
  assert.equal(ehAutomatica("Olá! Agradecemos seu contato, em breve retornaremos."), true);
  assert.equal(ehAutomatica("Obrigada pelo contato ✨ Talvez eu esteja em atendimento"), true);
  assert.equal(ehAutomatica("Thanks for your message! We'll get back to you soon."), true);
  assert.equal(ehAutomatica("Só indicação mesmo"), false);
  assert.equal(ehAutomatica("Quanto custa?"), false);
});
