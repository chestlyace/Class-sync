import { randomInt } from "node:crypto";
import { and, eq, gt, isNotNull, isNull, ne } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { localesOf } from "@/server/assignments/queries";
import { AppError } from "@/server/core/errors";
import type { Ctx, Locale } from "@/server/core/context";
import type { Db } from "@/server/db";
import {
  classStudent,
  course,
  whatsappConnectCode,
  whatsappLink,
  whatsappPreference,
} from "@/server/db/schema";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import { isAllowedWhatsAppNumber, whatsAppConfig } from "./config";
import { whatsAppProvider } from "./provider";

const allMessages = { en, fr } as const;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const CODE_TTL_MS = 15 * 60_000;

export type WhatsAppPrefs = {
  checkin: boolean;
  tests: boolean;
  results: boolean;
  assignments: boolean;
  classSoon: boolean;
};

const DEFAULT_PREFS: WhatsAppPrefs = {
  checkin: true,
  tests: true,
  results: true,
  assignments: true,
  classSoon: true,
};
const PREF_KEYS = Object.keys(DEFAULT_PREFS) as (keyof WhatsAppPrefs)[];

function newCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++)
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** Starts linking: a short-lived code, and a wa.me link that opens WhatsApp with `JOIN <code>` ready to send. */
export async function createConnectCode(
  ctx: Ctx,
): Promise<{ code: string; url: string; expiresAt: Date }> {
  const config = whatsAppConfig();
  if (!config) throw new AppError("NOT_FOUND", "WhatsApp is not set up");
  const number = config.displayNumber.replace(/\D/g, "");
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  // A collision on the 6-character code is very unlikely; retry a few times rather than fail.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    const created = await ctx.db.transaction(async (tx) => {
      await tx
        .delete(whatsappConnectCode)
        .where(
          and(
            eq(whatsappConnectCode.userId, ctx.user.id),
            isNull(whatsappConnectCode.usedAt),
          ),
        );
      const rows = await tx
        .insert(whatsappConnectCode)
        .values({ code, userId: ctx.user.id, expiresAt })
        .onConflictDoNothing()
        .returning({ code: whatsappConnectCode.code });
      return rows.length > 0;
    });
    if (created)
      return {
        code,
        url: `https://wa.me/${number}?text=JOIN%20${code}`,
        expiresAt,
      };
  }
  throw new AppError("CONFLICT", "Could not create a connect code");
}

function reply(
  kind: "connected" | "stopped" | "badCode",
  locale: Locale,
): string {
  const t = createTranslator({
    locale,
    messages: allMessages[locale],
    namespace: "whatsapp.reply",
  });
  return t(kind);
}

async function sendReply(to: string, text: string): Promise<void> {
  try {
    await whatsAppProvider()?.sendText(to, text);
  } catch (err) {
    // The link is already saved; a failed confirmation must not undo it.
    console.error("[whatsapp] could not send a reply", err);
  }
}

function parseCommand(
  raw: string,
): { kind: "join"; code: string } | { kind: "stop" } | null {
  // People type "Stop." or "STOP !" or add an emoji: drop trailing punctuation, spaces and pictographs first.
  const text = raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[\s.!?,;:\p{Extended_Pictographic}\u200d]+$/gu, "")
    .trim();
  const join = /^join\s+([a-z0-9]+)$/i.exec(text);
  if (join) return { kind: "join", code: join[1].toUpperCase() };
  if (/^(stop|arret)$/i.test(text)) return { kind: "stop" };
  return null;
}

