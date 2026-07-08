import { NextResponse } from "next/server";
import { runBrowserlessAudit } from "@/lib/audit/browserless-audit";
import { consumeRateLimit, getClientKey } from "@/lib/audit/rate-limit";
import { UrlValidationError, validatePublicTargetUrl } from "@/lib/audit/security";
import { LIVE_AUDIT_RATE_LIMIT } from "@/lib/audit/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function POST(request: Request) {
  const rate = consumeRateLimit(`browserless:${getClientKey(request)}`, LIVE_AUDIT_RATE_LIMIT.limit, LIVE_AUDIT_RATE_LIMIT.windowMs);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit reached. Wait a few minutes before trying again.", rateLimit: buildRateLimitInfo(rate.remaining, rate.resetAt) }, { status: 429, headers: buildRateLimitHeaders(rate.remaining, rate.resetAt) });
  }

  try {
    const body = await request.json();
    const targetUrl = await validatePublicTargetUrl(body?.url);

    if (request.headers.get("accept")?.includes("text/event-stream") || body?.stream === true) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          try {
            const report = await runBrowserlessAudit(targetUrl, (progress) => send("progress", progress));
            send("complete", { ...report, rateLimit: buildRateLimitInfo(rate.remaining, rate.resetAt) });
          } catch (error) {
            send("error", { error: error instanceof Error ? error.message : "Audit failed." });
          } finally {
            controller.close();
          }
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", ...buildRateLimitHeaders(rate.remaining, rate.resetAt) } });
    }

    const report = await runBrowserlessAudit(targetUrl);
    return NextResponse.json({ ...report, rateLimit: buildRateLimitInfo(rate.remaining, rate.resetAt) }, { headers: buildRateLimitHeaders(rate.remaining, rate.resetAt) });
  } catch (error) {
    if (error instanceof UrlValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Audit failed." }, { status: 500 });
  }
}

function secondsUntil(timestamp: number) { return Math.max(1, Math.ceil((timestamp - Date.now()) / 1_000)); }
function buildRateLimitInfo(remaining: number, resetAt: number) { return { limit: LIVE_AUDIT_RATE_LIMIT.limit, remaining, windowMs: LIVE_AUDIT_RATE_LIMIT.windowMs, label: LIVE_AUDIT_RATE_LIMIT.label, resetAt: new Date(resetAt).toISOString() }; }
function buildRateLimitHeaders(remaining: number, resetAt: number) { return { "retry-after": secondsUntil(resetAt).toString(), "x-ratelimit-limit": LIVE_AUDIT_RATE_LIMIT.limit.toString(), "x-ratelimit-remaining": remaining.toString(), "x-ratelimit-reset": new Date(resetAt).toISOString() }; }
