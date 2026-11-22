import type { MetadataRoute } from "next";

/** Makes the app installable (Add to Home Screen): needed on iPhone to receive notifications. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "IEP Analytics",
    short_name: "IEP",
    description: "Acciones de EE. UU. explicadas con claridad · US stocks, clearly explained",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f6fa",
    theme_color: "#4338ca",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
