// Agregador fictício para rodar o fluxo completo: node examples/agregador-ficticio.mjs
// Responde GET /rastreios/BR123456789 com payload-bruto.json. Outros códigos recebem 404.
import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const payload = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "payload-bruto.json"), "utf8")
const porta = 9099

createServer((req, res) => {
  if (req.method === "GET" && req.url === "/rastreios/BR123456789") {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(payload)
    return
  }
  res.writeHead(404, { "content-type": "application/json" })
  res.end(JSON.stringify({ erro: "código desconhecido" }))
}).listen(porta, "127.0.0.1", () => {
  console.log(`agregador fictício em http://127.0.0.1:${porta}`)
})
