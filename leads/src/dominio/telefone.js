/**
 * Normalizes a phone to E.164 and says whether it can be reached on WhatsApp.
 *
 * Brazil keeps its own rules (9th digit, area codes, 0800). Every other country goes through
 * libphonenumber-js, which knows mobile vs landline from each country's numbering plan.
 *
 * tipo:
 *   "celular"    mobile, goes to the WhatsApp queue
 *   "fixo"       landline, no WhatsApp
 *   "indefinido" the numbering plan does not tell (US, Canada): queued, WhatsApp answers on open
 *   "outro"      toll-free, premium, call center
 */
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

const DDDS = new Set(("11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 " +
  "51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99").split(" "));
const ESPECIAIS = ["0800", "0300", "0500", "4003", "4004", "4020"];

/**
 * @param {string|null|undefined} bruto
 * @param {string|null|undefined} pais ISO-2 country code. Missing = Brazil.
 * @returns {{e164: string, tipo: "celular"|"fixo"|"indefinido"|"outro"} | null}
 */
export function lerTelefone(bruto, pais) {
  const texto = String(bruto ?? "").trim();
  const digitos = texto.replace(/\D/g, "");
  if (!digitos) return null;

  // Abroad when the country says so or when the number carries another code ("+351...").
  // Without the +, 11987654321 is still a Sao Paulo mobile.
  const estrangeiro = (pais && pais.toUpperCase() !== "BR") || (texto.startsWith("+") && !texto.startsWith("+55"));
  if (estrangeiro) return internacional(texto, pais);

  if (ESPECIAIS.some((p) => digitos.startsWith(p))) return { e164: `+55${digitos}`, tipo: "outro" };

  let nacional = digitos;
  if ((nacional.length === 12 || nacional.length === 13) && nacional.startsWith("55")) nacional = nacional.slice(2);
  if (nacional.length !== 10 && nacional.length !== 11) return null;

  const ddd = nacional.slice(0, 2);
  if (!DDDS.has(ddd)) return null;

  let local = nacional.slice(2);
  let tipo;
  if (local.length === 9) {
    if (!local.startsWith("9")) return null;
    tipo = "celular";
  } else if (local[0] >= "6" && local[0] <= "9") {
    local = `9${local}`; // old 8-digit mobile, restore the 9th digit
    tipo = "celular";
  } else if (local[0] >= "2" && local[0] <= "5") {
    tipo = "fixo";
  } else {
    return null;
  }
  return { e164: `+55${ddd}${local}`, tipo };
}

function internacional(texto, pais) {
  const codigo = pais && /^[A-Za-z]{2}$/.test(pais) ? pais.toUpperCase() : undefined;
  const p = parsePhoneNumberFromString(texto, codigo);
  if (!p || !p.isValid()) return null;
  const t = p.getType();
  const tipo = t === "MOBILE" ? "celular"
    : t === "FIXED_LINE" ? "fixo"
    : t === "FIXED_LINE_OR_MOBILE" || t === undefined ? "indefinido"
    : "outro";
  return { e164: p.number, tipo };
}

/** Link that opens the chat with the text already typed. */
export function linkWhatsApp(e164, texto) {
  const d = String(e164).replace(/\D/g, "");
  return `https://wa.me/${d}?text=${encodeURIComponent(texto)}`;
}

export const podeWhatsApp = (tipo) => tipo === "celular" || tipo === "indefinido";
