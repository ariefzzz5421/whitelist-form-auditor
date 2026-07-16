import { NextResponse } from "next/server";
import { runBrowserlessAudit } from "@/lib/browserless-audit";
import { UrlValidationError, validatePublicUrl } from "@/lib/url-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return NextResponse.json({ error: "Request harus memakai application/json." }, { status: 415 });
    }

    const body = await request.json();
    const targetUrl = await validatePublicUrl(body?.url);
    const result = await runBrowserlessAudit(targetUrl);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Audit gagal dijalankan.";
    return NextResponse.json(
      { error: message },
      { status: error instanceof UrlValidationError ? 400 : 500 },
    );
  }
}
