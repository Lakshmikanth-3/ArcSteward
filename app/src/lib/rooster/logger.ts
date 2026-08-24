/**
 * lib/rooster/logger.ts
 * Structured, secret-redacting logger for the Rooster integration.
 *
 * Log fields like offerId/agentId/state/network/txHash freely. Never let a
 * raw secret reach a log line — this module actively redacts known secret
 * shapes even if a caller passes one in by mistake.
 */

const SECRET_KEY_PATTERN = /(authorization|api[-_]?key|private[-_]?key|secret|password|seed)/i;
const SECRET_VALUE_PATTERNS = [
  /rae_live_[A-Za-z0-9_-]+/g, // Rooster live API key
  /Bearer\s+\S+/gi,
  /suiprivkey[A-Za-z0-9]+/gi, // Sui bech32-style private key
  /0x[a-fA-F0-9]{64}/g, // 32-byte EVM private key
];

function redactString(value: string): string {
  let out = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_PATTERN.test(k) ? "[REDACTED]" : redactValue(v);
    }
    return out;
  }
  return value;
}

export interface RoosterLogFields {
  offerId?: string;
  agentId?: string;
  state?: string;
  network?: string;
  txHash?: string;
  result?: string;
  [key: string]: unknown;
}

function emit(level: "info" | "warn" | "error", message: string, fields?: RoosterLogFields) {
  const safeFields = fields ? (redactValue(fields) as Record<string, unknown>) : undefined;
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope: "rooster",
    message: redactString(message),
    ...safeFields,
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const roosterLogger = {
  info: (message: string, fields?: RoosterLogFields) => emit("info", message, fields),
  warn: (message: string, fields?: RoosterLogFields) => emit("warn", message, fields),
  error: (message: string, fields?: RoosterLogFields) => emit("error", message, fields),
};
