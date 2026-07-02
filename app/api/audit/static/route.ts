import { NextResponse } from "next/server";
import { consumeRateLimit, getClientKey } from "@/lib/audit/rate-limit";
import { fetchTargetHtml, UrlValidationError, validatePublicTargetUrl } from "@/lib/audit/security";
import { scanStaticHtml } from "@/lib/audit/static-scan";
import { STATIC_AUDIT_RATE_LIMIT } from "@/lib/audit/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(request: Request) {
  const rate = consumeRateLimit(
    `static:${getClientKey(request)}`,
    STATIC_AUDIT_RATE_LIMIT.limit,
    STATIC_AUDIT_RATE_LIMIT.windowMs,
  );
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit reached. Wait a minute before scanning again." },
      { status: 429, headers: { "retry-after": secondsUntil(rate.resetAt).toString() } },
    );
  }

  try {
    const body = await request.json();
    const targetUrl = await validatePublicTargetUrl(body?.url);
    const html = await fetchTargetHtml(targetUrl);
    const report = scanStaticHtml(html, targetUrl);
    return NextResponse.json(report);
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  if (error instanceof UrlValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const message = error instanceof Error ? error.message : "Static scan failed.";
  const status = /timed out/i.test(message) ? 504 : 502;
  return NextResponse.json({ error: message }, { status });
}

function secondsUntil(timestamp: number) {
  return Math.max(1, Math.ceil((timestamp - Date.now()) / 1_000));
}
