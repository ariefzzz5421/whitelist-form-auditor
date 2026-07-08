import { NextResponse } from "next/server";
import { chromium } from "playwright-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const token = process.env.BROWSERLESS_TOKEN;

  if (!token) {
    return NextResponse.json(
      { ok: false, error: "BROWSERLESS_TOKEN is not configured." },
      { status: 500 },
    );
  }

  let browser = null;

  try {
    browser = await chromium.connectOverCDP(buildBrowserlessEndpoint(token), {
      timeout: 20_000,
    });
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = await context.newPage();
    await page.goto("about:blank", { timeout: 10_000 });
    await page.close().catch(() => {});

    return NextResponse.json({ ok: true, message: "Connected to Browserless with playwright-core." });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Browserless connection test failed." },
      { status: 500 },
    );
  } finally {
    await browser?.close().catch(() => {});
  }
}

function buildBrowserlessEndpoint(token: string) {
  const endpoint = new URL(process.env.BROWSERLESS_WS_URL || "wss://production-sfo.browserless.io");
  if (!endpoint.searchParams.has("token")) {
    endpoint.searchParams.set("token", token);
  }
  return endpoint.toString();
}
