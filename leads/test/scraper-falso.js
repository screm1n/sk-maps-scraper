// Stand-in for gosom/google-maps-scraper, for trying the kit without Docker.
// Answers the same endpoints the screens and the leads server use, with sample data.
//
//   node test/scraper-falso.js          -> http://localhost:8080 (PORT to change)
//   npm start                            (in another terminal) -> http://localhost:3000
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const fixture = readFileSync(new URL("./fixtures/busca.csv", import.meta.url), "utf8").trim().split(/\r?\n/);
const [CABECALHO, ...LINHAS] = fixture;
const PORTA = Number(process.env.PORT || 8080);

// Fictional businesses around Savassi, Belo Horizonte, so the map has something to show.
const NOMES = ["Esmalteria Rosa Chá", "Studio Unhas da Lu", "Nail Bar Savassi", "Espaço Beleza Lourdes",
  "Ateliê das Unhas", "Esmalteria Bem Me Quer", "Studio Glam Nails", "Unhas & Cia Funcionários",
  "Esmalteria Doce Mel", "Nail Design Santo Agostinho", "Casa da Manicure", "Esmalteria Petit"];
const BAIRROS = ["Savassi", "Lourdes", "Funcionários", "Santo Agostinho", "Serra", "Anchieta"];
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
const EXTRAS = NOMES.map((nome, i) => {
  const bairro = BAIRROS[i % BAIRROS.length];
  const lat = (-19.938 + Math.sin(i * 1.7) * 0.012).toFixed(5);
  const lng = (-43.937 + Math.cos(i * 1.3) * 0.014).toFixed(5);
  const site = i % 4 === 0 ? "https://www.instagram.com/exemplo" : i % 5 === 0 ? "https://exemplo.com.br" : "";
  const end = JSON.stringify({ borough: bairro, city: "Belo Horizonte", state: "Minas Gerais", country: "BR" });
  const fone = `(31) 9${String(8800 + i * 37).padStart(4, "0")}-${String(1000 + i * 113).slice(0, 4)}`;
  const cols = [100 + i, `https://www.google.com/maps/place/exemplo-${i}`, nome, "Manicure", `Rua Exemplo, ${10 + i} - ${bairro}, Belo Horizonte - MG`,
    "", "", site, fone, "", 12 + i * 9, (4.4 + (i % 6) / 10).toFixed(1), "", lat, lng, 9000 + i, "Open", "", "", "", "America/Sao_Paulo",
    "", `ex${i}`, `EXEMPLO_${i}`, "", "", "", "", "", end, "", "", "", ""];
  return cols.map((c, k) => (k === 4 || k === 29 ? q(c) : c)).join(",");
});
// Three fictional businesses with real websites, to try "Revisar sites": two modern ones and the
// very first website (1991: no padlock, no phone layout).
const COM_SITE = [
  ["Studio Neon Yoga", "Estúdio de yoga", "https://miaumaste.netlify.app", "Savassi"],
  ["Hamburgueria Solid", "Hamburgueria", "https://solidburger.netlify.app", "Lourdes"],
  ["Ateliê Clássico", "Manicure", "http://info.cern.ch", "Funcionários"],
].map(([nome, cat, site, bairro], i) => {
  const end = JSON.stringify({ borough: bairro, city: "Belo Horizonte", state: "Minas Gerais", country: "BR" });
  const cols = [200 + i, `https://www.google.com/maps/place/site-${i}`, nome, cat, `Rua do Site, ${i + 1} - ${bairro}, Belo Horizonte - MG`,
    "", "", site, `(31) 9${8700 + i * 11}-${3100 + i * 7}`, "", 60 + i * 40, (4.6 + i / 10).toFixed(1), "", (-19.935 + i * 0.004).toFixed(5),
    (-43.935 - i * 0.004).toFixed(5), 9500 + i, "Open", "", "", "", "America/Sao_Paulo", "", `site${i}`, `SITE_${i}`, "", "", "", "", "", end, "", "", "", ""];
  return cols.map((c, k) => (k === 4 || k === 29 ? q(c) : c)).join(",");
});
const CSV_BH = [CABECALHO, ...LINHAS.filter((l) => l.includes('""country"":""BR""')), ...EXTRAS, ...COM_SITE].join("\n") + "\n";

const JOBS = [
  { ID: "demo-bh", Name: "manicure em Belo Horizonte (exemplo)", Date: new Date().toISOString(), Status: "ok",
    Data: { keywords: ["manicure", "esmalteria"], lat: "-19.9380", lon: "-43.9370", depth: 5 } },
  { ID: "demo-andamento", Name: "pilates em Lisboa (exemplo)", Date: new Date().toISOString(), Status: "working", Data: { keywords: ["pilates"] } },
];

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/v1/jobs" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(JOBS));
  }
  const job = url.pathname.match(/^\/api\/v1\/jobs\/([^/]+)$/);
  if (job) {
    const j = JOBS.find((x) => x.ID === job[1]);
    res.writeHead(j ? 200 : 404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(j || { error: "not found" }));
  }
  const dl = url.pathname.match(/^\/api\/v1\/jobs\/([^/]+)\/download$/);
  if (dl && dl[1] === "demo-bh") {
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8" });
    return res.end(CSV_BH);
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
}).listen(PORTA, () => console.log(`scraper falso em http://localhost:${PORTA}`));
