import dns from "node:dns/promises";
import net from "node:net";

export const MAX_HTML_BYTES = 2_000_000;
export const STATIC_FETCH_TIMEOUT_MS = 8_000;
export const LIVE_AUDIT_TIMEOUT_MS = 20_000;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
]);

export class UrlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlValidationError";
  }
}

export async function validatePublicTargetUrl(rawUrl: unknown) {
  if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    throw new UrlValidationError("Enter a target URL.");
  }

  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new UrlValidationError("Enter a valid URL, including http:// or https://.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlValidationError("Only http and https URLs are allowed.");
  }

  if (url.username || url.password) {
    throw new UrlValidationError("URLs with embedded usernames or passwords are not allowed.");
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname) {
    throw new UrlValidationError("URL hostname is missing.");
  }

  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new UrlValidationError("Local and private network hosts are blocked.");
  }

  if (net.isIP(hostname)) {
    assertPublicIp(hostname);
    return url;
  }

  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new UrlValidationError("Target hostname could not be resolved.");
  }

  if (resolved.length === 0) {
    throw new UrlValidationError("Target hostname could not be resolved.");
  }

  for (const address of resolved) {
    assertPublicIp(address.address);
  }

  return url;
}

export function validateNavigationUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UrlValidationError("Unsafe redirect destination was blocked.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlValidationError("Unsafe redirect destination was blocked.");
  }
  const hostname = normalizeHostname(url.hostname);
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new UrlValidationError("Unsafe redirect destination was blocked.");
  }
  if (net.isIP(hostname)) {
    assertPublicIp(hostname);
  }
  return url;
}

export async function fetchTargetHtml(url: URL) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STATIC_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
        "user-agent": "WhitelistFormAuditor/1.0 (+https://local.audit)",
      },
    });

    if (isRedirectStatus(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Target redirected without a Location header.");
      const nextUrl = new URL(location, url);
      await validatePublicTargetUrl(nextUrl.toString());
      return fetchTargetHtml(nextUrl);
    }

    if (!response.ok) {
      throw new Error(`Target returned HTTP ${response.status}.`);
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_HTML_BYTES) {
      throw new Error("Target HTML is too large to scan.");
    }

    const contentType = response.headers.get("content-type") || "";
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml") &&
      !contentType.includes("text/plain")
    ) {
      throw new Error("Target did not return HTML.");
    }

    return await readLimitedText(response, MAX_HTML_BYTES);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Target request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeHostname(hostname: string) {
  return hostname.replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "").toLowerCase();
}

function assertPublicIp(ip: string) {
  if (isBlockedIp(ip)) {
    throw new UrlValidationError("Local and private IP ranges are blocked.");
  }
}

function isBlockedIp(ip: string) {
  const version = net.isIP(ip);
  if (version === 4) {
    return isBlockedIpv4(ip);
  }

  if (version === 6) {
    return isBlockedIpv6(ip);
  }

  return true;
}

function isBlockedIpv4(ip: string) {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isBlockedIpv6(ip: string) {
  const value = ip.toLowerCase().split("%")[0];

  if (value === "::" || value === "::1") {
    return true;
  }

  if (value.startsWith("::ffff:")) {
    const mapped = value.replace("::ffff:", "");
    if (net.isIP(mapped) === 4) {
      return isBlockedIpv4(mapped);
    }
  }

  const firstSegment = value.split(":")[0];
  const first = Number.parseInt(firstSegment || "0", 16);

  return (
    Number.isNaN(first) ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    value.startsWith("2001:db8")
  );
}

async function readLimitedText(response: Response, byteLimit: number) {
  if (!response.body) {
    return response.text();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (!value) {
      continue;
    }

    total += value.byteLength;
    if (total > byteLimit) {
      await reader.cancel();
      throw new Error("Target HTML is too large to scan.");
    }

    chunks.push(value);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(combined);
}

function isRedirectStatus(status: number) {
  return status >= 300 && status < 400;
}
