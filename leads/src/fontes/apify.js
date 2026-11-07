/**
 * Apify source: the same Google Maps scraping, but on Apify's machines with rotating IPs.
 * Free plan: US$5 of credit a month, no card. Measured cost: about US$0.005 per place.
 */
import { enderecoCompleto } from "./formato.js";

const BASE = "https://api.apify.com/v2";
const ATOR = "compass~crawler-google-places";
export const USD_POR_LUGAR = 0.005;
export const USD_FIXO = 0.03;

async function pedir(token, caminho, init = {}) {
  const sep = caminho.includes("?") ? "&" : "?";
  const r = await fetch(`${BASE}${caminho}${sep}token=${encodeURIComponent(token)}`, { ...init, signal: AbortSignal.timeout(30000) });
  if (r.status === 401 || r.status === 403) throw new Error("O Apify recusou o token. Confira se copiou inteiro (começa com apify_api_).");
  if (!r.ok) throw new Error(`O Apify respondeu ${r.status}: ${(await r.text().catch(() => "")).slice(0, 160)}`);
  return r.json();
}

/** Credit of the month. Apify is the source of truth, no local counter. */
export async function saldoApify(token) {
  const [eu, uso] = await Promise.all([pedir(token, "/users/me"), pedir(token, "/users/me/usage/monthly")]);
  const mensal = eu.data?.plan?.monthlyUsageCreditsUsd ?? 5;
  const gasto = uso.data?.totalUsageCreditsUsdAfterVolumeDiscount ?? 0;
  const restante = Math.max(0, mensal - gasto);
  return {
    conta: eu.data?.username || null,
    plano: eu.data?.plan?.id || "FREE",
    usdMensal: mensal,
    usdGasto: gasto,
    usdRestante: restante,
    lugaresRestantes: Math.max(0, Math.floor((restante - USD_FIXO) / USD_POR_LUGAR)),
  };
}

export const estimarApify = (termos, porTermo) => +(USD_FIXO + termos * porTermo * USD_POR_LUGAR).toFixed(2);

/** @param {{keywords: string[], lang?: string}} pedido */
export async function iniciarApify(token, pedido, porTermo) {
  const r = await pedir(token, `/acts/${ATOR}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      searchStringsArray: pedido.keywords,
      maxCrawledPlacesPerSearch: porTermo,
      language: pedido.lang || "pt-BR",
      website: "allPlaces",
      skipClosedPlaces: true,
    }),
  });
  return { execucao: r.data.id, dataset: r.data.defaultDatasetId };
}

export async function estadoApify(token, execucao) {
  const r = await pedir(token, `/actor-runs/${execucao}`);
  return { status: r.data.status, dataset: r.data.defaultDatasetId, custo: r.data.usageTotalUsd ?? null };
}

export const abortarApify = (token, execucao) => pedir(token, `/actor-runs/${execucao}/abort`, { method: "POST" }).catch(() => {});

/** Apify place to a row in the local scraper's format. */
export function linhaDoApify(l, i = 0) {
  return {
    input_id: i,
    link: l.url || "",
    title: l.title || "",
    category: l.categoryName || "",
    address: l.address || "",
    website: l.website || "",
    phone: l.phoneUnformatted || l.phone || "",
    review_count: l.reviewsCount ?? "",
    review_rating: l.totalScore ?? "",
    latitude: l.location?.lat ?? "",
    longitude: l.location?.lng ?? "",
    cid: l.cid || "",
    status: l.permanentlyClosed ? "Permanently closed" : l.temporarilyClosed ? "Temporarily closed" : "Open",
    place_id: l.placeId || "",
    complete_address: enderecoCompleto({
      bairro: l.neighborhood, rua: l.street, cidade: l.city, cep: l.postalCode, estado: l.state, pais: l.countryCode,
    }),
    emails: Array.isArray(l.emails) ? l.emails.join(", ") : "",
    claim_this_business: l.claimThisBusiness === true ? "true" : "",
  };
}

export async function itensApify(token, dataset) {
  const itens = await pedir(token, `/datasets/${dataset}/items?clean=true&format=json`);
  return (Array.isArray(itens) ? itens : []).map(linhaDoApify);
}
