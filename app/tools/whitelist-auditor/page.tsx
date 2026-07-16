import type { Metadata } from "next";
import DummyWalletTester from "@/app/DummyWalletTester";

export const metadata: Metadata = {
  title: "Whitelist Form Auditor",
  description: "Audit whether dummy whitelist data is sent from a website form to a server.",
};

export default function WhitelistAuditorPage() {
  return <DummyWalletTester />;
}
