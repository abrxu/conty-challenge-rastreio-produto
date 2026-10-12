import { describe, expect, it } from "vitest"
import type { AgregadorRastreio, EventoDoAgregador } from "../src/domain/agregador.js"
import type { StatusRastreio } from "../src/domain/rastreio.js"
import type { Clock } from "../src/domain/clock.js"
import { RepositorioEmMemoria } from "../src/domain/repositorio.js"
import { RastreioService } from "../src/domain/rastreio-service.js"

const LIMITE_48H_MS = 48 * 60 * 60 * 1000
const T = "2026-03-01T12:00:00.000Z"
const T_MAIS_2H = "2026-03-01T14:00:00.000Z"

function clockEm(iso: string): Clock {
  return { now: () => new Date(iso) }
}

describe("eventos fora de ordem", () => {
  it("Evento que chega fora de ordem não regride o status", async () => {
    let eventos: EventoDoAgregador[] = [
      {
        id: "evt-transito",
        ocorridoEm: new Date(T_MAIS_2H),
        status: "em_transito",
        statusBruto: "IN_TRANSIT",
      },
    ]
    const agregador: AgregadorRastreio = {
      async consultar() {
        return eventos
      },
    }
    const service = new RastreioService(
      new RepositorioEmMemoria(),
      agregador,
      clockEm(T_MAIS_2H),
      LIMITE_48H_MS,
    )

    await service.cadastrar("BR-ORDEM")
    const primeiro = await service.sincronizar("BR-ORDEM")
    expect(primeiro.status).toBe("em_transito")

    eventos = [
      {
        id: "evt-transito",
        ocorridoEm: new Date(T_MAIS_2H),
        status: "em_transito",
        statusBruto: "IN_TRANSIT",
      },
      {
        id: "evt-postado",
        ocorridoEm: new Date(T),
        status: "postado",
        statusBruto: "POSTED",
      },
    ]
    const depois = await service.sincronizar("BR-ORDEM")

    expect(depois.status).toBe("em_transito")
    expect(depois.historico.map((evento) => evento.status)).toEqual(["postado", "em_transito"])
    expect(depois.historico.map((evento) => evento.ocorridoEm)).toEqual([T, T_MAIS_2H])
  })

  it("Evento que chega fora de ordem não regride o status quando o instante empata", async () => {
    let eventos: EventoDoAgregador[] = [
      {
        id: "evt-entregue",
        ocorridoEm: new Date(T),
        status: "entregue",
        statusBruto: "DELIVERED",
      },
    ]
    const agregador: AgregadorRastreio = {
      async consultar() {
        return eventos
      },
    }
    const service = new RastreioService(
      new RepositorioEmMemoria(),
      agregador,
      clockEm(T),
      LIMITE_48H_MS,
    )

    await service.cadastrar("BR-EMPATE")
    const primeiro = await service.sincronizar("BR-EMPATE")
    expect(primeiro.status).toBe("entregue")

    eventos = [
      {
        id: "evt-entregue",
        ocorridoEm: new Date(T),
        status: "entregue",
        statusBruto: "DELIVERED",
      },
      {
        id: "evt-postado",
        ocorridoEm: new Date(T),
        status: "postado",
        statusBruto: "POSTED",
      },
    ]
    const depois = await service.sincronizar("BR-EMPATE")

    expect(depois.status).toBe("entregue")
    expect(depois.historico.map((evento) => evento.id)).toEqual(["evt-postado", "evt-entregue"])
  })

  it("Evento que chega fora de ordem não regride o status: versão antiga do mesmo evento não substitui a nova", async () => {
    let vez = 0
    const agregador: AgregadorRastreio = {
      async consultar() {
        vez += 1
        if (vez === 1) {
          return [
            {
              id: "evt-1",
              ocorridoEm: new Date(T_MAIS_2H),
              status: "entregue",
              statusBruto: "DELIVERED",
            },
          ]
        }
        return [
          {
            id: "evt-1",
            ocorridoEm: new Date(T),
            status: "em_transito",
            statusBruto: "IN_TRANSIT",
          },
        ]
      },
    }
    const service = new RastreioService(
      new RepositorioEmMemoria(),
      agregador,
      clockEm(T_MAIS_2H),
      LIMITE_48H_MS,
    )

    await service.cadastrar("BR-VERSAO")
    await service.sincronizar("BR-VERSAO")
    const depois = await service.sincronizar("BR-VERSAO")

    expect(depois.status).toBe("entregue")
    expect(depois.historico).toEqual([
      {
        id: "evt-1",
        ocorridoEm: T_MAIS_2H,
        status: "entregue",
        statusBruto: "DELIVERED",
      },
    ])
  })

  it("Evento que chega fora de ordem não regride o status: entrega concluída não volta com evento mais novo", async () => {
    let vez = 0
    const entregue: EventoDoAgregador = {
      id: "evt-entregue",
      ocorridoEm: new Date(T),
      status: "entregue",
      statusBruto: "DELIVERED",
    }
    const agregador: AgregadorRastreio = {
      async consultar() {
        vez += 1
        if (vez === 1) return [entregue]
        return [
          entregue,
          {
            id: "evt-transito",
            ocorridoEm: new Date(T_MAIS_2H),
            status: "em_transito",
            statusBruto: "IN_TRANSIT",
          },
        ]
      },
    }
    const service = new RastreioService(
      new RepositorioEmMemoria(),
      agregador,
      clockEm("2026-03-04T12:00:00.000Z"),
      LIMITE_48H_MS,
    )

    await service.cadastrar("BR-FINAL")
    await service.sincronizar("BR-FINAL")
    const depois = await service.sincronizar("BR-FINAL")

    expect(depois.status).toBe("entregue")
    expect(depois.atrasado).toBe(false)
    expect(depois.historico.map((evento) => evento.status)).toEqual(["entregue", "em_transito"])
  })

  it("Evento que chega fora de ordem não regride o status: nova versão do evento entregue não tira a entrega", async () => {
    let vez = 0
    const agregador: AgregadorRastreio = {
      async consultar() {
        vez += 1
        if (vez === 1) {
          return [
            {
              id: "evt-1",
              ocorridoEm: new Date(T),
              status: "entregue",
              statusBruto: "DELIVERED",
            },
          ]
        }
        return [
          {
            id: "evt-1",
            ocorridoEm: new Date(T_MAIS_2H),
            status: "em_transito",
            statusBruto: "IN_TRANSIT",
          },
        ]
      },
    }
    const service = new RastreioService(
      new RepositorioEmMemoria(),
      agregador,
      clockEm(T_MAIS_2H),
      LIMITE_48H_MS,
    )

    await service.cadastrar("BR-VERSAO-FINAL")
    await service.sincronizar("BR-VERSAO-FINAL")
    const depois = await service.sincronizar("BR-VERSAO-FINAL")

    expect(depois.status).toBe("entregue")
  })

  it("Evento que chega fora de ordem não regride o status: versão antiga de um evento em trânsito não substitui a nova", async () => {
    let vez = 0
    const agregador: AgregadorRastreio = {
      async consultar() {
        vez += 1
        if (vez === 1) {
          return [
            {
              id: "evt-1",
              ocorridoEm: new Date(T_MAIS_2H),
              status: "em_transito",
              statusBruto: "IN_TRANSIT",
            },
          ]
        }
        return [
          {
            id: "evt-1",
            ocorridoEm: new Date(T),
            status: "postado",
            statusBruto: "POSTED",
          },
        ]
      },
    }
    const service = new RastreioService(
      new RepositorioEmMemoria(),
      agregador,
      clockEm(T_MAIS_2H),
      LIMITE_48H_MS,
    )

    await service.cadastrar("BR-VERSAO-TRANSITO")
    await service.sincronizar("BR-VERSAO-TRANSITO")
    const depois = await service.sincronizar("BR-VERSAO-TRANSITO")

    expect(depois.status).toBe("em_transito")
    expect(depois.historico).toEqual([
      {
        id: "evt-1",
        ocorridoEm: T_MAIS_2H,
        status: "em_transito",
        statusBruto: "IN_TRANSIT",
      },
    ])
  })

  it.each<[StatusRastreio, StatusRastreio]>([
    ["postado", "em_transito"],
    ["em_transito", "saiu_para_entrega"],
    ["saiu_para_entrega", "excecao"],
    ["excecao", "entregue"],
  ])(
    "Evento que chega fora de ordem não regride o status: no mesmo instante, %s perde para %s",
    async (menor, maior) => {
      const evento = (status: StatusRastreio, id: string): EventoDoAgregador => ({
        id,
        ocorridoEm: new Date(T),
        status,
        statusBruto: status,
      })

      for (const recebidos of [
        [evento(menor, "evt-a"), evento(maior, "evt-b")],
        [evento(maior, "evt-b"), evento(menor, "evt-a")],
      ]) {
        const agregador: AgregadorRastreio = {
          async consultar() {
            return recebidos
          },
        }
        const service = new RastreioService(
          new RepositorioEmMemoria(),
          agregador,
          clockEm(T),
          LIMITE_48H_MS,
        )

        await service.cadastrar("BR-DESEMPATE")
        const rastreio = await service.sincronizar("BR-DESEMPATE")

        expect(rastreio.status).toBe(maior)
      }
    },
  )
})
