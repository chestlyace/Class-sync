import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  user,
  whatsappConnectCode,
  whatsappLink,
  whatsappPreference,
} from "@/server/db/schema";
import { createTestDb } from "@/test/db";
import { ctxFor, makeUser } from "@/test/factories";
import {
  createConnectCode,
  disconnectWhatsApp,
  getWhatsAppSettings,
  handleInboundMessage,
  maskPhone,
  setWhatsAppPreference,
} from "./link";
import { setWhatsAppProviderForTests } from "./provider";

const sent: { to: string; text: string }[] = [];

beforeEach(() => {
  sent.length = 0;
  vi.stubEnv("WHATSAPP_AWS_REGION", "eu-west-1");
  vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIAEXAMPLE");
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "secret-example");
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "phone-number-id-1");
  vi.stubEnv("WHATSAPP_DISPLAY_NUMBER", "+1 555 010 0000");
  vi.stubEnv("WHATSAPP_SNS_TOPIC_ARN", "arn:aws:sns:eu-west-1:1:t");
  vi.stubEnv("WHATSAPP_ALLOWLIST", "");
  setWhatsAppProviderForTests({
    sendTemplate: async () => ({ messageId: "x" }),
    sendText: async (to, text) => {
      sent.push({ to, text });
      return { messageId: "m" };
    },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  setWhatsAppProviderForTests(null);
});

const PHONE = "+237612345412";
const at = new Date("2026-11-17T10:00:00Z");

