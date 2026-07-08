import { chromium, type Browser } from "playwright-core";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const token = process.env.BROWSERLESS_TOKEN;

  if (!token) {
    return Response.json(
      {
        ok: false,
        error: "BROWSERLESS_TOKEN is missing",
      },
      { status: 500 },
    );
  }

  const baseUrl =
    process.env.BROWSERLESS_WS_URL ??
    "wss://production-sfo.browserless.io";

  const endpoint = new URL(baseUrl);
  endpoint.searchParams.set("token", token);

  let browser: Browser | null = null;

  try {
    browser = await chromium.connectOverCDP(
      endpoint.toString(),
      {
        timeout: 20_000,
      },
    );

    const context =
      browser.contexts()[0] ??
      (await browser.newContext());

    const page = await context.newPage();

    await page.goto("https://example.com", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    const title = await page.title();

    return Response.json({
      ok: true,
      title,
      message: "Browserless connection works",
    });
  } catch (error) {
    console.error("Browserless test failed:", error);

    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown Browserless error",
      },
      { status: 500 },
    );
  } finally {
    await browser?.close().catch(() => {});
  }
}
