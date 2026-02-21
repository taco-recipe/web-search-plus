type State = {
  failures: number;
  openedUntil: number;
};

export class CircuitBreakerRegistry {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly states = new Map<string, State>();

  constructor(failureThreshold: number, cooldownMs: number) {
    this.failureThreshold = Math.max(1, failureThreshold);
    this.cooldownMs = Math.max(1000, cooldownMs);
  }

  isAvailable(provider: string): boolean {
    const state = this.states.get(provider);
    if (!state) return true;
    return Date.now() >= state.openedUntil;
  }

  recordSuccess(provider: string): void {
    this.states.set(provider, { failures: 0, openedUntil: 0 });
  }

  recordFailure(provider: string): void {
    const prev = this.states.get(provider) || { failures: 0, openedUntil: 0 };
    const failures = prev.failures + 1;
    const openedUntil = failures >= this.failureThreshold ? Date.now() + this.cooldownMs : 0;
    this.states.set(provider, { failures, openedUntil });
  }

  status(provider: string): "open" | "closed" {
    return this.isAvailable(provider) ? "closed" : "open";
  }
}
