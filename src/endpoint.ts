import { createHash } from "node:crypto";

/** One identity for consent and engine startup. Never echo a rejected URL. */
export function canonicalEndpoint(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("local.base_url must be an http(s) URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || value.includes("?") || value.includes("#")) {
    throw new Error("local.base_url must use HTTP(S) without embedded credentials, query strings or fragments");
  }
  return url.toString().replace(/\/+$/, "");
}
export const endpointFingerprint = (url: string) => createHash("sha256").update(canonicalEndpoint(url)).digest("hex");
