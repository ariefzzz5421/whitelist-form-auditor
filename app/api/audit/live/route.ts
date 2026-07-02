import { NextResponse } from "next/server";
import { runLiveAudit } from "@/lib/audit/live-scan";
import { consumeRateLimit, getClientKey } from "@/lib/audit/rate-limit";
import { UrlValidationError, validatePublicTargetUrl } from "@/lib/audit/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const rate = consumeRateLimit(`live:${getClientKey(request)}`, 4, 5 * 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Live audit rate limit reached. Wait a few minutes before trying again." },
      { status: 429, headers: { "retry-after": secondsUntil(rate.resetAt).toString() } },
    );
  }

  try {
    const body = await request.json();
    const targetUrl = await validatePublicTargetUrl(body?.url);
    const report = await runLiveAudit(targetUrl);
    return NextResponse.json(report);
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
