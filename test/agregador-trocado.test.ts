import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { AgregadorRastreio, EventoDoAgregador } from "../src/domain/agregador.js"
import type { Clock } from "../src/domain/clock.js"
import type { RastreioComAtraso } from "../src/domain/rastreio.js"
import { RastreioService } from "../src/domain/rastreio-service.js"
import { RepositorioEmMemoria } from "../src/domain/repositorio.js"
import { traduzirStatus, type DialetoDeStatus } from "../src/domain/traduzir-status.js"
import { AgregadorHttp } from "../src/infra/agregador-http.js"

const LIMITE_48H_MS = 48 * 60 * 60 * 1000
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const DIALETO_OUTRO: DialetoDeStatus = { EM_ROTA: "em_transito", CHEGOU: "entregue" }

// Outro agregador: outro formato de resposta e outro dialeto. Implementa só a porta.
class AgregadorOutroFormato implements AgregadorRastreio {
  constructor(private readonly corpo: unknown) {}

  async consultar(): Promise<EventoDoAgregador[]> {
    const { movimentos } = this.corpo as {
      movimentos: { uid: string; quando: string; situacao: string }[]
    }
    return movimentos.map((movimento) => ({
      id: movimento.uid,
      ocorridoEm: new Date(movimento.quando),
      status: traduzirStatus(movimento.situacao, DIALETO_OUTRO),
      statusBruto: movimento.situacao,
    }))
  }
}

function fontesDoDominio(diretorio: string): string {
  const partes: string[] = []
  for (const nome of readdirSync(diretorio)) {
    const caminho = join(diretorio, nome)
    if (statSync(caminho).isDirectory()) {
      partes.push(fontesDoDominio(caminho))
    } else if (nome.endsWith(".ts")) {
      partes.push(readFileSync(caminho, "utf8"))
    }
  }
  return partes.join("\n")
}

async function sincronizar(agregador: AgregadorRastreio, agora: string): Promise<RastreioComAtraso> {
  const clock: Clock = { now: () => new Date(agora) }
  const service = new RastreioService(new RepositorioEmMemoria(), agregador, clock, LIMITE_48H_MS)
  await service.cadastrar("BR-TROCA")
  return service.sincronizar("BR-TROCA")
}

function visaoEstavel(rastreio: RastreioComAtraso): unknown {
  return {
    status: rastreio.status,
    atrasado: rastreio.atrasado,
    historico: rastreio.historico.map(({ id, ocorridoEm, status }) => ({ id, ocorridoEm, status })),
  }
}

describe("O agregador pode ser trocado sem espalhar o formato dele pelo resto do código", () => {
  it("O agregador pode ser trocado sem espalhar o formato dele pelo resto do código: dois agregadores com os mesmos fatos dão o mesmo rastreio", async () => {
    const http = new AgregadorHttp(
      async () =>
        Response.json({
          tracking_code: "BR-TROCA",
          events: [
            {
              event_id: "evt-1",
              happened_at: "2026-03-01T12:00:00.000Z",
              carrier_status: "IN_TRANSIT",
            },
            {
              event_id: "evt-2",
              happened_at: "2026-03-02T12:00:00.000Z",
              carrier_status: "DELIVERED",
            },
          ],
        }),
      "http://agregador.test",
    )
    const outro = new AgregadorOutroFormato({
      movimentos: [
        { uid: "evt-1", quando: "2026-03-01T12:00:00.000Z", situacao: "EM_ROTA" },
        { uid: "evt-2", quando: "2026-03-02T12:00:00.000Z", situacao: "CHEGOU" },
      ],
    })
    const agora = "2026-03-02T13:00:00.000Z"

    const pelaHttp = await sincronizar(http, agora)
    const pelaOutra = await sincronizar(outro, agora)

    expect(visaoEstavel(pelaOutra)).toEqual(visaoEstavel(pelaHttp))
    expect(pelaHttp.status).toBe("entregue")
  })

  it("O agregador pode ser trocado sem espalhar o formato dele pelo resto do código: o domínio não contém chaves nem status brutos", () => {
    const fontes = fontesDoDominio(join(RAIZ, "src", "domain"))

    for (const termo of [
      "event_id",
      "carrier_status",
      "happened_at",
      "tracking_code",
      "POSTED",
      "OBJ_POSTADO",
      "IN_TRANSIT",
      "OBJ_EM_TRANSITO",
      "OUT_FOR_DELIVERY",
      "OBJ_SAIU",
      "DELIVERED",
      "OBJ_ENTREGUE",
      "EXCEPTION",
      "OBJ_EXCECAO",
      "EM_ROTA",
      "CHEGOU",
    ]) {
      expect(fontes).not.toContain(termo)
    }
  })
})
