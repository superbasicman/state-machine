#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");

function escAppleScript(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const args = process.argv.slice(2);
const title = args[0] || "Notification";
const message = args.slice(1).join(" ") || "Everything finished!";

const script = `display notification "${escAppleScript(message)}" with title "${escAppleScript(title)}"`;
spawnSync("osascript", ["-e", script], { stdio: "ignore" });

const soundPath = "/System/Library/Sounds/Glass.aiff";
if (fs.existsSync(soundPath)) {
  spawnSync("afplay", [soundPath], { stdio: "ignore" });
} else {
  // fallback: still make a sound if the file isn't there for some reason
  spawnSync("afplay", ["/System/Library/Sounds/Ping.aiff"], { stdio: "ignore" });
}
