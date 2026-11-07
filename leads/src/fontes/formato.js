/**
 * The common language: every source returns rows in the local scraper's CSV format
 * (gosom/google-maps-scraper, 34 columns), so Mapa, Painel and the lead import work the
 * same no matter where the data came from.
 */
export const COLUNAS = [
  "input_id", "link", "title", "category", "address", "open_hours", "popular_times", "website", "phone",
  "plus_code", "review_count", "review_rating", "reviews_per_rating", "latitude", "longitude", "cid", "status",
  "descriptions", "reviews_link", "thumbnail", "timezone", "price_range", "data_id", "place_id", "images",
  "reservations", "order_online", "menu", "owner", "complete_address", "about", "user_reviews",
  "user_reviews_extended", "emails",
  // Extra, only Apify knows it: the Google listing has no owner (nobody looks after it).
  "claim_this_business",
];

const celula = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** @param {Record<string, unknown>[]} linhas */
export function paraCsv(linhas) {
  return [COLUNAS.join(","), ...linhas.map((l) => COLUNAS.map((c) => celula(l[c])).join(","))].join("\n") + "\n";
}

export const enderecoCompleto = ({ bairro, rua, cidade, cep, estado, pais }) =>
  JSON.stringify({ borough: bairro || "", street: rua || "", city: cidade || "", postal_code: cep || "", state: estado || "", country: pais || "" });

/** "20 / 60 / 120 / 200+" in the search form, as places per search term. */
export const lugaresPorProfundidade = (depth) => ({ 1: 20, 5: 60, 10: 120, 20: 200 })[Number(depth)] ?? Math.min(200, Math.max(20, Number(depth) * 12 || 60));
