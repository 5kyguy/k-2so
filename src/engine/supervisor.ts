import { spawn, type ChildProcess } from "node:child_process";
import type { K2soProfile } from "../config.js";
import { opencodeConfigOverlay } from "../init.js";
import type { OpenCodeEngine } from "./opencode.js";
import type { TaskManager } from "../tasks/manager.js";

const CHECK_INTERVAL_MS = 10_000;
const READY_WAIT_MS = 500;
const READY_ATTEMPTS = 60;
const MAX_RESPAWN_RETRIES = 3;

export class OpenCodeSupervisor {
  private timer?: NodeJS.Timeout;
  private opencodeChild?: ChildProcess;
  private stopped = false;

  constructor(
    private profile: K2soProfile,
    private engine: OpenCodeEngine,
    private manager: TaskManager,
  ) {}

  async ensureReady(): Promise<void> {
    if (await this.engine.isReady()) {
      return;
    }
    await this.respawn("initial startup");
  }

  start(): void {
    this.timer = setInterval(() => {
      void this.check();
    }, CHECK_INTERVAL_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.opencodeChild?.kill("SIGTERM");
  }

  private async check(): Promise<void> {
    if (this.stopped || (await this.engine.isReady())) {
      return;
    }
    console.warn("k2so: opencode health check failed — respawning");
    await this.respawn("health check");
  }

  private async respawn(reason: string): Promise<void> {
    for (let attempt = 1; attempt <= MAX_RESPAWN_RETRIES; attempt++) {
      console.log(`k2so: starting opencode serve (${reason}, attempt ${attempt})…`);
      this.opencodeChild?.kill("SIGTERM");
      this.opencodeChild = spawn("opencode", ["serve", "--port", "4096", "--hostname", "127.0.0.1"], {
        stdio: "inherit",
        env: {
          ...process.env,
          OPENCODE_CONFIG_CONTENT: opencodeConfigOverlay(),
        },
      });

      for (let i = 0; i < READY_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, READY_WAIT_MS));
        if (await this.engine.isReady()) {
          console.log("k2so: opencode ready");
          if (reason !== "initial startup") {
            await this.manager.markInFlightFailed("opencode process restarted");
            void this.manager.resumePump();
          }
          return;
        }
      }
    }

    throw new Error("opencode serve did not become ready after retries");
  }
}
