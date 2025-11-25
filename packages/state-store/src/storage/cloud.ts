import type { StateSnapshot, StateStoreBackend } from "../types";

export interface CloudBackendOptions {
  token: string;
  baseUrl?: string;
}

export class CloudBackend implements StateStoreBackend {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(options: CloudBackendOptions) {
    this.token = options.token;
    this.baseUrl = options.baseUrl ?? "";
  }

  async load(): Promise<StateSnapshot | undefined> {
    try {
      const response = await fetch(this.resolve("/api/reading-state"), {
        method: "GET",
        headers: this.headers(),
      });

      if (response.status === 401) {
        throw new Error("Unauthorized");
      }

      if (response.status === 404) {
        return undefined;
      }

      if (!response.ok) {
        throw new Error(`Failed to load reading state (${response.status})`);
      }

      const snapshot = (await response.json()) as StateSnapshot;
      if (snapshot && typeof snapshot === "object") {
        return snapshot;
      }
    } catch (error) {
      console.warn("[state-store] cloud load failed:", error);
      throw error;
    }

    return undefined;
  }

  async save(snapshot: StateSnapshot): Promise<void> {
    try {
      const response = await fetch(this.resolve("/api/reading-state"), {
        method: "PUT",
        headers: {
          ...this.headers(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(snapshot),
      });

      if (!response.ok) {
        throw new Error(`Failed to save reading state (${response.status})`);
      }
    } catch (error) {
      console.warn("[state-store] cloud save failed:", error);
      throw error;
    }
  }

  private resolve(path: string) {
    if (!this.baseUrl) return path;
    return `${this.baseUrl.replace(/\/$/, "")}${path}`;
  }

  private headers(): HeadersInit {
    return {
      Accept: "application/json",
      Authorization: `Bearer ${this.token}`,
    };
  }
}

export function createCloudBackend(options: CloudBackendOptions) {
  return new CloudBackend(options);
}
