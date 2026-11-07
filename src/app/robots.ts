import type { MetadataRoute } from "next";
import { isGateEnabled } from "@/lib/beta";

export const dynamic = "force-dynamic";

/** During the private beta nothing should be indexed. */
export default function robots(): MetadataRoute.Robots {
  return isGateEnabled()
    ? { rules: { userAgent: "*", disallow: "/" } }
    : { rules: { userAgent: "*", allow: "/" } };
}
