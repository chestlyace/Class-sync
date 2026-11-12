import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Inter, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { ServiceWorker } from "@/components/service-worker";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Page titles and big numbers only.
const bebasNeue = Bebas_Neue({
  variable: "--font-bebas-neue",
  weight: "400",
  subsets: ["latin"],
});

// Small uppercase labels, join codes and matricules.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    // Shared links (the opengraph-image card) need absolute URLs: the app's own host.
    metadataBase: process.env.BETTER_AUTH_URL ? new URL(process.env.BETTER_AUTH_URL) : undefined,
    title: { default: t("appName"), template: `%s · ${t("appName")}` },
    description: t("tagline"),
    openGraph: { type: "website", siteName: t("appName") },
    twitter: { card: "summary_large_image" },
    // Added to the Home Screen on iPhone/iPad: opens as an app, under the plain name.
    appleWebApp: { capable: true, title: "Clasync", statusBarStyle: "default" },
  };
}

// White browser bar and status bar, like the app (light mode by default).
export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, allMessages] = await Promise.all([getLocale(), getMessages()]);
  // The admin strings reach the browser only inside the admin area (its layout adds them), so
  // other pages don't reveal that it exists.
  const messages = Object.fromEntries(Object.entries(allMessages).filter(([namespace]) => namespace !== "admin"));
  return (
    <html
      lang={locale}
      className={`${inter.variable} ${bebasNeue.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
