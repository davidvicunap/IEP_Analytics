import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n";
import type { Lang } from "@/lib/format";
import AppChrome from "@/components/AppChrome";
import { isDemo } from "@/lib/data";

export const metadata: Metadata = {
  title: { default: "IEP Analytics", template: "%s · IEP Analytics" },
  description: "Análisis de acciones de EE.UU. explicado simple · US stock analysis made simple",
  applicationName: "IEP Analytics",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0b0d" },
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
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
    <html lang={lang} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh flex flex-col">
        <I18nProvider initialLang={lang}>
          <AppChrome demo={isDemo()}>{children}</AppChrome>
        </I18nProvider>
      </body>
    </html>
  );
}
