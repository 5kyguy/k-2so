import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { parse } from "smol-toml";

export interface K2soProfile {
  engine: {
    type: "opencode";
    opencode_config: string;
    opencode_url: string;
  };
  agent: {
    name: string;
    default_model: string;
  };
  daemon: {
    port: number;
    host?: string;
    max_concurrent_tasks: number;
    workspace: string;
    state: string;
  };
  notify?: {
    enabled?: boolean;
    command?: string;
  };
}

const DEFAULT_PROFILE: K2soProfile = {
  engine: {
    type: "opencode",
    opencode_config: join(homedir(), ".config", "opencode", "opencode.json"),
    opencode_url: "http://127.0.0.1:4096",
  },
  agent: {
    name: "k2so",
    default_model: "zai-coding/glm-5.2",
  },
  daemon: {
    port: 4178,
    host: "127.0.0.1",
    max_concurrent_tasks: 1,
    workspace: join(homedir(), ".local", "share", "k2so", "workspace"),
    state: join(homedir(), ".local", "state", "k2so"),
  },
};

function expandHome(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

function normalizeProfile(raw: Partial<K2soProfile>): K2soProfile {
  return {
    engine: {
      type: "opencode",
      opencode_config: expandHome(raw.engine?.opencode_config ?? DEFAULT_PROFILE.engine.opencode_config),
      opencode_url: raw.engine?.opencode_url ?? DEFAULT_PROFILE.engine.opencode_url,
    },
    agent: {
      name: raw.agent?.name ?? DEFAULT_PROFILE.agent.name,
      default_model: raw.agent?.default_model ?? DEFAULT_PROFILE.agent.default_model,
    },
    daemon: {
      port: raw.daemon?.port ?? DEFAULT_PROFILE.daemon.port,
      host: raw.daemon?.host ?? DEFAULT_PROFILE.daemon.host,
      max_concurrent_tasks: raw.daemon?.max_concurrent_tasks ?? DEFAULT_PROFILE.daemon.max_concurrent_tasks,
      workspace: expandHome(raw.daemon?.workspace ?? DEFAULT_PROFILE.daemon.workspace),
      state: expandHome(raw.daemon?.state ?? DEFAULT_PROFILE.daemon.state),
    },
    notify: raw.notify
      ? {
          enabled: raw.notify.enabled ?? false,
          command: raw.notify.command ?? "notify-send",
        }
      : undefined,
  };
}

export function defaultProfilePath(): string {
  return process.env.K2SO_PROFILE ?? join(homedir(), ".config", "k2so", "profile.toml");
}

export async function loadProfile(path = defaultProfilePath()): Promise<K2soProfile> {
  try {
    const text = await readFile(path, "utf8");
    return normalizeProfile(parse(text) as Partial<K2soProfile>);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return normalizeProfile({});
    }
    throw err;
  }
}
