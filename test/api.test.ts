import { afterEach, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"
import type { AgregadorRastreio } from "../src/domain/agregador.js"
import { criarApp } from "../src/app.js"
import { AgregadorIndisponivel } from "../src/domain/erros.js"
import { AgregadorHttp } from "../src/infra/agregador-http.js"
import { RepositorioEmMemoria } from "../src/domain/repositorio.js"
import type { Clock } from "../src/domain/clock.js"

const LIMITE_48H_MS = 48 * 60 * 60 * 1000

function clockEm(iso: string): Clock {
  return { now: () => new Date(iso) }
}

function montarApp(): { app: FastifyInstance; chamadas: string[] } {
  const chamadas: string[] = []
  const agregador: AgregadorRastreio = {
    async consultar(codigo) {
      chamadas.push(codigo)
      return [
        {
          id: "evt-1",
          ocorridoEm: new Date("2026-03-01T12:00:00.000Z"),
          status: "em_transito",
          statusBruto: "IN_TRANSIT",
        },
      ]
    },
  }
  const app = criarApp({
    repositorio: new RepositorioEmMemoria(),
    agregador,
    clock: clockEm("2026-03-01T13:00:00.000Z"),
    limiteEmTransitoMs: LIMITE_48H_MS,
  })
  return { app, chamadas }
}

function appComAgregadorHttp(agregador: AgregadorHttp): FastifyInstance {
  return criarApp({
    repositorio: new RepositorioEmMemoria(),
    agregador,
    clock: clockEm("2026-03-01T13:00:00.000Z"),
    limiteEmTransitoMs: LIMITE_48H_MS,
  })
}

describe("API HTTP de rastreio", () => {
  let app: FastifyInstance | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  it("cadastrar rastreio retorna 201 com estado inicial", async () => {
    ;({ app } = montarApp())

    const resposta = await app.inject({
      method: "POST",
      url: "/rastreios",
      payload: { codigo: "BR1" },
    })

    expect(resposta.statusCode).toBe(201)
    expect(resposta.json()).toEqual({
      codigo: "BR1",
      status: null,
      historico: [],
      atrasado: false,
    })
  })

  it("sincronizar usa o agregador injetado e devolve o rastreio", async () => {
    const montado = montarApp()
    app = montado.app

    await app.inject({
      method: "POST",
      url: "/rastreios",
      payload: { codigo: "BR1" },
    })
    const resposta = await app.inject({
      method: "POST",
      url: "/rastreios/BR1/sincronizar",
    })

    expect(montado.chamadas).toEqual(["BR1"])
    expect(resposta.statusCode).toBe(200)
    expect(resposta.json()).toMatchObject({
      codigo: "BR1",
      status: "em_transito",
      atrasado: false,
      historico: [
        {
          id: "evt-1",
          ocorridoEm: "2026-03-01T12:00:00.000Z",
          status: "em_transito",
          statusBruto: "IN_TRANSIT",
        },
      ],
    })
  })

  it("consultar devolve o mesmo estado salvo", async () => {
    ;({ app } = montarApp())

    await app.inject({
      method: "POST",
      url: "/rastreios",
      payload: { codigo: "BR1" },
    })
    const sincronizado = await app.inject({
      method: "POST",
      url: "/rastreios/BR1/sincronizar",
    })
    const consultado = await app.inject({
      method: "GET",
      url: "/rastreios/BR1",
    })

    expect(consultado.statusCode).toBe(200)
    expect(consultado.json()).toEqual(sincronizado.json())
    expect(consultado.json()).toMatchObject({
      codigo: "BR1",
      status: "em_transito",
    })
  })

  it("agregador indisponível na sincronização retorna 502", async () => {
    const agregador: AgregadorRastreio = {
      async consultar() {
        throw new AgregadorIndisponivel("BR1")
      },
    }
    app = criarApp({
      repositorio: new RepositorioEmMemoria(),
      agregador,
      clock: clockEm("2026-03-01T13:00:00.000Z"),
      limiteEmTransitoMs: LIMITE_48H_MS,
    })

    await app.inject({
      method: "POST",
      url: "/rastreios",
      payload: { codigo: "BR1" },
    })
    const resposta = await app.inject({
      method: "POST",
      url: "/rastreios/BR1/sincronizar",
    })

    expect(resposta.statusCode).toBe(502)
    expect(resposta.json()).toEqual({ erro: "Agregador indisponível para BR1" })
  })

  it("Sincronização com JSON ilegível do agregador devolve 502", async () => {
    app = appComAgregadorHttp(
      new AgregadorHttp(async () => new Response("não-json", { status: 200 }), "http://agregador.test"),
    )

    await app.inject({
      method: "POST",
      url: "/rastreios",
      payload: { codigo: "BR1" },
    })
    const resposta = await app.inject({
      method: "POST",
      url: "/rastreios/BR1/sincronizar",
    })

    expect(resposta.statusCode).toBe(502)
    expect(resposta.json()).toEqual({ erro: "Agregador indisponível para BR1" })
  })

  it("Sincronização com agregador que responde 500 devolve 502, mesmo com corpo JSON válido", async () => {
    app = appComAgregadorHttp(
      new AgregadorHttp(
        async () =>
          Response.json(
            { events: [{ event_id: "evt-1", happened_at: "2026-03-01T12:00:00.000Z", carrier_status: "IN_TRANSIT" }] },
            { status: 500 },
          ),
        "http://agregador.test",
      ),
    )

    await app.inject({
      method: "POST",
      url: "/rastreios",
      payload: { codigo: "BR1" },
    })
    const resposta = await app.inject({
      method: "POST",
      url: "/rastreios/BR1/sincronizar",
    })

    expect(resposta.statusCode).toBe(502)
    expect(resposta.json()).toEqual({ erro: "Agregador indisponível para BR1" })
  })

  it("Sincronização com agregador que não responde no tempo limite devolve 502", async () => {
    app = appComAgregadorHttp(
      new AgregadorHttp(
        (_url, init) =>
          new Promise<Response>((_resolve, rejeita) => {
            const sinal = init?.signal
            if (sinal) sinal.addEventListener("abort", () => rejeita(sinal.reason))
          }),
        "http://agregador.test",
        20,
      ),
    )

    await app.inject({
      method: "POST",
      url: "/rastreios",
      payload: { codigo: "BR1" },
    })
    const resposta = await app.inject({
      method: "POST",
      url: "/rastreios/BR1/sincronizar",
    })

    expect(resposta.statusCode).toBe(502)
    expect(resposta.json()).toEqual({ erro: "Agregador indisponível para BR1" })
  }, 2000)

  it("código inexistente no GET retorna 404", async () => {
    ;({ app } = montarApp())

    const resposta = await app.inject({
      method: "GET",
      url: "/rastreios/NAO-EXISTE",
    })

    expect(resposta.statusCode).toBe(404)
    expect(resposta.json()).toEqual({ erro: "Rastreio não encontrado: NAO-EXISTE" })
  })

  it("cadastrar código vazio retorna 400", async () => {
    ;({ app } = montarApp())

    const resposta = await app.inject({
      method: "POST",
      url: "/rastreios",
      payload: { codigo: "" },
    })

    expect(resposta.statusCode).toBe(400)
    expect(resposta.json()).toEqual({ erro: "Informe um código não vazio" })
  })

  it("cadastrar código ausente retorna 400", async () => {
    ;({ app } = montarApp())

    const resposta = await app.inject({
      method: "POST",
      url: "/rastreios",
      payload: {},
    })

    expect(resposta.statusCode).toBe(400)
    expect(resposta.json()).toEqual({ erro: "Informe um código não vazio" })
  })

  it("Sincronização que falha devolve 502 e o último estado salvo continua igual", async () => {
    let vez = 0
    app = criarApp({
      repositorio: new RepositorioEmMemoria(),
      agregador: {
        async consultar() {
          vez += 1
          if (vez === 1) {
            return [
              {
                id: "evt-1",
                ocorridoEm: new Date("2026-03-01T12:00:00.000Z"),
                status: "em_transito",
                statusBruto: "IN_TRANSIT",
              },
            ]
          }
          throw new AgregadorIndisponivel("BR1")
        },
      },
      clock: clockEm("2026-03-01T13:00:00.000Z"),
      limiteEmTransitoMs: LIMITE_48H_MS,
    })

    await app.inject({ method: "POST", url: "/rastreios", payload: { codigo: "BR1" } })
    const sincronizado = await app.inject({ method: "POST", url: "/rastreios/BR1/sincronizar" })
    const falhou = await app.inject({ method: "POST", url: "/rastreios/BR1/sincronizar" })
    const consultado = await app.inject({ method: "GET", url: "/rastreios/BR1" })

    expect(sincronizado.statusCode).toBe(200)
    expect(falhou.statusCode).toBe(502)
    expect(consultado.json()).toEqual(sincronizado.json())
  })

  it("Consultar de novo o mesmo código não duplica o histórico: sincronizar duas vezes pela API deixa um evento", async () => {
    ;({ app } = montarApp())

    await app.inject({ method: "POST", url: "/rastreios", payload: { codigo: "BR1" } })
    await app.inject({ method: "POST", url: "/rastreios/BR1/sincronizar" })
    const segunda = await app.inject({ method: "POST", url: "/rastreios/BR1/sincronizar" })

    expect(segunda.json().historico).toHaveLength(1)
  })

  it("Sincronizar código que o agregador ainda não conhece devolve 200 sem eventos", async () => {
    app = appComAgregadorHttp(
      new AgregadorHttp(
        async () => new Response("não encontrado", { status: 404 }),
        "http://agregador.test",
      ),
    )

    await app.inject({ method: "POST", url: "/rastreios", payload: { codigo: "BR1" } })
    const resposta = await app.inject({ method: "POST", url: "/rastreios/BR1/sincronizar" })

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json()).toEqual({
      codigo: "BR1",
      status: null,
      historico: [],
      atrasado: false,
    })
  })

  it("Sincronizar código não cadastrado devolve 404", async () => {
    ;({ app } = montarApp())

    const resposta = await app.inject({ method: "POST", url: "/rastreios/NAO-EXISTE/sincronizar" })

    expect(resposta.statusCode).toBe(404)
    expect(resposta.json()).toEqual({ erro: "Rastreio não encontrado: NAO-EXISTE" })
  })

  it("Cadastrar código que já existe devolve 200 com o estado atual", async () => {
    ;({ app } = montarApp())

    await app.inject({ method: "POST", url: "/rastreios", payload: { codigo: "BR1" } })
    const sincronizado = await app.inject({ method: "POST", url: "/rastreios/BR1/sincronizar" })
    const repetido = await app.inject({
      method: "POST",
      url: "/rastreios",
      payload: { codigo: "BR1" },
    })

    expect(repetido.statusCode).toBe(200)
    expect(repetido.json()).toEqual(sincronizado.json())
  })

  it("código com espaços nas pontas é o mesmo código no cadastro, na sincronização e na consulta", async () => {
    ;({ app } = montarApp())

    const cadastrado = await app.inject({
      method: "POST",
      url: "/rastreios",
      payload: { codigo: " BR1 " },
    })
    const sincronizado = await app.inject({
      method: "POST",
      url: "/rastreios/%20BR1%20/sincronizar",
    })
    const consultado = await app.inject({ method: "GET", url: "/rastreios/%20BR1%20" })

    expect(cadastrado.json().codigo).toBe("BR1")
    expect(sincronizado.statusCode).toBe(200)
    expect(consultado.json()).toEqual(sincronizado.json())
  })

  it("JSON malformado no cadastro devolve 400", async () => {
    ;({ app } = montarApp())

    const resposta = await app.inject({
      method: "POST",
      url: "/rastreios",
      headers: { "content-type": "application/json" },
      payload: "{codigo",
    })

    expect(resposta.statusCode).toBe(400)
  })
})
