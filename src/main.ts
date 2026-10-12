import { montarAplicacao } from "./composicao.js"
import { lerConfiguracao } from "./configuracao.js"
import { RelogioSistema } from "./relogio-sistema.js"

const configuracao = lerConfiguracao(process.env)
const app = montarAplicacao(configuracao, { fetch, clock: new RelogioSistema(), logger: true })

await app.listen({ port: configuracao.porta, host: "127.0.0.1" })