/** Handles one WhatsApp message sent to our number. `from` is E.164. Unknown or disallowed senders get no reply. */
export async function handleInboundMessage(
  db: Db,
  msg: { from: string; text: string; at: Date },
): Promise<void> {
  if (!isAllowedWhatsAppNumber(msg.from)) return;
  const command = parseCommand(msg.text);
  if (!command) return;

  if (command.kind === "stop") {
    const removed = await db
      .delete(whatsappLink)
      .where(eq(whatsappLink.phone, msg.from))
      .returning();
    if (removed.length === 0) return;
    const locale =
      (await localesOf(db, [removed[0].userId])).get(removed[0].userId) ?? "en";
    await sendReply(msg.from, reply("stopped", locale));
    return;
  }

  const linkedUserId = await db.transaction(async (tx) => {
    const [used] = await tx
      .update(whatsappConnectCode)
      .set({ usedAt: msg.at })
      .where(
        and(
          eq(whatsappConnectCode.code, command.code),
          isNull(whatsappConnectCode.usedAt),
          gt(whatsappConnectCode.expiresAt, msg.at),
        ),
      )
      .returning({ userId: whatsappConnectCode.userId });
    if (!used) return null;
    // One number per user and one user per number: whoever held this number loses it.
    await tx
      .delete(whatsappLink)
      .where(
        and(
          eq(whatsappLink.phone, msg.from),
          ne(whatsappLink.userId, used.userId),
        ),
      );
    await tx
      .insert(whatsappLink)
      .values({ userId: used.userId, phone: msg.from, linkedAt: msg.at })
      .onConflictDoUpdate({
        target: whatsappLink.userId,
        set: { phone: msg.from, linkedAt: msg.at },
      });
    await tx
      .insert(whatsappPreference)
      .values({ userId: used.userId })
      .onConflictDoNothing();
    return used.userId;
  });

  if (!linkedUserId) {
    // SNS can deliver a message twice. If this code was already used by the account that holds
    // this very number, the first delivery did the work and replied: stay quiet.
    const [alreadyLinked] = await db
      .select({ userId: whatsappLink.userId })
      .from(whatsappConnectCode)
      .innerJoin(whatsappLink, eq(whatsappLink.userId, whatsappConnectCode.userId))
      .where(
        and(
          eq(whatsappConnectCode.code, command.code),
          isNotNull(whatsappConnectCode.usedAt),
          eq(whatsappLink.phone, msg.from),
        ),
      );
    if (alreadyLinked) return;
    await sendReply(msg.from, reply("badCode", "en"));
    return;
  }
  const locale =
    (await localesOf(db, [linkedUserId])).get(linkedUserId) ?? "en";
  await sendReply(msg.from, reply("connected", locale));
}

export async function disconnectWhatsApp(ctx: Ctx): Promise<void> {
  await ctx.db.delete(whatsappLink).where(eq(whatsappLink.userId, ctx.user.id));
}

/** `+237612345412` becomes `+237 6•• ••• 412`: country code, first local digit, last three digits. */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (digits.length < 8) return "•••";
  const tail = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const country = rest.slice(0, rest.length - 6);
  const firstLocal = rest.slice(country.length, country.length + 1);
  return `+${country} ${firstLocal}•• ••• ${tail}`;
}

export async function getWhatsAppSettings(ctx: Ctx): Promise<{
  available: boolean;
  maskedPhone: string | null;
  prefs: WhatsAppPrefs;
  roles: { student: boolean; lecturer: boolean };
}> {
  const [link] = await ctx.db
    .select()
    .from(whatsappLink)
    .where(eq(whatsappLink.userId, ctx.user.id));
  const [prefs] = await ctx.db
    .select()
    .from(whatsappPreference)
    .where(eq(whatsappPreference.userId, ctx.user.id));
  const [membership] = await ctx.db
    .select({ classId: classStudent.classId })
    .from(classStudent)
    .where(
      and(
        eq(classStudent.userId, ctx.user.id),
        eq(classStudent.status, "active"),
      ),
    )
    .limit(1);
  const [owned] = await ctx.db
    .select({ id: course.id })
    .from(course)
    .where(eq(course.lecturerId, ctx.user.id))
    .limit(1);
  return {
    available: whatsAppConfig() !== null,
    maskedPhone: link ? maskPhone(link.phone) : null,
    prefs: prefs
      ? (Object.fromEntries(
          PREF_KEYS.map((k) => [k, prefs[k]]),
        ) as WhatsAppPrefs)
      : { ...DEFAULT_PREFS },
    roles: { student: !!membership, lecturer: !!owned },
  };
}

export async function setWhatsAppPreference(
  ctx: Ctx,
  key: keyof WhatsAppPrefs,
  on: boolean,
): Promise<void> {
  if (!PREF_KEYS.includes(key))
    throw new AppError("VALIDATION", "Unknown WhatsApp preference");
  await ctx.db
    .insert(whatsappPreference)
    .values({ userId: ctx.user.id, [key]: on })
    .onConflictDoUpdate({
      target: whatsappPreference.userId,
      set: { [key]: on },
    });
}
