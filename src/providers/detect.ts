import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProviderStatus } from "../core/types.js";

const execFileAsync = promisify(execFile);

export async function isCommandAvailable(cmd: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(cmd, args, { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export async function detectProviders(): Promise<ProviderStatus> {
  const [aio, az] = await Promise.all([
    isCommandAvailable("aio", ["--version"]),
    isCommandAvailable("az", ["version"]),
  ]);

  return {
    core: true,
    cloudManager: aio,
    aem: false, // requires explicit --aem-url
    azure: az,
  };
}
