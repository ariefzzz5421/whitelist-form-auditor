import { NextResponse } from "next/server";
import { runBrowserlessAudit } from "@/lib/browserless-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function GET() {
  const yesUrl = new URL("https://whitelist-form-auditor-5h14cwah3-ariefzzz5421s-projects.vercel.app/audit-fixture");
  const noUrl = new URL("https://whitelist-form-auditor-5h14cwah3-ariefzzz5421s-projects.vercel.app/audit-fixture/no-submit");

  const [yesCase, noCase] = await Promise.all([
    runBrowserlessAudit(yesUrl),
    runBrowserlessAudit(noUrl),
  ]);

  return NextResponse.json({
    yesCase: { verdict: yesCase.verdict, status: yesCase.request?.status ?? null },
    noCase: { verdict: noCase.verdict, status: noCase.request?.status ?? null },
  });
}
