import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

// Placeholder: replaced by the real home / dashboard redirect later.
export default async function Home() {
  const t = await getTranslations();
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 px-4 py-12 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t("common.appName")}</h1>
        <p className="text-muted-foreground">{t("common.tagline")}</p>
      </div>
      <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
        <Link href="/sign-up" className={buttonVariants({ size: "lg" })}>
          {t("nav.signUp")}
        </Link>
        <Link href="/sign-in" className={buttonVariants({ size: "lg", variant: "outline" })}>
          {t("nav.signIn")}
        </Link>
      </div>
    </main>
  );
}
