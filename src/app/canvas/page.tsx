import type { Metadata } from "next";
import { Suspense } from "react";
import CanvasApp from "@/components/canvas/CanvasApp";
import { DeepI18n } from "@/lib/i18n";

export const metadata: Metadata = { title: "Trading Canvas" };

export default function CanvasPage() {
  return (
    <Suspense fallback={null}>
      <DeepI18n>
        <CanvasApp />
      </DeepI18n>
    </Suspense>
  );
}
