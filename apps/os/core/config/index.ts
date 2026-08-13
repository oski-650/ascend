// core/config — app settings + the V1 organization singleton (Part IV §IV.5).
// Owns AppConfig (targets) and, later, saved workspaces / favorites / recents.
// Forbidden: holding any business entity. (Absorbed from lib/config.ts.)

import "server-only";
import { promises as fs } from "node:fs";
import { appDataDir, configPath } from "@/core/vault/paths";

export type AppConfig = {
  monthly_target_usd: number;
};

const DEFAULTS: AppConfig = {
  monthly_target_usd: 4000,
};

export async function getConfig(): Promise<AppConfig> {
  await fs.mkdir(appDataDir(), { recursive: true });
  try {
    const raw = await fs.readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

// Re-export the tenant constant beside config for discoverability (defined in domain — D9).
export { ORGANIZATION_ID } from "@/domain";
