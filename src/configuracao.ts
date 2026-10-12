export interface Configuracao {
  porta: number
  limiteEmTransitoMs: number
  agregadorUrl: string
}

const HORA_EM_MS = 60 * 60 * 1000

// Valor inválido falha ao subir. Um limite NaN ou infinito faria o atraso nunca disparar, sem aviso.
export function lerConfiguracao(env: NodeJS.ProcessEnv): Configuracao {
  return {
    porta: lerPorta(env.PORT),
    limiteEmTransitoMs: lerLimiteEmMs(env.LIMITE_EM_TRANSITO_HORAS),
    agregadorUrl: lerAgregadorUrl(env.AGREGADOR_URL),
  }
}

function lerPorta(valor: string | undefined): number {
  if (valor === undefined || valor.trim() === "") return 3000
  const porta = Number(valor)
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    throw new Error(`PORT precisa ser um inteiro entre 1 e 65535: ${valor}`)
  }
  return porta
}

function lerLimiteEmMs(valor: string | undefined): number {
  if (valor === undefined || valor.trim() === "") return 48 * HORA_EM_MS
  const limiteEmMs = Number(valor) * HORA_EM_MS
  if (!Number.isFinite(limiteEmMs) || limiteEmMs <= 0) {
    throw new Error(
      `LIMITE_EM_TRANSITO_HORAS precisa ser um número de horas maior que zero: ${valor}`,
    )
  }
  return limiteEmMs
}

// Espaços nas pontas não fazem parte da URL: sem isso, toda sincronização responderia 502.
function lerAgregadorUrl(valor: string | undefined): string {
  const url = valor?.trim() ?? ""
  // Padrão: o agregador fictício de examples/.
  if (url === "") return "http://127.0.0.1:9099"
  if (!URL.canParse(url)) throw new Error(`AGREGADOR_URL não é uma URL válida: ${valor}`)
  const { protocol } = new URL(url)
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(`AGREGADOR_URL precisa ser http ou https: ${valor}`)
  }
  return url
}
