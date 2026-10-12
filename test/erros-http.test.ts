import { afterEach, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"
import { criarApp } from "../src/app.js"
import type { AgregadorRastreio } from "../src/domain/agregador.js"
import { RepositorioEmMemoria } from "../src/domain/repositorio.js"

const LIMITE_48H_MS = 48 * 60 * 60 * 1000

function appCom(agregador: AgregadorRastreio): FastifyInstance {
  return criarApp({
    repositorio: new RepositorioEmMemoria(),
    agregador,
    clock: { now: () => new Date("2026-03-01T13:00:00.000Z") },
    limiteEmTransitoMs: LIMITE_48H_MS,
  })
}

const semEventos: AgregadorRastreio = { consultar: async () => [] }

describe("mapeamento de erros da API", () => {
  let app: FastifyInstance | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  it("erro inesperado vira 500 sem vazar a mensagem interna", async () => {
    app = appCom({
      async consultar() {
        throw new Error("senha do banco: segredo")
      },
    })
    await app.inject({ method: "POST", url: "/rastreios", payload: { codigo: "BR1" } })

    const resposta = await app.inject({ method: "POST", url: "/rastreios/BR1/sincronizar" })

    expect(resposta.statusCode).toBe(500)
    expect(resposta.json()).toEqual({ erro: "Erro interno" })
  })

  it("JSON malformado no cadastro devolve 400 no mesmo formato de erro", async () => {
    app = appCom(semEventos)

    const resposta = await app.inject({
      method: "POST",
      url: "/rastreios",
      headers: { "content-type": "application/json" },
      payload: "{codigo",
    })

    expect(resposta.statusCode).toBe(400)
    expect(Object.keys(resposta.json())).toEqual(["erro"])
  })

  it("código que não é texto devolve 400 com a mesma mensagem do código vazio", async () => {
    app = appCom(semEventos)

    const resposta = await app.inject({ method: "POST", url: "/rastreios", payload: { codigo: 123 } })

    expect(resposta.statusCode).toBe(400)
    expect(resposta.json()).toEqual({ erro: "Informe um código não vazio" })
  })

  it("código só com espaços devolve 400 com a mesma mensagem do código vazio", async () => {
    app = appCom(semEventos)

    const resposta = await app.inject({ method: "POST", url: "/rastreios", payload: { codigo: "   " } })

    expect(resposta.statusCode).toBe(400)
    expect(resposta.json()).toEqual({ erro: "Informe um código não vazio" })
  })
})
