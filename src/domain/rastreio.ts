export type StatusRastreio =
  | "postado"
  | "em_transito"
  | "saiu_para_entrega"
  | "entregue"
  | "excecao"

const AVANCO_DO_STATUS: Record<StatusRastreio, number> = {
  postado: 0,
  em_transito: 1,
  saiu_para_entrega: 2,
  excecao: 3,
  entregue: 4,
}

export function compararEventos(a: EventoHistorico, b: EventoHistorico): number {
  const delta = new Date(a.ocorridoEm).getTime() - new Date(b.ocorridoEm).getTime()
  if (delta !== 0) return delta
  return AVANCO_DO_STATUS[a.status] - AVANCO_DO_STATUS[b.status]
}

export interface EventoHistorico {
  id: string
  ocorridoEm: string
  status: StatusRastreio
  statusBruto: string
}

export interface Rastreio {
  codigo: string
  status: StatusRastreio | null
  historico: EventoHistorico[]
}

// O que a API devolve: atrasado depende do relógio, por isso não é gravado.
export interface RastreioComAtraso extends Rastreio {
  atrasado: boolean
}
