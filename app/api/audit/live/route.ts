import { NextResponse } from "next/server";
import { runLiveAudit } from "@/lib/audit/live-scan";
import { consumeRateLimit, getClientKey } from "@/lib/audit/rate-limit";
import { UrlValidationError, validatePublicTargetUrl } from "@/lib/audit/security";
import { LIVE_AUDIT_RATE_LIMIT } from "@/lib/audit/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const rate = consumeRateLimit(
    `live:${getClientKey(request)}`,
    LIVE_AUDIT_RATE_LIMIT.limit,
    LIVE_AUDIT_RATE_LIMIT.windowMs,
  );
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: "Rate limit reached. Wait a few minutes before trying again.",
        rateLimit: buildRateLimitInfo(rate.remaining, rate.resetAt),
      },
      { status: 429, headers: buildRateLimitHeaders(rate.remaining, rate.resetAt) },
    );
  }

  try {
    const body = await request.json();
    const targetUrl = await validatePublicTargetUrl(body?.url);
    const report = await runLiveAudit(targetUrl);
    return NextResponse.json(
      {
        ...report,
        rateLimit: buildRateLimitInfo(rate.remaining, rate.resetAt),
      },
      { headers: buildRateLimitHeaders(rate.remaining, rate.resetAt) },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  if (error instanceof UrlValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const message = error instanceof Error ? error.message : "Live audit failed.";
  if (/Executable doesn't exist|browserType\.launch|chromium/i.test(message)) {
    return NextResponse.json(
      { error: "Live audit needs Playwright Chromium installed on this machine." },
      { status: 503 },
    );
  }

  const status = /timed out|Timeout/i.test(message) ? 504 : 502;
  return NextResponse.json({ error: message }, { status });
}

function secondsUntil(timestamp: number) {
  return Math.max(1, Math.ceil((timestamp - Date.now()) / 1_000));
}

function buildRateLimitInfo(remaining: number, resetAt: number) {
  return {
    limit: LIVE_AUDIT_RATE_LIMIT.limit,
    remaining,
    windowMs: LIVE_AUDIT_RATE_LIMIT.windowMs,
    label: LIVE_AUDIT_RATE_LIMIT.label,
    resetAt: new Date(resetAt).toISOString(),
  };
}

function buildRateLimitHeaders(remaining: number, resetAt: number) {
  return {
    "retry-after": secondsUntil(resetAt).toString(),
    "x-ratelimit-limit": LIVE_AUDIT_RATE_LIMIT.limit.toString(),
    "x-ratelimit-remaining": remaining.toString(),
    "x-ratelimit-reset": new Date(resetAt).toISOString(),
  };
}
