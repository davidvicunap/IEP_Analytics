import type { Metadata } from "next";
import { cookies } from "next/headers";
import ResearchList from "@/components/research/ResearchList";

export async function generateMetadata(): Promise<Metadata> {
  const en = (await cookies()).get("lang")?.value === "en";
  return { title: en ? "My research" : "Mi análisis" };
}

export default function ResearchPage() {
  return <ResearchList />;
}
