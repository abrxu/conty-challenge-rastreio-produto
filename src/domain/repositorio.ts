import type { Rastreio } from "./rastreio.js"

export interface RepositorioRastreio {
  salvar(rastreio: Rastreio): Promise<void>
  buscar(codigo: string): Promise<Rastreio | null>
}

export class RepositorioEmMemoria implements RepositorioRastreio {
  private readonly itens = new Map<string, Rastreio>()

  async salvar(rastreio: Rastreio): Promise<void> {
    this.itens.set(rastreio.codigo, structuredClone(rastreio))
  }

  async buscar(codigo: string): Promise<Rastreio | null> {
    const item = this.itens.get(codigo)
    return item ? structuredClone(item) : null
  }
}
