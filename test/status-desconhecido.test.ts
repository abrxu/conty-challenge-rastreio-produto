import { describe, expect, it } from "vitest"
import type { Clock } from "../src/domain/clock.js"
import { RepositorioEmMemoria } from "../src/domain/repositorio.js"
import { RastreioService } from "../src/domain/rastreio-service.js"
import { AgregadorHttp } from "../src/infra/agregador-http.js"

const LIMITE_48H_MS = 48 * 60 * 60 * 1000

function clockEm(iso: string): Clock {
  return { now: () => new Date(iso) }
}

function agregadorQueEnvia(statusBruto: string): AgregadorHttp {
  return new AgregadorHttp(
    async () =>
      Response.json({
        events: [
          {
            event_id: "evt-inventado",
            happened_at: "2026-03-01T12:00:00.000Z",
            carrier_status: statusBruto,
          },
        ],
      }),
    "http://agregador.test",
  )
}

describe("status desconhecido da transportadora", () => {
  it("Status desconhecido da transportadora não vira entregue", async () => {
    const service = new RastreioService(
      new RepositorioEmMemoria(),
      agregadorQueEnvia("teletransporte_quantico"),
      clockEm("2026-03-01T12:00:00.000Z"),
      LIMITE_48H_MS,
    )

    await service.cadastrar("BR-DESCONHECIDO")
    const rastreio = await service.sincronizar("BR-DESCONHECIDO")

    expect(rastreio.status).not.toBe("entregue")
    expect(rastreio.status).toBe("excecao")
    expect(rastreio.historico).toEqual([
      {
        id: "evt-inventado",
        ocorridoEm: "2026-03-01T12:00:00.000Z",
        status: "excecao",
        statusBruto: "teletransporte_quantico",
      },
    ])
  })

  it("Status desconhecido da transportadora não vira entregue: nome que só contém 'entregue' também fica fora", async () => {
    const service = new RastreioService(
      new RepositorioEmMemoria(),
      agregadorQueEnvia("DELIVERED_PARCIAL"),
      clockEm("2026-03-01T12:00:00.000Z"),
      LIMITE_48H_MS,
    )

    await service.cadastrar("BR-PARCIAL")
    const rastreio = await service.sincronizar("BR-PARCIAL")

    expect(rastreio.status).toBe("excecao")
  })

  it("Teste com eventos fora de ordem e com um status que a transportadora inventou: o inventado não vira entregue e o antigo não regride", async () => {
    let vez = 0
    const inventado = {
      event_id: "evt-inventado",
      happened_at: "2026-03-01T14:00:00.000Z",
      carrier_status: "teletransporte_quantico",
    }
    const postado = {
      event_id: "evt-postado",
      happened_at: "2026-03-01T12:00:00.000Z",
      carrier_status: "POSTED",
    }
    const agregador = new AgregadorHttp(async () => {
      vez += 1
      const events = vez === 1 ? [inventado] : [inventado, postado]
      return Response.json({ tracking_code: "BR-MISTO", events })
    }, "http://agregador.test")
    const service = new RastreioService(
      new RepositorioEmMemoria(),
      agregador,
      clockEm("2026-03-01T15:00:00.000Z"),
      LIMITE_48H_MS,
    )

    await service.cadastrar("BR-MISTO")
    await service.sincronizar("BR-MISTO")
    const rastreio = await service.sincronizar("BR-MISTO")

    expect(rastreio.status).toBe("excecao")
    expect(rastreio.historico.map((evento) => [evento.status, evento.statusBruto])).toEqual([
      ["postado", "POSTED"],
      ["excecao", "teletransporte_quantico"],
    ])
  })
})
