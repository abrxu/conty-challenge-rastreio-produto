import type { AgregadorRastreio, EventoDoAgregador } from "./agregador.js"
import { calcularAtraso } from "./atraso.js"
import type { Clock } from "./clock.js"
import { CodigoInvalido, RastreioNaoEncontrado } from "./erros.js"
import type { RepositorioRastreio } from "./repositorio.js"
import {
  compararEventos,
  type EventoHistorico,
  type Rastreio,
  type RastreioComAtraso,
} from "./rastreio.js"

function ordenar(historico: EventoHistorico[]): EventoHistorico[] {
  return [...historico].sort(compararEventos)
}

function paraHistorico(evento: EventoDoAgregador): EventoHistorico {
  return {
    id: evento.id,
    ocorridoEm: evento.ocorridoEm.toISOString(),
    status: evento.status,
    statusBruto: evento.statusBruto,
  }
}

// Com espaços nas pontas, o código continua sendo o mesmo pacote.
function normalizarCodigo(codigo: string): string {
  return codigo.trim()
}

export class RastreioService {
  private readonly filaPorCodigo = new Map<string, Promise<void>>()

  constructor(
    private readonly repositorio: RepositorioRastreio,
    private readonly agregador: AgregadorRastreio,
    private readonly clock: Clock,
    private readonly limiteEmTransitoMs: number,
  ) {}

  private emSerie<T>(codigo: string, trabalho: () => Promise<T>): Promise<T> {
    const anterior = this.filaPorCodigo.get(codigo) ?? Promise.resolve()
    const execucao = anterior.then(trabalho, trabalho)
    const concluida = execucao.then(
      () => undefined,
      () => undefined,
    )
    this.filaPorCodigo.set(codigo, concluida)
    void concluida.then(() => {
      if (this.filaPorCodigo.get(codigo) === concluida) this.filaPorCodigo.delete(codigo)
    })
    return execucao
  }

  async cadastrar(codigo: string): Promise<{ rastreio: RastreioComAtraso; criado: boolean }> {
    const normalizado = normalizarCodigo(codigo)
    if (normalizado.length === 0) throw new CodigoInvalido()
    return this.emSerie(normalizado, () => this.cadastrarSeAusente(normalizado))
  }

  // Roda na fila do código: um cadastro atrasado não pode gravar por cima de uma sincronização já concluída.
  private async cadastrarSeAusente(
    codigo: string,
  ): Promise<{ rastreio: RastreioComAtraso; criado: boolean }> {
    const existente = await this.repositorio.buscar(codigo)
    if (existente) return { rastreio: this.comAtraso(existente), criado: false }

    const rastreio: Rastreio = { codigo, status: null, historico: [] }
    await this.repositorio.salvar(rastreio)
    return { rastreio: this.comAtraso(rastreio), criado: true }
  }

  async sincronizar(codigo: string): Promise<RastreioComAtraso> {
    const normalizado = normalizarCodigo(codigo)
    return this.emSerie(normalizado, () => this.fundir(normalizado))
  }

  private async fundir(codigo: string): Promise<RastreioComAtraso> {
    const atual = await this.repositorio.buscar(codigo)
    if (!atual) throw new RastreioNaoEncontrado(codigo)

    const recebidos = await this.agregador.consultar(codigo)
    const porId = new Map(atual.historico.map((evento) => [evento.id, evento]))
    for (const recebido of recebidos) {
      const evento = paraHistorico(recebido)
      const gravado = porId.get(evento.id)
      // Entregue é final: nenhuma versão nova tira uma entrega já registrada.
      if (gravado?.status === "entregue" && evento.status !== "entregue") continue
      // Mesmo id: fica a versão mais recente; no mesmo instante, a mais adiantada.
      if (!gravado || compararEventos(evento, gravado) > 0) porId.set(evento.id, evento)
    }

    const historico = ordenar([...porId.values()])
    // Um evento mais novo com outro status não tira a entrega.
    const entregue = historico.some((evento) => evento.status === "entregue")
    const status = entregue ? "entregue" : (historico.at(-1)?.status ?? null)
    const rastreio: Rastreio = { codigo: atual.codigo, status, historico }
    await this.repositorio.salvar(rastreio)
    return this.comAtraso(rastreio)
  }

  async consultar(codigo: string): Promise<RastreioComAtraso> {
    const normalizado = normalizarCodigo(codigo)
    const salvo = await this.repositorio.buscar(normalizado)
    if (!salvo) throw new RastreioNaoEncontrado(normalizado)
    return this.comAtraso(salvo)
  }

  private comAtraso(rastreio: Rastreio): RastreioComAtraso {
    return {
      ...rastreio,
      historico: ordenar(rastreio.historico),
      atrasado: calcularAtraso(rastreio, this.clock, this.limiteEmTransitoMs),
    }
  }
}
