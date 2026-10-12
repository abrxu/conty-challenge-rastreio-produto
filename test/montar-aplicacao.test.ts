import { describe, expect, it } from "vitest"
import { montarAplicacao } from "../src/composicao.js"
import { lerConfiguracao } from "../src/configuracao.js"
import type { Clock } from "../src/domain/clock.js"

describe("Avisar quando o tempo em trânsito passar de um limite configurável", () => {
  it("Avisar quando o tempo em trânsito passar de um limite configurável: o limite lido do ambiente chega ao campo atrasado", async () => {
    let agora = new Date("2026-03-01T13:00:00.000Z")
    const relogio: Clock = { now: () => agora }
    const configuracao = lerConfiguracao({
      LIMITE_EM_TRANSITO_HORAS: "72",
      AGREGADOR_URL: "http://agregador.test",
    })
    const app = montarAplicacao(configuracao, {
      fetch: async () =>
        Response.json({
          tracking_code: "BR-LIMITE",
          events: [
            {
              event_id: "evt-1",
              happened_at: "2026-03-01T12:00:00.000Z",
              carrier_status: "IN_TRANSIT",
            },
          ],
        }),
      clock: relogio,
    })

    try {
      await app.inject({ method: "POST", url: "/rastreios", payload: { codigo: "BR-LIMITE" } })
      await app.inject({ method: "POST", url: "/rastreios/BR-LIMITE/sincronizar" })

      // 60 horas depois do primeiro evento: dentro do limite de 72 horas.
      agora = new Date("2026-03-04T00:00:00.000Z")
      const dentroDoLimite = await app.inject({ method: "GET", url: "/rastreios/BR-LIMITE" })

      // 73 horas depois do primeiro evento: passou do limite.
      agora = new Date("2026-03-04T13:00:00.000Z")
      const passouDoLimite = await app.inject({ method: "GET", url: "/rastreios/BR-LIMITE" })

      expect(dentroDoLimite.json().atrasado).toBe(false)
      expect(passouDoLimite.json().atrasado).toBe(true)
    } finally {
      await app.close()
    }
  })
})
