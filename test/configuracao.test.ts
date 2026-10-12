import { describe, expect, it } from "vitest"
import { lerConfiguracao } from "../src/configuracao.js"

describe("Avisar quando o tempo em trânsito passar de um limite configurável", () => {
  it("Avisar quando o tempo em trânsito passar de um limite configurável: padrões são porta 3000, 48 horas e o agregador fictício de examples/", () => {
    expect(lerConfiguracao({})).toEqual({
      porta: 3000,
      limiteEmTransitoMs: 48 * 60 * 60 * 1000,
      agregadorUrl: "http://127.0.0.1:9099",
    })
  })

  it("Avisar quando o tempo em trânsito passar de um limite configurável: LIMITE_EM_TRANSITO_HORAS vira milissegundos", () => {
    expect(lerConfiguracao({ LIMITE_EM_TRANSITO_HORAS: "72" }).limiteEmTransitoMs).toBe(
      72 * 60 * 60 * 1000,
    )
  })

  it.each(["quarenta", "0", "-3", "1e305"])(
    "Avisar quando o tempo em trânsito passar de um limite configurável: limite inválido (%s) falha ao subir em vez de desligar o aviso",
    (valor) => {
      expect(() => lerConfiguracao({ LIMITE_EM_TRANSITO_HORAS: valor })).toThrow(
        /LIMITE_EM_TRANSITO_HORAS/,
      )
    },
  )

  it.each(["abc", "0", "70000", "3.5"])("porta inválida (%s) falha ao subir", (valor) => {
    expect(() => lerConfiguracao({ PORT: valor })).toThrow(/PORT/)
  })

  it("AGREGADOR_URL precisa ser uma URL http ou https", () => {
    expect(() => lerConfiguracao({ AGREGADOR_URL: "ftp://agregador.test" })).toThrow(
      /AGREGADOR_URL/,
    )
    expect(() => lerConfiguracao({ AGREGADOR_URL: "não é url" })).toThrow(/AGREGADOR_URL/)
  })

  it("AGREGADOR_URL com espaços nas pontas é normalizado, para não virar URL inválida", () => {
    expect(lerConfiguracao({ AGREGADOR_URL: " http://agregador.test " }).agregadorUrl).toBe(
      "http://agregador.test",
    )
  })
})
