export type EventMap = Record<string, unknown>;

export class EventBus<Events extends EventMap> {
  private readonly listeners = new Map<keyof Events, Set<(payload: unknown) => void>>();

  emit<EventKey extends keyof Events>(event: EventKey, payload: Events[EventKey]) {
    const handlers = this.listeners.get(event) as Set<(payload: Events[EventKey]) => void> | undefined;
    if (!handlers) return;
    for (const handler of handlers) {
      handler(payload);
    }
  }

  on<EventKey extends keyof Events>(event: EventKey, handler: (payload: Events[EventKey]) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as (payload: unknown) => void);
  }

  off<EventKey extends keyof Events>(event: EventKey, handler: (payload: Events[EventKey]) => void) {
    this.listeners.get(event)?.delete(handler as unknown as (payload: unknown) => void);
  }
}