describe("WhatsApp linking", () => {
  it("join links the sender to the code owner and replies once", async () => {
    const db = await createTestDb();
    const u = await makeUser(db, { locale: "fr" });
    const { code } = await createConnectCode(ctxFor(db, u));
    await handleInboundMessage(db, {
      from: PHONE,
      text: `  join   ${code.toLowerCase()} `,
      at: new Date(),
    });
    const links = await db.select().from(whatsappLink);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ userId: u.id, phone: PHONE });
    expect(
      await db
        .select()
        .from(whatsappPreference)
        .where(eq(whatsappPreference.userId, u.id)),
    ).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(PHONE);
    expect(sent[0].text).toContain("Connecté à Clasync");
  });

  it("join with an expired code links nothing and replies with the bad-code text", async () => {
    const db = await createTestDb();
    const u = await makeUser(db);
    await db
      .insert(whatsappConnectCode)
      .values({
        code: "ABC234",
        userId: u.id,
        expiresAt: new Date(at.getTime() - 16 * 60_000),
      });
    await handleInboundMessage(db, { from: PHONE, text: "JOIN ABC234", at });
    expect(await db.select().from(whatsappLink)).toHaveLength(0);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("expired");
    expect(sent[0].text).toContain("expiré");
  });

  it("join with a used code links nothing", async () => {
    const db = await createTestDb();
    const u = await makeUser(db);
    await db.insert(whatsappConnectCode).values({
      code: "ABC234",
      userId: u.id,
      expiresAt: new Date(at.getTime() + 60_000),
      usedAt: new Date(at.getTime() - 1000),
    });
    await handleInboundMessage(db, { from: PHONE, text: "JOIN ABC234", at });
    expect(await db.select().from(whatsappLink)).toHaveLength(0);
    expect(sent).toHaveLength(1);
  });

  it("the same join delivered twice replies once and keeps the link", async () => {
    const db = await createTestDb();
    const u = await makeUser(db);
    const { code } = await createConnectCode(ctxFor(db, u));
    const msg = { from: PHONE, text: `JOIN ${code}`, at: new Date() };
    await handleInboundMessage(db, msg);
    await handleInboundMessage(db, msg);
    const links = await db.select().from(whatsappLink);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ userId: u.id, phone: PHONE });
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("Connected to Clasync");
  });

  it("join from a number linked to another account moves the link", async () => {
    const db = await createTestDb();
    const a = await makeUser(db);
    const b = await makeUser(db);
    await db.insert(whatsappLink).values({ userId: a.id, phone: PHONE });
    const { code } = await createConnectCode(ctxFor(db, b));
    await handleInboundMessage(db, {
      from: PHONE,
      text: `JOIN ${code}`,
      at: new Date(),
    });
    const links = await db.select().from(whatsappLink);
    expect(links).toHaveLength(1);
    expect(links[0].userId).toBe(b.id);
  });

  it("join replaces the number the user had linked before", async () => {
    const db = await createTestDb();
    const u = await makeUser(db);
    await db
      .insert(whatsappLink)
      .values({ userId: u.id, phone: "+237699999999" });
    const { code } = await createConnectCode(ctxFor(db, u));
    await handleInboundMessage(db, {
      from: PHONE,
      text: `JOIN ${code}`,
      at: new Date(),
    });
    const links = await db.select().from(whatsappLink);
    expect(links).toHaveLength(1);
    expect(links[0].phone).toBe(PHONE);
  });

  it("join from a number not on the allowlist links nothing and sends nothing", async () => {
    vi.stubEnv("WHATSAPP_ALLOWLIST", "+237600000000");
    const db = await createTestDb();
    const u = await makeUser(db);
    const { code } = await createConnectCode(ctxFor(db, u));
    await handleInboundMessage(db, {
      from: PHONE,
      text: `JOIN ${code}`,
      at: new Date(),
    });
    expect(await db.select().from(whatsappLink)).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("a failing reply does not undo the link", async () => {
    setWhatsAppProviderForTests({
      sendTemplate: async () => ({ messageId: "x" }),
      sendText: async () => {
        throw new Error("boom");
      },
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = await createTestDb();
    const u = await makeUser(db);
    const { code } = await createConnectCode(ctxFor(db, u));
    await handleInboundMessage(db, {
      from: PHONE,
      text: `JOIN ${code}`,
      at: new Date(),
    });
    expect(await db.select().from(whatsappLink)).toHaveLength(1);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("stop deletes the link and replies; stop from an unknown number sends nothing", async () => {
    const db = await createTestDb();
    const u = await makeUser(db);
    await db.insert(whatsappLink).values({ userId: u.id, phone: PHONE });
    await handleInboundMessage(db, { from: "+237677777777", text: "STOP", at });
    expect(sent).toHaveLength(0);
    expect(await db.select().from(whatsappLink)).toHaveLength(1);
    await handleInboundMessage(db, { from: PHONE, text: " Arrêt ", at });
    expect(await db.select().from(whatsappLink)).toHaveLength(0);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("WhatsApp alerts are off");
  });

  it("stop and join tolerate trailing punctuation and an emoji", async () => {
    const db = await createTestDb();
    const u = await makeUser(db);
    await db.insert(whatsappLink).values({ userId: u.id, phone: PHONE });
    await handleInboundMessage(db, { from: PHONE, text: "Stop.", at });
    expect(await db.select().from(whatsappLink)).toHaveLength(0);
    await db.insert(whatsappLink).values({ userId: u.id, phone: PHONE });
    await handleInboundMessage(db, { from: PHONE, text: "STOP !", at });
    expect(await db.select().from(whatsappLink)).toHaveLength(0);
    await db.insert(whatsappLink).values({ userId: u.id, phone: PHONE });
    await handleInboundMessage(db, { from: PHONE, text: "arrêt 🙏", at });
    expect(await db.select().from(whatsappLink)).toHaveLength(0);
    const { code } = await createConnectCode(ctxFor(db, u));
    await handleInboundMessage(db, { from: PHONE, text: `JOIN ${code}.`, at: new Date() });
    expect(await db.select().from(whatsappLink)).toHaveLength(1);
  });

  it("other messages do nothing", async () => {
    const db = await createTestDb();
    await handleInboundMessage(db, { from: PHONE, text: "hello", at });
    expect(sent).toHaveLength(0);
  });

  it("createConnectCode replaces the previous unused code and builds the wa.me url", async () => {
    const db = await createTestDb();
    const u = await makeUser(db);
    const first = await createConnectCode(ctxFor(db, u));
    const second = await createConnectCode(ctxFor(db, u));
    const rows = await db
      .select()
      .from(whatsappConnectCode)
      .where(eq(whatsappConnectCode.userId, u.id));
    expect(rows.map((r) => r.code)).toEqual([second.code]);
    expect(first.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(second.url).toBe(
      `https://wa.me/15550100000?text=JOIN%20${second.code}`,
    );
    expect(second.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("createConnectCode throws without WhatsApp config", async () => {
    vi.stubEnv("WHATSAPP_AWS_REGION", "");
    const db = await createTestDb();
    const u = await makeUser(db);
    await expect(createConnectCode(ctxFor(db, u))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("maskPhone", () => {
  it("hides the middle digits", () => {
    expect(maskPhone("+237612345412")).toBe("+237 6•• ••• 412");
  });
});

describe("WhatsApp linking and the account's sign-in number", () => {
  async function join(db: Awaited<ReturnType<typeof createTestDb>>, u: Awaited<ReturnType<typeof makeUser>>, from = PHONE) {
    const { code } = await createConnectCode(ctxFor(db, u));
    await handleInboundMessage(db, { from, text: `JOIN ${code}`, at: new Date() });
  }
  async function numberOf(db: Awaited<ReturnType<typeof createTestDb>>, id: string) {
    const [r] = await db.select().from(user).where(eq(user.id, id));
    return { phoneNumber: r.phoneNumber, phoneNumberVerified: r.phoneNumberVerified };
  }

  it("join by an account with no number makes it the verified sign-in number", async () => {
    const db = await createTestDb();
    const u = await makeUser(db);
    await join(db, u);
    expect(await numberOf(db, u.id)).toEqual({ phoneNumber: PHONE, phoneNumberVerified: true });
  });

  it("join never overwrites a number the account already has", async () => {
    const db = await createTestDb();
    const u = await makeUser(db);
    await db.update(user).set({ phoneNumber: "+237699000001", phoneNumberVerified: false }).where(eq(user.id, u.id));
    await join(db, u);
    expect(await numberOf(db, u.id)).toEqual({ phoneNumber: "+237699000001", phoneNumberVerified: false });
    expect(await db.select().from(whatsappLink)).toHaveLength(1);
  });

  it("join with a number another account holds leaves both numbers as they were", async () => {
    const db = await createTestDb();
    const a = await makeUser(db);
    const b = await makeUser(db);
    await db.update(user).set({ phoneNumber: PHONE, phoneNumberVerified: false }).where(eq(user.id, a.id));
    await join(db, b);
    expect(await numberOf(db, a.id)).toEqual({ phoneNumber: PHONE, phoneNumberVerified: false });
    expect(await numberOf(db, b.id)).toEqual({ phoneNumber: null, phoneNumberVerified: false });
    // The class alerts link still follows the message, as before.
    expect((await db.select().from(whatsappLink))[0]).toMatchObject({ userId: b.id, phone: PHONE });
  });

  it("STOP removes only the whatsapp_link, not the account's number", async () => {
    const db = await createTestDb();
    const u = await makeUser(db);
    await join(db, u);
    await handleInboundMessage(db, { from: PHONE, text: "STOP", at: new Date() });
    expect(await db.select().from(whatsappLink)).toHaveLength(0);
    expect(await numberOf(db, u.id)).toEqual({ phoneNumber: PHONE, phoneNumberVerified: true });
  });
});

describe("WhatsApp settings", () => {
  it("reports defaults, roles and the masked number, and saves preferences", async () => {
    const db = await createTestDb();
    const u = await makeUser(db);
    const ctx = ctxFor(db, u);
    let s = await getWhatsAppSettings(ctx);
    expect(s).toMatchObject({
      available: true,
      maskedPhone: null,
      roles: { student: false, lecturer: false },
    });
    expect(s.prefs).toEqual({
      checkin: true,
      tests: true,
      results: true,
      assignments: true,
      classSoon: true,
    });
    await db.insert(whatsappLink).values({ userId: u.id, phone: PHONE });
    await setWhatsAppPreference(ctx, "tests", false);
    s = await getWhatsAppSettings(ctx);
    expect(s.maskedPhone).toBe("+237 6•• ••• 412");
    expect(s.prefs.tests).toBe(false);
    expect(s.prefs.checkin).toBe(true);
    await disconnectWhatsApp(ctx);
    expect((await getWhatsAppSettings(ctx)).maskedPhone).toBeNull();
  });
});
