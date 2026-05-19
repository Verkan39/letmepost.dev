import { defaultBaseUrl } from "../config.js";

export const CLI_VERSION = "0.1.0";

export function runVersion(): void {
  process.stdout.write(`lmp ${CLI_VERSION}\n`);
  process.stdout.write(`api ${defaultBaseUrl()}\n`);
}
