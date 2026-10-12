import type { Clock } from "./domain/clock.js"

export class RelogioSistema implements Clock {
  now(): Date {
    return new Date()
  }
}
