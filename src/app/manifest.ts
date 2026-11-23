import type { MetadataRoute } from "next";

/** Makes the app installable (Add to Home Screen): needed on iPhone to receive notifications. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Investment Edge Platform",
    short_name: "IEP",
    description: "Acciones de EE. UU. explicadas con claridad · US stocks, clearly explained",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#faf9f6",
    theme_color: "#faf9f6",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
