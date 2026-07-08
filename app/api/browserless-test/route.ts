import puppeteer from "puppeteer-core";

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

  let browser;

  try {
    browser = await puppeteer.connect({
      browserWSEndpoint: endpoint.toString(),
    });

    const page = await browser.newPage();

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
    if (browser) {
      await browser.close();
    }
  }
}
