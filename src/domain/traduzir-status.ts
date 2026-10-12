import type { StatusRastreio } from "./rastreio.js"

// Dialeto de um agregador: status bruto em maiúsculas → status estável.
export type DialetoDeStatus = Readonly<Record<string, StatusRastreio>>

// Status que o dialeto não conhece vira excecao. Nunca vira entregue.
export function traduzirStatus(statusBruto: string, dialeto: DialetoDeStatus): StatusRastreio {
  const chave = statusBruto.trim().toUpperCase()
  return (Object.hasOwn(dialeto, chave) ? dialeto[chave] : undefined) ?? "excecao"
}
