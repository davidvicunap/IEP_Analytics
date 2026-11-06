import type { Metadata } from "next";
import BetaGate from "@/components/BetaGate";
import { safeNextPath } from "@/lib/beta";

export const metadata: Metadata = {
  title: "Beta privada",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ next?: string | string[] }> };

export default async function BetaPage({ searchParams }: Props) {
  const { next } = await searchParams;
  return <BetaGate next={safeNextPath(Array.isArray(next) ? next[0] : next)} />;
}
