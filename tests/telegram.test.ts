import { test, expect } from "bun:test";
process.env.QR_SECRET = "demo-secret";

import {
  generateCheckinQRData,
  verifyCheckinQRData,
  generateTelegramDeepLink,
  verifyTelegramAuth,
  TELEGRAM_BOT_USERNAME
} from "../src/lib/telegram.ts";
import { createHash, createHmac } from "node:crypto";

test("QR generation and verification", () => {
  const data = generateCheckinQRData("1", "2");
  const parsed = verifyCheckinQRData(data);
  expect(parsed).not.toBeNull();
  expect(parsed?.applicationId).toBe("1");
  expect(parsed?.shiftId).toBe("2");
});

test("Telegram deep link", () => {
  const link = generateTelegramDeepLink("start", "PAYLOAD");
  expect(link).toBe(`https://t.me/${TELEGRAM_BOT_USERNAME}?start=PAYLOAD`);
});

test("Telegram auth verification", () => {
  const botToken = "test-token";
  const authData: Record<string, any> = {
    id: 123,
    first_name: "Test",
    username: "tester"
  };
  const dataCheck = Object.keys(authData)
    .sort()
    .map((k) => `${k}=${authData[k]}`)
    .join("\n");
  const secretKey = createHash("sha256").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheck).digest("hex");
  const good = { ...authData, hash };
  expect(verifyTelegramAuth(good, botToken)).toBe(true);
  const bad = { ...authData, hash: "bad" };
  expect(verifyTelegramAuth(bad, botToken)).toBe(false);
});
