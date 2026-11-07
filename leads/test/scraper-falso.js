// Stand-in for gosom/google-maps-scraper, for trying the leads mode without Docker.
// Answers the same two endpoints the leads server uses, with the test fixture CSV.
//
//   node test/scraper-falso.js          -> http://localhost:8080
//   GMAPS_URL=http://localhost:8080 npm start   (in another terminal)
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const csv = readFileSync(new URL("./fixtures/busca.csv", import.meta.url), "utf8");
const PORTA = Number(process.env.PORT || 8080);
const JOBS = [
  { ID: "demo-bh", Name: "manicure em Belo Horizonte (exemplo)", Date: new Date().toISOString(), Status: "ok", Data: { keywords: ["manicure", "esmalteria"] } },
  { ID: "demo-andamento", Name: "pilates em Lisboa (exemplo)", Date: new Date().toISOString(), Status: "working", Data: { keywords: ["pilates"] } },
];

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/v1/jobs") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(JOBS));
  }
  const m = url.pathname.match(/^\/api\/v1\/jobs\/([^/]+)\/download$/);
  if (m && m[1] === "demo-bh") {
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8" });
    return res.end(csv);
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
}).listen(PORTA, () => console.log(`scraper falso em http://localhost:${PORTA}`));
