/**
 * Turns the Google Maps "website" field into the lead layer.
 *
 * A = nothing online at all.
 * B = social profile, link-in-bio, WhatsApp link or a third-party booking/directory page
 *     instead of a site. Best lead: they already care about being found online.
 * C = own website. `siteFraco` flags a free-hosting subdomain, still worth approaching.
 */

const REDES = ["instagram.com", "facebook.com", "fb.com", "fb.me", "tiktok.com", "youtube.com", "twitter.com", "x.com"];

const AGREGADORES = [
  "linktr.ee", "beacons.ai", "bio.link", "linkr.bio", "campsite.bio", "lnk.bio",
  "many.link", "solo.to", "taplink.cc", "linkbio.co", "linkme.bio",
];

const WHATSAPP = ["wa.me", "whatsapp.com", "wa.link", "whts.co", "chatwith.io"];

/** Profile on someone else's platform is not an own site: renting space on another storefront. */
const PLATAFORMAS = [
  // Brazil
  "doctoralia.com.br", "doctoralia.com", "boaconsulta.com", "dietbox.me", "agendarconsulta.com",
  "nutritotal.com.br", "zenklub.com.br", "vittude.com", "psicologiaviva.com.br", "gestaods.com.br",
  "booksy.com", "trinks.com", "belaz.com.br", "getninjas.com.br", "solutudo.com.br",
  "apontador.com.br", "telelistas.net", "guiamais.com.br",
  // US/Europe: booking or directory page in place of a site
  "vagaro.com", "square.site", "squareup.com", "fresha.com", "styleseat.com", "glossgenius.com",
  "schedulicity.com", "setmore.com", "yelp.com", "mybusiness.site", "treatwell.com", "treatwell.co.uk",
  "planity.com", "timify.com",
];

/** Free hosting on a subdomain. Technically a site, in practice a weak storefront. */
const HOSTS_FRACOS = [
  "wixsite.com", "sites.google.com", "blogspot.com", "negocio.site", "business.site",
  "webnode.page", "webnode.com.br", "wordpress.com", "weebly.com", "jimdosite.com",
  "canva.site", "carrd.co", "godaddysites.com", "mypages.com.br",
];

const REDIRECIONADORES = ["l.instagram.com", "l.facebook.com", "lm.facebook.com"];
const IG_RESERVADOS = new Set(["p", "reel", "reels", "explore", "stories", "tv", "s", "accounts", "direct", "channel", "locations"]);
const RE_IG_HANDLE = /^[a-zA-Z0-9._]{1,30}$/;

function parseUrl(bruto) {
  const comEsquema = /^https?:\/\//i.test(bruto) ? bruto : `https://${bruto}`;
  let url;
  try {
    url = new URL(comEsquema);
  } catch {
    return null;
  }
  if (!url.hostname.includes(".") || /\s/.test(url.hostname)) return null;
  return url;
}

function desembrulhar(url) {
  if (!REDIRECIONADORES.includes(url.hostname.toLowerCase())) return url;
  const alvo = url.searchParams.get("u");
  return (alvo && parseUrl(alvo)) || url;
}

const casa = (host, lista) => lista.some((d) => host === d || host.endsWith(`.${d}`));

function handleInstagram(url) {
  const seg = url.pathname.split("/").filter(Boolean)[0];
  if (!seg) return null;
  const h = seg.toLowerCase();
  return !IG_RESERVADOS.has(h) && RE_IG_HANDLE.test(h) ? h : null;
}

const normalizar = (url) => `${url.hostname.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}`;

/**
 * @param {string|null|undefined} website
 * @returns {{camada: "A"|"B"|"C", igHandle: string|null, siteFraco: boolean, websiteNormalizado: string|null}}
 */
export function classificar(website) {
  const bruto = (website ?? "").trim();
  if (!bruto) return { camada: "A", igHandle: null, siteFraco: false, websiteNormalizado: null };

  const parsed = parseUrl(bruto);
  // Something is in the field but it is unreadable: treat as existing presence.
  if (!parsed) return { camada: "C", igHandle: null, siteFraco: false, websiteNormalizado: null };

  const url = desembrulhar(parsed);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const websiteNormalizado = normalizar(url);

  if (casa(host, ["instagram.com"])) {
    return { camada: "B", igHandle: handleInstagram(url), siteFraco: false, websiteNormalizado };
  }
  if (casa(host, REDES) || casa(host, AGREGADORES) || casa(host, WHATSAPP) || casa(host, PLATAFORMAS)) {
    return { camada: "B", igHandle: null, siteFraco: false, websiteNormalizado };
  }
  return { camada: "C", igHandle: null, siteFraco: casa(host, HOSTS_FRACOS), websiteNormalizado };
}
