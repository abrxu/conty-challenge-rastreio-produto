import type { FastifyInstance } from "fastify"
import { criarApp } from "./app.js"
import type { Configuracao } from "./configuracao.js"
import type { Clock } from "./domain/clock.js"
import { RepositorioEmMemoria } from "./domain/repositorio.js"
import { AgregadorHttp } from "./infra/agregador-http.js"

export interface Dependencias {
  fetch: typeof fetch
  clock: Clock
  logger?: boolean
}

// Liga as peças reais. O main só lê o ambiente e sobe o servidor.
export function montarAplicacao(
  configuracao: Configuracao,
  dependencias: Dependencias,
): FastifyInstance {
  return criarApp({
    repositorio: new RepositorioEmMemoria(),
    agregador: new AgregadorHttp(dependencias.fetch, configuracao.agregadorUrl),
    clock: dependencias.clock,
    limiteEmTransitoMs: configuracao.limiteEmTransitoMs,
    logger: dependencias.logger,
  })
}
