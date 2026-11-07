/**
 * Google Places source: the official API (Places API New, Text Search).
 * Needs a Google Cloud project with an OPEN billing account. Text Search charges per
 * request, not per place; each request brings up to 20 places (3 pages max per term).
 * The phone/website/rating fields are the Enterprise SKU: 1,000 free requests a month.
 */
import { enderecoCompleto } from "./formato.js";

const URL_BUSCA = "https://places.googleapis.com/v1/places:searchText";
export const GRATIS_POR_MES = 1000;
const CAMPOS = [
  "places.id", "places.displayName", "places.formattedAddress", "places.addressComponents", "places.location",
  "places.internationalPhoneNumber", "places.nationalPhoneNumber", "places.websiteUri", "places.rating",
  "places.userRatingCount", "places.primaryTypeDisplayName", "places.businessStatus", "places.googleMapsUri",
  "nextPageToken",
].join(",");

function explicar(status, corpo) {
  const msg = corpo?.error?.message || "";
  if (status === 403 && /billing/i.test(msg)) return "O projeto do Google Cloud está sem faturamento ativo. Ative uma conta de faturamento e tente de novo.";
  if (status === 403 && /not been used|disabled/i.test(msg)) return "A Places API (New) não está ativada nesse projeto. Ative em APIs e serviços.";
  if (status === 400 && /API key not valid/i.test(msg)) return "A chave do Google não é válida. Confira se copiou inteira.";
  if (status === 403) return `O Google recusou a chave (PERMISSION_DENIED). Quase sempre é faturamento fechado ou a API não ativada. ${msg}`.trim();
  return `O Google respondeu ${status}. ${msg}`.trim();
}

async function pagina(chave, corpo, campos = CAMPOS) {
  const r = await fetch(URL_BUSCA, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": chave, "X-Goog-FieldMask": campos },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(30000),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(explicar(r.status, json));
  return json;
}

/** Checks the key with the cheapest possible call (id only, 1 result: Essentials SKU). */
export async function validarPlaces(chave) {
  await pagina(chave, { textQuery: "padaria", pageSize: 1 }, "places.id");
  return true;
}

const parte = (comps, tipo, curto = false) => {
  const c = (comps || []).find((x) => (x.types || []).includes(tipo));
  return c ? (curto ? c.shortText : c.longText) : "";
};

export function linhaDoPlaces(p, i = 0) {
  const comps = p.addressComponents;
  return {
    input_id: i,
    link: p.googleMapsUri || "",
    title: p.displayName?.text || "",
    category: p.primaryTypeDisplayName?.text || "",
    address: p.formattedAddress || "",
    website: p.websiteUri || "",
    phone: p.internationalPhoneNumber || p.nationalPhoneNumber || "",
    review_count: p.userRatingCount ?? "",
    review_rating: p.rating ?? "",
    latitude: p.location?.latitude ?? "",
    longitude: p.location?.longitude ?? "",
    status: p.businessStatus === "CLOSED_PERMANENTLY" ? "Permanently closed" : "Open",
    place_id: p.id || "",
    complete_address: enderecoCompleto({
      bairro: parte(comps, "sublocality_level_1") || parte(comps, "sublocality") || parte(comps, "neighborhood"),
      rua: parte(comps, "route"),
      cidade: parte(comps, "locality") || parte(comps, "administrative_area_level_2"),
      cep: parte(comps, "postal_code"),
      estado: parte(comps, "administrative_area_level_1"),
      pais: parte(comps, "country", true),
    }),
  };
}

/**
 * @param {{keywords: string[], lang?: string, lat?: string, lon?: string, radius?: number}} pedido
 * @param {number} paginas 1 to 3 pages of 20 per term
 * @param {(n: number) => void} contar called once per request made (for the monthly count)
 */
export async function buscarPlaces(chave, pedido, paginas, contar = () => {}) {
  const lat = Number(pedido.lat), lon = Number(pedido.lon);
  const vies = lat && lon ? { locationBias: { circle: { center: { latitude: lat, longitude: lon }, radius: Math.min(50000, Number(pedido.radius) || 5000) } } } : {};
  const linhas = [];
  const vistos = new Set();
  for (const termo of pedido.keywords) {
    let token;
    for (let n = 0; n < paginas; n++) {
      const corpo = { textQuery: termo, languageCode: (pedido.lang || "pt").split("-")[0], pageSize: 20, ...vies };
      if (token) corpo.pageToken = token;
      const r = await pagina(chave, corpo);
      contar(1);
      for (const p of r.places || []) {
        if (vistos.has(p.id)) continue;
        vistos.add(p.id);
        linhas.push(linhaDoPlaces(p, linhas.length));
      }
      token = r.nextPageToken;
      if (!token) break;
      await new Promise((ok) => setTimeout(ok, 1500)); // the next page token needs a moment to become valid
    }
  }
  return linhas;
}
