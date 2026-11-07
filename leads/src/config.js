/** Settings kept in the local database: which source scrapes, and the API keys. */
import { abrirBanco } from "./db.js";

export const FONTES = ["local", "apify", "places"];

export function lerConfig(chave) {
  return abrirBanco().prepare("SELECT valor FROM config WHERE chave = ?").get(chave)?.valor ?? null;
}

export function gravarConfig(chave, valor) {
  if (valor == null) abrirBanco().prepare("DELETE FROM config WHERE chave = ?").run(chave);
  else abrirBanco().prepare("INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").run(chave, String(valor));
}

export const fonteAtual = () => (FONTES.includes(lerConfig("fonte")) ? lerConfig("fonte") : "local");

/** The key typed in the screen wins; the environment variable is the fallback (Docker, CI). */
export const tokenApify = () => lerConfig("apify_token") || process.env.APIFY_TOKEN || null;
export const chavePlaces = () => lerConfig("places_key") || process.env.GOOGLE_MAPS_API_KEY || null;

/** Shown in the screen instead of the key: enough to recognize it, useless to anyone else. */
export function mascarar(chave) {
  if (!chave) return null;
  return chave.length <= 8 ? "••••" : `${chave.slice(0, 4)}••••${chave.slice(-4)}`;
}

/** Google gives no API for "free requests left", so the requests made from here are counted. */
export function contarConsultaPlaces(n = 1) {
  const mes = new Date().toISOString().slice(0, 7);
  const chave = `places_uso_${mes}`;
  gravarConfig(chave, Number(lerConfig(chave) || 0) + n);
}
export const consultasPlacesNoMes = () => Number(lerConfig(`places_uso_${new Date().toISOString().slice(0, 7)}`) || 0);
