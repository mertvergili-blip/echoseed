import type { ToWorker, FromWorker, FrameData } from "../sim/protocol";
import type { WorldSnapshot } from "../sim/world";
import type { Organism, HistorySample, LineageNode, InterventionType } from "../sim/types";

/**
 * Thin main-thread wrapper around the simulation worker. Owns the Worker
 * instance and exposes typed methods + subscription callbacks.
 */
export class SimClient {
  private worker: Worker;
  private snapshotWaiters = new Map<number, (s: WorldSnapshot) => void>();
  private snapshotToken = 1;

  onFrame: (f: FrameData) => void = () => {};
  onHistory: (h: HistorySample[]) => void = () => {};
  onLineage: (l: LineageNode[]) => void = () => {};
  onOrganism: (o: Organism | null) => void = () => {};
  onReady: () => void = () => {};

  constructor() {
    this.worker = new Worker(new URL("../worker/sim.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.handle(ev.data);
  }

  private handle(msg: FromWorker) {
    switch (msg.type) {
      case "frame":
        this.onFrame(msg.data);
        break;
      case "history":
        this.onHistory(msg.history);
        break;
      case "lineage":
        this.onLineage(msg.lineage);
        break;
      case "organism":
        this.onOrganism(msg.organism);
        break;
      case "ready":
        this.onReady();
        break;
      case "snapshot": {
        const w = this.snapshotWaiters.get(msg.token);
        if (w) {
          w(msg.snapshot);
          this.snapshotWaiters.delete(msg.token);
        }
        break;
      }
    }
  }

  private send(msg: ToWorker) {
    this.worker.postMessage(msg);
  }

  init(seed: string) {
    this.send({ type: "init", seed });
  }
  loadSnapshot(snapshot: WorldSnapshot) {
    this.send({ type: "loadSnapshot", snapshot });
  }
  setSpeed(speed: number) {
    this.send({ type: "setSpeed", speed });
  }
  pause(paused: boolean) {
    this.send({ type: "pause", paused });
  }
  setBackground(background: boolean) {
    this.send({ type: "setBackground", background });
  }
  intervene(intervention: {
    type: InterventionType;
    x?: number;
    y?: number;
    value?: number;
    id?: number;
  }) {
    this.send({ type: "intervene", intervention });
  }
  ascend(id: number) {
    this.send({ type: "ascend", id });
  }
  requestOrganism(id: number) {
    this.send({ type: "requestFullOrganism", id });
  }

  requestSnapshot(): Promise<WorldSnapshot> {
    const token = this.snapshotToken++;
    return new Promise((resolve) => {
      this.snapshotWaiters.set(token, resolve);
      this.send({ type: "requestSnapshot", token });
    });
  }

  destroy() {
    this.worker.terminate();
  }
}
