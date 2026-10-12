import type { Clock } from "./clock.js"
import type { Rastreio } from "./rastreio.js"

export function calcularAtraso(
  rastreio: Rastreio,
  clock: Clock,
  limiteEmTransitoMs: number,
): boolean {
  if (rastreio.status === null || rastreio.status === "entregue") return false
  const inicioMs = rastreio.historico.reduce<number | null>((menor, evento) => {
    const instante = new Date(evento.ocorridoEm).getTime()
    if (menor === null || instante < menor) return instante
    return menor
  }, null)
  if (inicioMs === null) return false
  const decorrido = clock.now().getTime() - inicioMs
  return decorrido > limiteEmTransitoMs
}
