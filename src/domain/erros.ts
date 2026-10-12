export class RastreioNaoEncontrado extends Error {
  constructor(readonly codigo: string) {
    super(`Rastreio não encontrado: ${codigo}`)
    this.name = "RastreioNaoEncontrado"
  }
}

export class CodigoInvalido extends Error {
  constructor() {
    super("Informe um código não vazio")
    this.name = "CodigoInvalido"
  }
}

// A causa original (timeout, rede, payload) fica em `cause` para o log.
export class AgregadorIndisponivel extends Error {
  constructor(
    readonly codigo: string,
    options?: ErrorOptions,
  ) {
    super(`Agregador indisponível para ${codigo}`, options)
    this.name = "AgregadorIndisponivel"
  }
}
