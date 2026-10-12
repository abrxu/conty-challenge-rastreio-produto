import type { StatusRastreio } from "./rastreio.js"

export interface EventoDoAgregador {
  id: string
  ocorridoEm: Date
  status: StatusRastreio
  statusBruto: string
}

export interface AgregadorRastreio {
  consultar(codigo: string): Promise<EventoDoAgregador[]>
}
