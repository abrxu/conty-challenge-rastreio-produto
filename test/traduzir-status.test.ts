import { describe, expect, it } from "vitest"
import { traduzirStatus, type DialetoDeStatus } from "../src/domain/traduzir-status.js"

const DIALETO: DialetoDeStatus = {
  DELIVERED: "entregue",
  IN_TRANSIT: "em_transito",
}

describe("tradução de status com dialeto", () => {
  it("status conhecido segue o dialeto", () => {
    expect(traduzirStatus("DELIVERED", DIALETO)).toBe("entregue")
  })

  it("caixa e espaços nas pontas não mudam a tradução", () => {
    expect(traduzirStatus(" delivered ", DIALETO)).toBe("entregue")
  })

  it("status que o dialeto não conhece vira excecao, nunca entregue", () => {
    expect(traduzirStatus("TELETRANSPORTE", DIALETO)).toBe("excecao")
    expect(traduzirStatus("DELIVERED_PARCIAL", DIALETO)).toBe("excecao")
  })

  it("nome de propriedade do JavaScript não vaza como status", () => {
    for (const bruto of ["constructor", "__proto__", "toString"]) {
      expect(traduzirStatus(bruto, DIALETO)).toBe("excecao")
    }
  })
})
