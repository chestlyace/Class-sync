import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { ErrorCodeMessage } from "@/components/action-error";
import { SectionHeading } from "@/components/page-header";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/locale";
import { formatDecimal } from "@/lib/number-format";
import { getMyCa } from "@/server/performance/service";
import { loadPage } from "../../load-page";

/**
 * The signed-in student's own CA on a course: the final number out of the total, what counts so
 * far, one row per part and the missing-work count. Their numbers only: no rank, no classmates.
 */
export async function MyCa({ courseId }: { courseId: string }) {
  const [t, rawLocale] = await Promise.all([
    getTranslations("performance.student"),
    getLocale(),
  ]);
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const result = await loadPage((ctx) => getMyCa(ctx, courseId));
  const num = (value: number) => formatDecimal(value, locale);

  return (
    <section aria-labelledby="my-ca" className="flex flex-col gap-4">
      <SectionHeading id="my-ca">{t("title")}</SectionHeading>
      {!result.ok ? (
        <p role="alert" className="text-sm text-destructive">
          <ErrorCodeMessage code={result.code} />
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1 rounded-3xl border px-5 py-5 sm:px-7">
            <p className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-display text-7xl leading-none">
                {num(result.data.result.final)}
              </span>
              <span className="font-mono text-sm tracking-[0.04em] text-muted-foreground">
                {t("outOf", { total: num(result.data.result.total) })}
              </span>
            </p>
            {result.data.result.components.some((c) => c.score !== null) && (
              <p className="text-sm text-muted-foreground">
                {t("soFar", {
                  score: num(result.data.result.soFar),
                  max: num(result.data.result.soFarOutOf),
                })}
              </p>
            )}
          </div>
          <ul
            aria-label={t("componentsLabel")}
            className="flex flex-col divide-y rounded-3xl border"
          >
            {result.data.result.components.map((c) => (
              <li key={c.key} className="flex flex-col gap-1 px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-medium">{t(`name.${c.key}`)}</span>
                  {c.score === null ? (
                    <span className="text-sm text-muted-foreground">
                      {t("notStarted")}
                    </span>
                  ) : (
                    <span className="font-mono text-sm tracking-[0.04em]">
                      {t("score", {
                        score: num(c.score),
                        points: num(c.points),
                      })}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {c.key === "participation"
                    ? t("how.participation", {
                        target: result.data.settings.participationTarget,
                      })
                    : t(`how.${c.key}`)}
                </p>
              </li>
            ))}
          </ul>
          {result.data.missingWork > 0 && (
            <p className="text-sm">
              {t("missingWork", { count: result.data.missingWork })}
              {" · "}
              <Link
                href="#my-assignments"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {t("seeAssignments")}
              </Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}
