import type { Metadata } from "next";
import { cookies } from "next/headers";
import MethodologyView from "@/components/methodology/MethodologyView";

export async function generateMetadata(): Promise<Metadata> {
  const en = (await cookies()).get("lang")?.value === "en";
  return { title: en ? "Methodology" : "Metodología" };
}

export default function MethodologyPage() {
  return <MethodologyView />;
}
