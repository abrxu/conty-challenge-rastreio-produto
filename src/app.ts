import Fastify, { type FastifyError, type FastifyInstance } from "fastify"
import type { AgregadorRastreio } from "./domain/agregador.js"
import type { Clock } from "./domain/clock.js"
import { AgregadorIndisponivel, CodigoInvalido, RastreioNaoEncontrado } from "./domain/erros.js"
import type { RepositorioRastreio } from "./domain/repositorio.js"
import { RastreioService } from "./domain/rastreio-service.js"

export interface DependenciasApp {
  repositorio: RepositorioRastreio
  agregador: AgregadorRastreio
  clock: Clock
  limiteEmTransitoMs: number
  logger?: boolean
}

interface ComCodigo {
  Params: { codigo: string }
}

// Único lugar que liga erro do domínio a status HTTP.
const STATUS_POR_ERRO = new Map<Function, number>([
  [CodigoInvalido, 400],
  [RastreioNaoEncontrado, 404],
  [AgregadorIndisponivel, 502],
])

function statusDoDominio(erro: unknown): number | undefined {
  if (!(erro instanceof Error)) return undefined
  return STATUS_POR_ERRO.get(erro.constructor)
}

function codigoDoCorpo(body: unknown): string {
  const codigo = typeof body === "object" && body !== null && "codigo" in body ? body.codigo : null
  if (typeof codigo !== "string") throw new CodigoInvalido()
  return codigo
}

export function criarApp(deps: DependenciasApp): FastifyInstance {
  const service = new RastreioService(
    deps.repositorio,
    deps.agregador,
    deps.clock,
    deps.limiteEmTransitoMs,
  )
  const app = Fastify({ logger: deps.logger ?? false })

  app.setErrorHandler((erro: FastifyError, request, reply) => {
    const status = statusDoDominio(erro)
    if (status !== undefined) {
      if (status >= 500) request.log.warn({ err: erro }, erro.message)
      return reply.code(status).send({ erro: erro.message })
    }
    // Erros do próprio Fastify abaixo de 500 (JSON malformado, content-type) já trazem o status certo.
    if (erro.statusCode !== undefined && erro.statusCode < 500) {
      return reply.code(erro.statusCode).send({ erro: erro.message })
    }
    request.log.error({ err: erro }, "erro inesperado")
    return reply.code(500).send({ erro: "Erro interno" })
  })

  app.post("/rastreios", async (request, reply) => {
    const { rastreio, criado } = await service.cadastrar(codigoDoCorpo(request.body))
    return reply.code(criado ? 201 : 200).send(rastreio)
  })

  app.post<ComCodigo>("/rastreios/:codigo/sincronizar", async (request) =>
    service.sincronizar(request.params.codigo),
  )

  app.get<ComCodigo>("/rastreios/:codigo", async (request) =>
    service.consultar(request.params.codigo),
  )

  return app
}
