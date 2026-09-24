// Delays for playback that can be paused, and interrupted for good.

type Pending = {
  remaining: number
  startedAt: number
  timer?: ReturnType<typeof setTimeout>
  resolve: (completed: boolean) => void
}

export class Timeline {
  private paused = false
  private interrupted = false
  private pending: Pending | null = null

  constructor(paused: boolean) {
    this.paused = paused
  }

  get isInterrupted(): boolean {
    return this.interrupted
  }

  /** Clears the interruption, for the next batch. */
  reset(): void {
    this.interrupted = false
  }

  /** Waits `ms` of unpaused time. Resolves `false` if interrupted. */
  sleep(ms: number): Promise<boolean> {
    if (this.interrupted) return Promise.resolve(false)
    return new Promise((resolve) => {
      this.pending = { remaining: Math.max(0, ms), startedAt: 0, resolve }
      if (!this.paused) this.arm(this.pending)
    })
  }

  pause(): void {
    if (this.paused) return
    this.paused = true
    const p = this.pending
    if (p?.timer !== undefined) {
      clearTimeout(p.timer)
      p.timer = undefined
      p.remaining = Math.max(0, p.remaining - (Date.now() - p.startedAt))
    }
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    if (this.pending && this.pending.timer === undefined) this.arm(this.pending)
  }

  interrupt(): void {
    this.interrupted = true
    const p = this.pending
    if (!p) return
    clearTimeout(p.timer)
    this.pending = null
    p.resolve(false)
  }

  private arm(p: Pending): void {
    p.startedAt = Date.now()
    p.timer = setTimeout(() => {
      if (this.pending === p) this.pending = null
      p.resolve(true)
    }, p.remaining)
  }
}
