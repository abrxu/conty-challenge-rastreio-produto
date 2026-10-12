import { describe, expect, it } from "vitest"
import type { AgregadorRastreio } from "../src/domain/agregador.js"
import type { Clock } from "../src/domain/clock.js"
import { RepositorioEmMemoria, type RepositorioRastreio } from "../src/domain/repositorio.js"
import { RastreioService } from "../src/domain/rastreio-service.js"

const LIMITE_48H_MS = 48 * 60 * 60 * 1000

function clockEm(iso: string): Clock {
  return { now: () => new Date(iso) }
}

describe("histórico idempotente", () => {
  it("Consultar de novo o mesmo código não duplica o histórico", async () => {
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
    const service = new RastreioService(
      new RepositorioEmMemoria(),
      agregador,
      clockEm("2026-03-01T13:00:00.000Z"),
      LIMITE_48H_MS,
    )

    await service.cadastrar("BR-IDEM")
    const primeira = await service.sincronizar("BR-IDEM")
    const segunda = await service.sincronizar("BR-IDEM")
    const consultado = await service.consultar("BR-IDEM")

    expect(chamadas).toEqual(["BR-IDEM", "BR-IDEM"])
    expect(primeira.historico).toHaveLength(1)
    expect(segunda.historico).toHaveLength(1)
    expect(consultado.historico.map((evento) => evento.id)).toEqual(["evt-1"])
  })

  it("Consultar de novo o mesmo código não duplica o histórico: correção do mesmo evento com data mais nova substitui o anterior", async () => {
    let vez = 0
    const agregador: AgregadorRastreio = {
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
        return [
          {
            id: "evt-1",
            ocorridoEm: new Date("2026-03-03T12:00:00.000Z"),
            status: "entregue",
            statusBruto: "DELIVERED",
          },
        ]
      },
    }
    const service = new RastreioService(
      new RepositorioEmMemoria(),
      agregador,
      clockEm("2026-03-03T13:00:00.000Z"),
      LIMITE_48H_MS,
    )

    await service.cadastrar("BR-CORR")
    const primeira = await service.sincronizar("BR-CORR")
    const corrigida = await service.sincronizar("BR-CORR")
    const repetida = await service.sincronizar("BR-CORR")

    expect(primeira.status).toBe("em_transito")
    expect(corrigida).toEqual({
      codigo: "BR-CORR",
      status: "entregue",
      atrasado: false,
      historico: [
        {
          id: "evt-1",
          ocorridoEm: "2026-03-03T12:00:00.000Z",
          status: "entregue",
          statusBruto: "DELIVERED",
        },
      ],
    })
    expect(repetida).toEqual(corrigida)
  })

  it("Consultar de novo o mesmo código não duplica o histórico: mesmo evento com instante corrigido atualiza a data", async () => {
    let vez = 0
    const agregador: AgregadorRastreio = {
      async consultar() {
        vez += 1
        const ocorridoEm = new Date(
          vez === 1 ? "2026-03-01T12:00:00.000Z" : "2026-03-01T13:00:00.000Z",
        )
        return [{ id: "evt-1", ocorridoEm, status: "em_transito", statusBruto: "IN_TRANSIT" }]
      },
    }
    const service = new RastreioService(
      new RepositorioEmMemoria(),
      agregador,
      clockEm("2026-03-01T14:00:00.000Z"),
      LIMITE_48H_MS,
    )

    await service.cadastrar("BR-HORA")
    await service.sincronizar("BR-HORA")
    const corrigido = await service.sincronizar("BR-HORA")

    expect(corrigido.historico).toEqual([
      {
        id: "evt-1",
        ocorridoEm: "2026-03-01T13:00:00.000Z",
        status: "em_transito",
        statusBruto: "IN_TRANSIT",
      },
    ])
  })

  it("Consultar de novo o mesmo código não duplica o histórico: sincronizações simultâneas não perdem evento", async () => {
    let consultasIniciadas = 0
    let liberarPrimeira: () => void = () => {}
    const primeiraPodeResponder = new Promise<void>((resolve) => {
      liberarPrimeira = resolve
    })
    const agregador: AgregadorRastreio = {
      async consultar() {
        consultasIniciadas += 1
        const vez = consultasIniciadas
        if (vez === 1) await primeiraPodeResponder
        if (vez === 1) {
          return [
            {
              id: "a",
              ocorridoEm: new Date("2026-03-01T12:00:00.000Z"),
              status: "em_transito",
              statusBruto: "IN_TRANSIT",
            },
          ]
        }
        return [
          {
            id: "b",
            ocorridoEm: new Date("2026-03-02T12:00:00.000Z"),
            status: "entregue",
            statusBruto: "DELIVERED",
          },
        ]
      },
    }
    const service = new RastreioService(
      new RepositorioEmMemoria(),
      agregador,
      clockEm("2026-03-02T13:00:00.000Z"),
      LIMITE_48H_MS,
    )

    await service.cadastrar("BR-RACE")
    const primeira = service.sincronizar("BR-RACE")
    const segunda = service.sincronizar("BR-RACE")
    await Promise.resolve()
    liberarPrimeira()
    await Promise.all([primeira, segunda])
    const consultado = await service.consultar("BR-RACE")

    expect(consultado.historico.map((evento) => evento.id).sort()).toEqual(["a", "b"])
    expect(consultado.status).toBe("entregue")
  })

  it("Consultar de novo o mesmo código não duplica o histórico: cadastro atrasado não apaga evento já sincronizado", async () => {
    const memoria = new RepositorioEmMemoria()
    const liberarLeituras: Array<() => void> = []
    let leituras = 0
    const repositorio: RepositorioRastreio = {
      salvar: (rastreio) => memoria.salvar(rastreio),
      async buscar(codigo) {
        leituras += 1
        const lido = await memoria.buscar(codigo)
        // As duas primeiras leituras voltam com o valor de antes, e só então ficam paradas até o teste liberá-las.
        if (leituras <= 2) await new Promise<void>((resolve) => liberarLeituras.push(resolve))
        return lido
      },
    }
    const agregador: AgregadorRastreio = {
      async consultar() {
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
    const service = new RastreioService(
      repositorio,
      agregador,
      clockEm("2026-03-01T13:00:00.000Z"),
      LIMITE_48H_MS,
    )
    const pausa = () => new Promise((resolve) => setImmediate(resolve))
    const liberaProxima = () => liberarLeituras.shift()?.()

    const primeiroCadastro = service.cadastrar("BR-LENTO")
    const segundoCadastro = service.cadastrar("BR-LENTO")
    await pausa()
    liberaProxima()
    await primeiroCadastro
    const sincronizacao = service.sincronizar("BR-LENTO")
    await pausa()
    liberaProxima()
    await segundoCadastro
    await sincronizacao

    const consultado = await service.consultar("BR-LENTO")
    expect(consultado.historico.map((evento) => evento.id)).toEqual(["evt-1"])
  })
})
