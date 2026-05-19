import kleur from "kleur";
import { deleteConfig, readConfig } from "../config.js";

export function runLogout(): void {
  const existed = readConfig() !== null;
  deleteConfig();
  if (existed) {
    process.stdout.write(`${kleur.green("✔")} Logged out.\n`);
  } else {
    process.stdout.write("No stored credentials to clear.\n");
  }
}
