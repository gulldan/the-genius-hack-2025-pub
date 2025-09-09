process.env.QR_SECRET = "demo-secret";

import { test, expect, beforeAll } from "bun:test";
import { Elysia } from "elysia";
import { eventsRoutes } from "../src/routes/events.ts";
import { checkinRoutes } from "../src/routes/checkin.ts";
import { telegramRoutes } from "../src/routes/telegram.ts";
import { organizerRoutes } from "../src/routes/organizer.ts";
import { createApplication, db } from "../src/sql/queries.ts";
import { generateCheckinQRData } from "../src/lib/telegram.ts";

beforeAll(async () => {
  await import("../scripts/seed.ts");
});

test("event creation route", async () => {
  const app = new Elysia().use(organizerRoutes);
  const body = {
    title: "Integration Event",
    short_description: "short",
    long_description: "long",
    start_date: "2025-01-01",
    csrf_token: "token",
  };
  const res = await app.handle(
    new Request("http://localhost/org/1/events/new", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: "user_id=1; csrf_token=token",
        "x-forwarded-for": "10.0.0.1",
      },
      body: JSON.stringify(body),
    }),
  );
  expect(res.status).toBe(302);
});

test("application submission route", async () => {
  const app = new Elysia().use(eventsRoutes);
  const res = await app.handle(
    new Request("http://localhost/applications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: "user_id=1; csrf_token=token",
        "x-forwarded-for": "10.0.0.2",
      },
      body: JSON.stringify({ event_id: 1, role_id: 1, shift_id: 1, csrf_token: "token" }),
    }),
  );
  expect(res.status).toBe(302);
});

test("checkin process route", async () => {
  const eventId = db.query("SELECT id FROM events LIMIT 1").get().id as number;
  const roleId = db
    .query("SELECT id FROM roles WHERE event_id=? LIMIT 1")
    .get(eventId).id as number;
  const shiftId = db
    .query("SELECT id FROM shifts WHERE role_id=? LIMIT 1")
    .get(roleId).id as number;
  createApplication.run(1, eventId, roleId, shiftId, "approved", "{}", null);
  const appId = db.query("SELECT last_insert_rowid() as id").get().id as number;
  const qr = generateCheckinQRData(String(appId), String(shiftId));
  const app = new Elysia().use(checkinRoutes);
  const res = await app.handle(
    new Request("http://localhost/checkin/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qr_data: qr }),
    }),
  );
  const json = await res.json();
  expect(json.success).toBeDefined();
});

test("telegram webhook handler", async () => {
  const app = new Elysia().use(telegramRoutes);
  const res = await app.handle(
    new Request("http://localhost/webhook/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: { chat: { id: 1 }, text: "hi", from: { id: 1 } } }),
    }),
  );
  const json = await res.json();
  expect(json.ok).toBe(true);
});
