import type { Metadata } from "next";
import { cookies } from "next/headers";
import CalendarView from "@/components/CalendarView";

export async function generateMetadata(): Promise<Metadata> {
  const en = (await cookies()).get("lang")?.value === "en";
  return { title: en ? "Calendar" : "Calendario" };
}

export default function CalendarPage() {
  return <CalendarView />;
}
