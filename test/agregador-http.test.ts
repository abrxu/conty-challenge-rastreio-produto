import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { RastreioService } from "../src/domain/rastreio-service.js"
import { RepositorioEmMemoria } from "../src/domain/repositorio.js"
import { AgregadorHttp, traduzirPayloadBruto } from "../src/infra/agregador-http.js"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const BASE = "http://agregador.test"
const LIMITE_48H_MS = 48 * 60 * 60 * 1000

const eventoValido = {
  event_id: "evt-1",
  happened_at: "2026-03-01T12:00:00.000Z",
  carrier_status: "IN_TRANSIT",
}

function comEventos(...eventos: unknown[]): Response {
  return Response.json({ tracking_code: "BR1", events: eventos })
}

function payloadDeExemplo(): unknown {
  return JSON.parse(readFileSync(join(RAIZ, "examples", "payload-bruto.json"), "utf8"))
}

describe("API, o cliente HTTP do agregador atrás de uma interface", () => {
  it("Um exemplo de payload bruto e do status normalizado: payload bruto de exemplo vira evento da porta com status traduzido", () => {
    expect(traduzirPayloadBruto(payloadDeExemplo())).toEqual([
      {
        id: "evt-1",
        ocorridoEm: new Date("2026-03-01T12:00:00.000Z"),
        status: "em_transito",
        statusBruto: "IN_TRANSIT",
      },
    ])
  })

  it("Um exemplo de payload bruto e do status normalizado: o exemplo sai como o status normalizado do README", async () => {
    const http = new AgregadorHttp(async () => Response.json(payloadDeExemplo()), BASE)
    const service = new RastreioService(
      new RepositorioEmMemoria(),
      http,
      { now: () => new Date("2026-03-01T13:00:00.000Z") },
      LIMITE_48H_MS,
    )

    await service.cadastrar("BR123456789")
    const rastreio = await service.sincronizar("BR123456789")

    expect(rastreio).toEqual({
      codigo: "BR123456789",
      status: "em_transito",
      historico: [
        {
          id: "evt-1",
          ocorridoEm: "2026-03-01T12:00:00.000Z",
          status: "em_transito",
          statusBruto: "IN_TRANSIT",
        },
      ],
      atrasado: false,
    })
  })

  it("API, o cliente HTTP do agregador atrás de uma interface: consulta GET {AGREGADOR_URL}/rastreios/{codigo} sem perder o caminho da base", async () => {
    const urls: string[] = []
    const http = new AgregadorHttp(async (url) => {
      urls.push(String(url))
      return Response.json({ events: [] })
    }, "http://agregador.test/api/v1/")

    await http.consultar("BR123456789")

    expect(urls).toEqual(["http://agregador.test/api/v1/rastreios/BR123456789"])
  })

  it("API, o cliente HTTP do agregador atrás de uma interface: base sem barra final também mantém o caminho", async () => {
    const urls: string[] = []
    const http = new AgregadorHttp(async (url) => {
      urls.push(String(url))
      return Response.json({ events: [] })
    }, "http://agregador.test/api/v1")

    await http.consultar("BR 1/2")

    expect(urls).toEqual(["http://agregador.test/api/v1/rastreios/BR%201%2F2"])
  })

  it("lista de eventos vazia é resposta válida e não é indisponível", async () => {
    const http = new AgregadorHttp(async () => comEventos(), BASE)

    await expect(http.consultar("BR1")).resolves.toEqual([])
  })

  it("resposta 500 do agregador é indisponível, mesmo com corpo JSON válido", async () => {
    const http = new AgregadorHttp(
      async () => Response.json({ events: [eventoValido] }, { status: 500 }),
      BASE,
    )

    await expect(http.consultar("BR1")).rejects.toMatchObject({
      name: "AgregadorIndisponivel",
      message: "Agregador indisponível para BR1",
    })
  })

  it("agregador fora do ar (conexão recusada) é indisponível", async () => {
    const http = new AgregadorHttp(async () => {
      throw new TypeError("fetch failed")
    }, BASE)

    await expect(http.consultar("BR1")).rejects.toMatchObject({
      name: "AgregadorIndisponivel",
      message: "Agregador indisponível para BR1",
      cause: { message: "fetch failed" },
    })
  })

  it("agregador que não responde no tempo limite é indisponível", async () => {
    const http = new AgregadorHttp((_url, init) => {
      return new Promise<Response>((_resolve, rejeita) => {
        const sinal = init?.signal
        if (sinal) sinal.addEventListener("abort", () => rejeita(sinal.reason))
      })
    }, BASE, 20)

    await expect(http.consultar("BR1")).rejects.toMatchObject({
      name: "AgregadorIndisponivel",
      cause: { name: "TimeoutError" },
    })
  }, 2000)

  it("JSON ilegível do agregador é indisponível", async () => {
    const http = new AgregadorHttp(async () => new Response("não-json", { status: 200 }), BASE)

    await expect(http.consultar("BR1")).rejects.toMatchObject({
      name: "AgregadorIndisponivel",
      message: "Agregador indisponível para BR1",
    })
  })

  it("resposta sem lista de eventos é indisponível e não vira 'nenhum evento'", async () => {
    const http = new AgregadorHttp(
      async () => Response.json({ tracking_code: "BR1" }),
      BASE,
    )

    await expect(http.consultar("BR1")).rejects.toMatchObject({
      name: "AgregadorIndisponivel",
    })
  })

  it("evento incompleto recusa o payload inteiro, sem descartar só o item", async () => {
    const http = new AgregadorHttp(
      async () =>
        comEventos(eventoValido, {
          event_id: "evt-2",
          happened_at: "2026-03-02T12:00:00.000Z",
        }),
      BASE,
    )

    await expect(http.consultar("BR1")).rejects.toMatchObject({
      name: "AgregadorIndisponivel",
    })
  })

  it("evento com data ilegível recusa o payload inteiro, mesmo com outro evento válido", async () => {
    const http = new AgregadorHttp(
      async () =>
        comEventos(eventoValido, {
          event_id: "evt-2",
          happened_at: "ontem",
          carrier_status: "DELIVERED",
        }),
      BASE,
    )

    await expect(http.consultar("BR1")).rejects.toMatchObject({
      name: "AgregadorIndisponivel",
      message: "Agregador indisponível para BR1",
    })
  })

  it.each([
    ["sem fuso", "2026-03-01T21:00:00"],
    ["texto que não é data", "ontem"],
    ["dia que não existe", "2026-02-30T12:00:00Z"],
    ["hora 24:00", "2026-03-01T24:00:00Z"],
    ["offset fora de faixa", "2026-03-01T12:00:00+25:00"],
  ])("instante ilegível (%s) recusa o payload inteiro", async (_nome, instante) => {
    const http = new AgregadorHttp(
      async () => comEventos({ ...eventoValido, happened_at: instante }),
      BASE,
    )

    await expect(http.consultar("BR1")).rejects.toMatchObject({
      name: "AgregadorIndisponivel",
      message: "Agregador indisponível para BR1",
    })
  })

  it("instante com offset vira UTC", async () => {
    const http = new AgregadorHttp(
      async () => comEventos({ ...eventoValido, happened_at: "2026-03-01T21:00:00-03:00" }),
      BASE,
    )

    await expect(http.consultar("BR1")).resolves.toEqual([
      {
        id: "evt-1",
        ocorridoEm: new Date("2026-03-02T00:00:00.000Z"),
        status: "em_transito",
        statusBruto: "IN_TRANSIT",
      },
    ])
  })

  it("status em caixa diferente é traduzido: delivered vira entregue", async () => {
    const http = new AgregadorHttp(
      async () => comEventos({ ...eventoValido, carrier_status: "delivered" }),
      BASE,
    )

    const [evento] = await http.consultar("BR1")

    expect(evento?.status).toBe("entregue")
  })

  it.each([
    ["POSTED", "postado"],
    ["OBJ_POSTADO", "postado"],
    ["IN_TRANSIT", "em_transito"],
    ["OBJ_EM_TRANSITO", "em_transito"],
    ["OUT_FOR_DELIVERY", "saiu_para_entrega"],
    ["OBJ_SAIU", "saiu_para_entrega"],
    ["DELIVERED", "entregue"],
    ["OBJ_ENTREGUE", "entregue"],
    ["EXCEPTION", "excecao"],
    ["OBJ_EXCECAO", "excecao"],
  ])("status bruto %s vira %s, como na tabela do README", async (bruto, estavel) => {
    const http = new AgregadorHttp(
      async () => comEventos({ ...eventoValido, carrier_status: bruto }),
      BASE,
    )

    const [evento] = await http.consultar("BR1")

    expect(evento?.status).toBe(estavel)
  })

  it("código que o agregador ainda não conhece (404) é lista vazia, não indisponível", async () => {
    const http = new AgregadorHttp(
      async () => new Response("não encontrado", { status: 404 }),
      BASE,
    )

    await expect(http.consultar("BR1")).resolves.toEqual([])
  })

  it("payload de outro código recusa o payload inteiro", async () => {
    const http = new AgregadorHttp(
      async () => Response.json({ tracking_code: "BR-OUTRO", events: [eventoValido] }),
      BASE,
    )

    await expect(http.consultar("BR1")).rejects.toMatchObject({
      name: "AgregadorIndisponivel",
    })
  })

  it.each([
    ["ausente", { happened_at: "2026-03-01T12:00:00.000Z", carrier_status: "IN_TRANSIT" }],
    [
      "vazio",
      { event_id: "", happened_at: "2026-03-01T12:00:00.000Z", carrier_status: "IN_TRANSIT" },
    ],
  ])("evento com event_id %s recusa o payload inteiro", async (_nome, evento) => {
    const http = new AgregadorHttp(async () => comEventos(evento), BASE)

    await expect(http.consultar("BR1")).rejects.toMatchObject({
      name: "AgregadorIndisponivel",
    })
  })

  it.each([
    ["sem barra final", "http://agregador.test", "http://agregador.test/rastreios/BR1"],
    ["com barra final", "http://agregador.test/", "http://agregador.test/rastreios/BR1"],
    ["com porta e sem caminho", "http://127.0.0.1:9099", "http://127.0.0.1:9099/rastreios/BR1"],
  ])(
    "API, o cliente HTTP do agregador atrás de uma interface: base %s monta GET {AGREGADOR_URL}/rastreios/{codigo}",
    async (_nome, base, esperada) => {
      const urls: string[] = []
      const http = new AgregadorHttp(async (url) => {
        urls.push(String(url))
        return Response.json({ events: [] })
      }, base)

      await http.consultar("BR1")

      expect(urls).toEqual([esperada])
    },
  )
})
