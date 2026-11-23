import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
// Page titles: a self-hosted serif (no third-party font requests), paired with Geist for the interface.
import "@fontsource-variable/newsreader/opsz.css";
import { I18nProvider } from "@/lib/i18n";
import es from "@/lib/i18n/es";
import en from "@/lib/i18n/en";
import type { Lang } from "@/lib/format";
import AppChrome from "@/components/AppChrome";
import { isDemo } from "@/lib/data";

export const metadata: Metadata = {
  title: { default: "Investment Edge Platform (IEP)", template: "%s · IEP" },
  description: "Análisis de acciones de EE.UU. explicado simple · US stock analysis made simple",
  applicationName: "Investment Edge Platform",
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  // Installable on phones (Add to Home Screen), which iPhone needs for notifications.
  appleWebApp: { capable: true, title: "IEP", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#151514" },
    { media: "(prefers-color-scheme: light)", color: "#faf9f6" },
  ],
};

// Applies the saved theme before paint to avoid a flash.
const themeScript = `try{var t=localStorage.getItem('iep.theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

async function detectLang(): Promise<Lang> {
  const c = (await cookies()).get("lang")?.value;
  if (c === "es" || c === "en") return c;
  const al = (await headers()).get("accept-language") ?? "";
  return al.toLowerCase().startsWith("en") ? "en" : "es";
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await detectLang();
  return (
    <html lang={lang} suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh flex flex-col">
        <I18nProvider initialLang={lang} dict={lang === "en" ? en : es}>
          <AppChrome demo={isDemo()}>{children}</AppChrome>
        </I18nProvider>
      </body>
    </html>
  );
}
