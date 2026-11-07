/** Which source scrapes, whether each one is set up, and the balance of each. */
import { FONTES, fonteAtual, gravarConfig, tokenApify, chavePlaces, mascarar, lerConfig, consultasPlacesNoMes } from "../config.js";
import { saldoApify } from "./apify.js";
import { validarPlaces, GRATIS_POR_MES } from "./places.js";
import { scraperLocalNoAr } from "../buscas.js";

const NOMES = { local: "Local", apify: "Apify", places: "Google Places" };
const usd = (v) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function infoLocal() {
  const noAr = await scraperLocalNoAr();
  return {
    id: "local", nome: NOMES.local, configurada: true, pronta: noAr,
    saldo: { texto: "Grátis e sem limite", detalhe: noAr ? "motor rodando nesta máquina" : "motor fora do ar: rode docker compose up -d" },
  };
}

async function infoApify() {
  const token = tokenApify();
  if (!token) return { id: "apify", nome: NOMES.apify, configurada: false, pronta: false, saldo: null };
  const origem = lerConfig("apify_token") ? "tela" : "variável APIFY_TOKEN";
  try {
    const s = await saldoApify(token);
    return {
      id: "apify", nome: NOMES.apify, configurada: true, pronta: s.usdRestante > 0.05, chave: mascarar(token), origem,
      saldo: {
        texto: `US$ ${usd(s.usdRestante)} de US$ ${usd(s.usdMensal)} no mês`,
        detalhe: `cerca de ${s.lugaresRestantes.toLocaleString("pt-BR")} empresas restantes${s.conta ? ` · conta ${s.conta}` : ""}`,
        ...s,
      },
    };
  } catch (e) {
    return { id: "apify", nome: NOMES.apify, configurada: true, pronta: false, chave: mascarar(token), origem, erro: e.message, saldo: null };
  }
}

function infoPlaces() {
  const chave = chavePlaces();
  if (!chave) return { id: "places", nome: NOMES.places, configurada: false, pronta: false, saldo: null };
  const usadas = consultasPlacesNoMes();
  const restantes = Math.max(0, GRATIS_POR_MES - usadas);
  return {
    id: "places", nome: NOMES.places, configurada: true, pronta: true, chave: mascarar(chave),
    origem: lerConfig("places_key") ? "tela" : "variável GOOGLE_MAPS_API_KEY",
    saldo: {
      texto: `${restantes.toLocaleString("pt-BR")} de ${GRATIS_POR_MES.toLocaleString("pt-BR")} consultas grátis no mês`,
      detalhe: "contadas só as feitas por aqui; cada consulta traz até 20 empresas",
      usadas, restantes, gratisPorMes: GRATIS_POR_MES,
    },
  };
}

export async function infoFontes() {
  const [l, a] = await Promise.all([infoLocal(), infoApify()]);
  return { atual: fonteAtual(), fontes: [l, a, infoPlaces()] };
}

export async function escolherFonte(fonte) {
  if (!FONTES.includes(fonte)) throw Object.assign(new Error("fonte desconhecida"), { status: 400 });
  if (fonte === "apify" && !tokenApify()) return { precisaConfigurar: true, fonte };
  if (fonte === "places" && !chavePlaces()) return { precisaConfigurar: true, fonte };
  gravarConfig("fonte", fonte);
  return { ok: true, ...(await infoFontes()) };
}

/** Validates the key against the provider before saving, then switches to that source. */
export async function salvarChave(fonte, chave) {
  const valor = String(chave || "").trim();
  if (!valor) throw Object.assign(new Error("cole a chave"), { status: 400 });
  if (fonte === "apify") {
    await saldoApify(valor); // throws with a clear message if the token is wrong
    gravarConfig("apify_token", valor);
  } else if (fonte === "places") {
    await validarPlaces(valor);
    gravarConfig("places_key", valor);
  } else {
    throw Object.assign(new Error("essa fonte não usa chave"), { status: 400 });
  }
  gravarConfig("fonte", fonte);
  return { ok: true, ...(await infoFontes()) };
}

export async function removerChave(fonte) {
  gravarConfig(fonte === "apify" ? "apify_token" : "places_key", null);
  if (fonteAtual() === fonte) gravarConfig("fonte", "local");
  return infoFontes();
}
