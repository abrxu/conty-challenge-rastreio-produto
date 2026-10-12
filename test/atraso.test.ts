import { describe, expect, it } from "vitest"
import type { AgregadorRastreio, EventoDoAgregador } from "../src/domain/agregador.js"
import type { Clock } from "../src/domain/clock.js"
import { RepositorioEmMemoria } from "../src/domain/repositorio.js"
import { RastreioService } from "../src/domain/rastreio-service.js"

const LIMITE_48H_MS = 48 * 60 * 60 * 1000
const T = "2026-03-01T00:00:00.000Z"
const T_MAIS_24H = "2026-03-02T00:00:00.000Z"
const T_MAIS_47H = "2026-03-02T23:00:00.000Z"
const T_MAIS_48H = "2026-03-03T00:00:00.000Z"
const T_MAIS_49H = "2026-03-03T01:00:00.000Z"
const T_MAIS_72H = "2026-03-04T00:00:00.000Z"

function clockEm(iso: string): Clock {
  return { now: () => new Date(iso) }
}

function servicoCom(eventos: EventoDoAgregador[], agora: string): RastreioService {
  const agregador: AgregadorRastreio = {
    async consultar() {
      return eventos
    },
  }
  return new RastreioService(
    new RepositorioEmMemoria(),
    agregador,
    clockEm(agora),
    LIMITE_48H_MS,
  )
}

const EM_TRANSITO_DESDE_T: EventoDoAgregador = {
  id: "evt-transito",
  ocorridoEm: new Date(T),
  status: "em_transito",
  statusBruto: "IN_TRANSIT",
}

describe("A regra de atraso tem teste com data controlada", () => {
  it("A regra de atraso tem teste com data controlada: no prazo (47h) não é atraso", async () => {
    const service = servicoCom([EM_TRANSITO_DESDE_T], T_MAIS_47H)

    await service.cadastrar("BR-PRAZO")
    const rastreio = await service.sincronizar("BR-PRAZO")

    expect(rastreio.status).toBe("em_transito")
    expect(rastreio.atrasado).toBe(false)
  })

  it("A regra de atraso tem teste com data controlada: exatamente no limite de 48h ainda não é atraso", async () => {
    const service = servicoCom([EM_TRANSITO_DESDE_T], T_MAIS_48H)

    await service.cadastrar("BR-LIMITE")
    const rastreio = await service.sincronizar("BR-LIMITE")

    expect(rastreio.atrasado).toBe(false)
  })

  it("A regra de atraso tem teste com data controlada: passou do limite (49h) é atraso", async () => {
    const service = servicoCom([EM_TRANSITO_DESDE_T], T_MAIS_49H)

    await service.cadastrar("BR-ATRASO")
    const rastreio = await service.sincronizar("BR-ATRASO")

    expect(rastreio.status).toBe("em_transito")
    expect(rastreio.atrasado).toBe(true)
  })

  it("Como o atraso é detectado sem marcar entrega normal como atraso: entregue depois do limite não é atraso", async () => {
    const service = servicoCom(
      [
        {
          id: "evt-postado",
          ocorridoEm: new Date(T),
          status: "postado",
          statusBruto: "POSTED",
        },
        {
          id: "evt-entregue",
          ocorridoEm: new Date(T_MAIS_24H),
          status: "entregue",
          statusBruto: "DELIVERED",
        },
      ],
      T_MAIS_72H,
    )

    await service.cadastrar("BR-ENTREGUE")
    const rastreio = await service.sincronizar("BR-ENTREGUE")

    expect(rastreio.status).toBe("entregue")
    expect(rastreio.atrasado).toBe(false)
  })

  it("Como o atraso é detectado sem marcar entrega normal como atraso: sem nenhum evento não há contagem", async () => {
    const service = servicoCom([], T_MAIS_72H)

    await service.cadastrar("BR-SEM-EVENTO")
    const rastreio = await service.sincronizar("BR-SEM-EVENTO")

    expect(rastreio.status).toBeNull()
    expect(rastreio.atrasado).toBe(false)
  })

  it("A regra de atraso tem teste com data controlada: postado também conta a partir do primeiro evento", async () => {
    const service = servicoCom(
      [
        {
          id: "evt-postado",
          ocorridoEm: new Date(T),
          status: "postado",
          statusBruto: "POSTED",
        },
      ],
      T_MAIS_49H,
    )

    await service.cadastrar("BR-POSTADO")
    const rastreio = await service.sincronizar("BR-POSTADO")

    expect(rastreio.status).toBe("postado")
    expect(rastreio.atrasado).toBe(true)
  })
})

describe("atraso derivado do relógio", () => {
  it("A regra de atraso tem teste com data controlada: atrasado não é gravado, é calculado a cada leitura", async () => {
    const { RastreioService } = await import("../src/domain/rastreio-service.js")
    const { RepositorioEmMemoria } = await import("../src/domain/repositorio.js")
    const repositorio = new RepositorioEmMemoria()
    let agora = new Date("2026-03-01T13:00:00.000Z")
    const service = new RastreioService(
      repositorio,
      {
        consultar: async () => [
          { id: "e1", ocorridoEm: new Date("2026-03-01T12:00:00.000Z"), status: "em_transito", statusBruto: "IN_TRANSIT" },
        ],
      },
      { now: () => agora },
      48 * 60 * 60 * 1000,
    )
    await service.cadastrar("BR1")
    await service.sincronizar("BR1")

    expect(await repositorio.buscar("BR1")).not.toHaveProperty("atrasado")
    agora = new Date("2026-03-03T13:00:00.000Z")
    expect((await service.consultar("BR1")).atrasado).toBe(true)
  })
})
