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
    socket_path: string;
    max_concurrent_tasks: number;
    workspace: string;
    state: string;
  };
  notify?: {
    enabled?: boolean;
    command?: string;
  };
  retention?: {
    max_age_days?: number;
    max_tasks?: number;
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
    socket_path: join(homedir(), ".local", "state", "k2so", "k2so.sock"),
    max_concurrent_tasks: 1,
    workspace: join(homedir(), ".local", "share", "k2so", "workspace"),
    state: join(homedir(), ".local", "state", "k2so"),
  },
  retention: {
    max_age_days: 14,
    max_tasks: 200,
  },
};

function expandHome(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

function normalizeProfile(raw: Partial<K2soProfile>): K2soProfile {
  const state = expandHome(raw.daemon?.state ?? DEFAULT_PROFILE.daemon.state);
  const socketPath = expandHome(raw.daemon?.socket_path ?? join(state, "k2so.sock"));

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
      socket_path: socketPath,
      max_concurrent_tasks: raw.daemon?.max_concurrent_tasks ?? DEFAULT_PROFILE.daemon.max_concurrent_tasks,
      workspace: expandHome(raw.daemon?.workspace ?? DEFAULT_PROFILE.daemon.workspace),
      state,
    },
    notify: raw.notify
      ? {
          enabled: raw.notify.enabled ?? false,
          command: raw.notify.command ?? "notify-send",
        }
      : undefined,
    retention: {
      max_age_days: raw.retention?.max_age_days ?? DEFAULT_PROFILE.retention?.max_age_days,
      max_tasks: raw.retention?.max_tasks ?? DEFAULT_PROFILE.retention?.max_tasks,
    },
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
