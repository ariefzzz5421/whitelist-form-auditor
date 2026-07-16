import dns from "node:dns/promises";
import net from "node:net";

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"]);

export class UrlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlValidationError";
  }
}

export async function validatePublicUrl(rawUrl: unknown) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new UrlValidationError("Masukkan URL endpoint terlebih dahulu.");
  }

  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new UrlValidationError("Format URL tidak valid.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlValidationError("Hanya URL http dan https yang diperbolehkan.");
  }
  if (url.username || url.password) {
    throw new UrlValidationError("URL dengan username atau password tidak diperbolehkan.");
  }

  const hostname = url.hostname.replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "").toLowerCase();
  if (
    !hostname ||
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new UrlValidationError("Host lokal dan jaringan private diblokir.");
  }

  if (net.isIP(hostname)) {
    assertPublicIp(hostname);
    return url;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new UrlValidationError("Hostname tidak dapat ditemukan.");
  }

  if (!addresses.length) {
    throw new UrlValidationError("Hostname tidak memiliki alamat IP.");
  }
  addresses.forEach(({ address }) => assertPublicIp(address));
  return url;
}

function assertPublicIp(ip: string) {
  if (isBlockedIp(ip)) {
    throw new UrlValidationError("Alamat IP lokal atau private diblokir.");
  }
}

function isBlockedIp(ip: string) {
  const version = net.isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ip);
  return true;
}

function isBlockedIpv4(ip: string) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
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
  if (value === "::" || value === "::1") return true;
  if (value.startsWith("::ffff:")) {
    const mapped = value.replace("::ffff:", "");
    if (net.isIP(mapped) === 4) return isBlockedIpv4(mapped);
  }
  const first = Number.parseInt(value.split(":")[0] || "0", 16);
  return (
    Number.isNaN(first) ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    value.startsWith("2001:db8")
  );
}
