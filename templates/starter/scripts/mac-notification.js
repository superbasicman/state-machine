"use strict";

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

function escAppleScript(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function notify(title = "Notification", message = "Everything finished!") {
  const script = `display notification "${escAppleScript(message)}" with title "${escAppleScript(title)}"`;
  spawnSync("osascript", ["-e", script], { stdio: "ignore" });

  const soundPath = "/System/Library/Sounds/Glass.aiff";
  const fallbackPath = "/System/Library/Sounds/Ping.aiff";

  if (existsSync(soundPath)) {
    spawnSync("afplay", [soundPath], { stdio: "ignore" });
  } else if (existsSync(fallbackPath)) {
    spawnSync("afplay", [fallbackPath], { stdio: "ignore" });
  }
}

export { notify };
