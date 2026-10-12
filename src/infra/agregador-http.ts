import type { AgregadorRastreio, EventoDoAgregador } from "../domain/agregador.js"
import { AgregadorIndisponivel } from "../domain/erros.js"
import { traduzirStatus, type DialetoDeStatus } from "../domain/traduzir-status.js"

class PayloadDoAgregadorIlegivel extends Error {
  constructor() {
    super("Payload do agregador ilegível")
    this.name = "PayloadDoAgregadorIlegivel"
  }
}

// Único lugar que conhece os status brutos deste agregador.
const DIALETO_DO_AGREGADOR: DialetoDeStatus = {
  POSTED: "postado",
  OBJ_POSTADO: "postado",
  IN_TRANSIT: "em_transito",
  OBJ_EM_TRANSITO: "em_transito",
  OUT_FOR_DELIVERY: "saiu_para_entrega",
  OBJ_SAIU: "saiu_para_entrega",
  DELIVERED: "entregue",
  OBJ_ENTREGUE: "entregue",
  EXCEPTION: "excecao",
  OBJ_EXCECAO: "excecao",
}

const TEMPO_LIMITE_PADRAO_MS = 5_000

// Instante com offset obrigatório: sem fuso, o resultado dependeria da máquina.
const INSTANTE_COM_OFFSET =
  /^(?<ano>\d{4})-(?<mes>\d{2})-(?<dia>\d{2})T(?<hora>\d{2}):(?<minuto>\d{2}):(?<segundo>\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

function lerInstante(texto: unknown): Date {
  if (typeof texto !== "string") throw new PayloadDoAgregadorIlegivel()
  const partes = INSTANTE_COM_OFFSET.exec(texto)?.groups
  if (!partes) throw new PayloadDoAgregadorIlegivel()

  const mes = Number(partes.mes)
  const dia = Number(partes.dia)
  // Dia zero do mês seguinte é o último dia deste mês.
  const ultimoDia = new Date(Date.UTC(Number(partes.ano), mes, 0)).getUTCDate()
  const dataValida = mes >= 1 && mes <= 12 && dia >= 1 && dia <= ultimoDia
  const horarioValido =
    Number(partes.hora) <= 23 && Number(partes.minuto) <= 59 && Number(partes.segundo) <= 59
  const data = new Date(texto)
  if (!dataValida || !horarioValido || Number.isNaN(data.getTime())) {
    throw new PayloadDoAgregadorIlegivel()
  }
  return data
}

function registro(valor: unknown): Record<string, unknown> | null {
  if (typeof valor !== "object" || valor === null) return null
  return valor as Record<string, unknown>
}

// Um evento malformado recusa o payload inteiro: nenhum evento some em silêncio.
function traduzirEvento(item: unknown): EventoDoAgregador {
  const evento = registro(item)
  if (
    !evento ||
    typeof evento.event_id !== "string" ||
    evento.event_id.length === 0 ||
    typeof evento.carrier_status !== "string"
  ) {
    throw new PayloadDoAgregadorIlegivel()
  }
  return {
    id: evento.event_id,
    ocorridoEm: lerInstante(evento.happened_at),
    status: traduzirStatus(evento.carrier_status, DIALETO_DO_AGREGADOR),
    statusBruto: evento.carrier_status,
  }
}

export function traduzirPayloadBruto(
  payload: unknown,
  codigoEsperado?: string,
): EventoDoAgregador[] {
  const corpo = registro(payload)
  if (!corpo || !Array.isArray(corpo.events)) throw new PayloadDoAgregadorIlegivel()
  // Um payload de outro pacote não pode entrar no histórico deste código.
  if (
    codigoEsperado !== undefined &&
    typeof corpo.tracking_code === "string" &&
    corpo.tracking_code !== codigoEsperado
  ) {
    throw new PayloadDoAgregadorIlegivel()
  }
  return corpo.events.map(traduzirEvento)
}

export class AgregadorHttp implements AgregadorRastreio {
  constructor(
    private readonly fetchFn: typeof fetch,
    private readonly baseUrl: string,
    private readonly tempoLimiteMs = TEMPO_LIMITE_PADRAO_MS,
  ) {}

  async consultar(codigo: string): Promise<EventoDoAgregador[]> {
    // Com barra final, a base mantém o próprio caminho ao resolver o relativo.
    const base = this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`
    const url = new URL(`rastreios/${encodeURIComponent(codigo)}`, base)
    let resposta: Response
    try {
      resposta = await this.fetchFn(url, { signal: AbortSignal.timeout(this.tempoLimiteMs) })
    } catch (erro) {
      throw new AgregadorIndisponivel(codigo, { cause: erro })
    }
    // 404: o agregador ainda não tem eventos para o código, como num cadastro recém-feito.
    if (resposta.status === 404) return []
    if (!resposta.ok) {
      throw new AgregadorIndisponivel(codigo, { cause: new Error(`HTTP ${resposta.status}`) })
    }
    let payload: unknown
    try {
      payload = await resposta.json()
    } catch (erro) {
      throw new AgregadorIndisponivel(codigo, { cause: erro })
    }
    try {
      return traduzirPayloadBruto(payload, codigo)
    } catch (erro) {
      if (erro instanceof PayloadDoAgregadorIlegivel) {
        throw new AgregadorIndisponivel(codigo, { cause: erro })
      }
      throw erro
    }
  }
}
