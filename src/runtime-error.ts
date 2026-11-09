import { redact } from "./credentials.js";

/** Only scalar diagnostics; never serialize a response, URL, headers or nested cause. */
export function runtimeError(error: unknown): string {
  const e = error as { name?: string; data?: { message?: string; statusCode?: number; cause?: unknown }; cause?: unknown } | undefined;
  const message = typeof e?.data?.message === "string" ? e.data.message : typeof e?.name === "string" ? e.name : "unknown worker error";
  const safe = redact(message).replace(/https?:\/\/\S+/gi, "[URL redacted]");
  const details: string[] = [];
  let cause: unknown = error;
  for (let depth = 0; cause && typeof cause === "object" && depth < 3; depth++) {
    const c = cause as { code?: unknown; status?: unknown; statusCode?: unknown; cause?: unknown; data?: unknown };
    if (typeof c.code === "string" && ["ENOENT", "EACCES", "EPERM", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET"].includes(c.code)) details.push(`code=${c.code}`);
    const status = c.statusCode ?? c.status;
    if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) details.push(`status=${status}`);
    cause = c.cause ?? c.data;
  }
  return safe + (details.length ? ` (${[...new Set(details)].join(", ")})` : "");
}
