"use strict";

import { existsSync, readFileSync } from "node:fs";
import nodemailer from "nodemailer";

function loadEnvFile() {
  if (typeof process.loadEnvFile === "function") {
    process.loadEnvFile();
    return;
  }

  const envPath = ".env";
  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }

    const key = match[1];
    if (process.env[key] !== undefined) {
      continue;
    }

    let value = match[2] ?? "";
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function createTransport() {
  const host = requireEnv("SMTP_HOST");
  const port = Number(requireEnv("SMTP_PORT"));
  const user = requireEnv("SMTP_USER");
  const pass = requireEnv("SMTP_PASS");
  const secure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true";

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  });
}

async function textHuman(message) {
  loadEnvFile();

  if (!message || typeof message !== "string") {
    throw new Error("textHuman(message) requires a non-empty string.");
  }

  const from = process.env.SMS_FROM || requireEnv("SMTP_FROM");
  const to = requireEnv("SMS_TO");
  const transporter = createTransport();

  const info = await transporter.sendMail({
    from,
    to,
    subject: "",
    text: message,
  });
  void info;
}

export { textHuman };
