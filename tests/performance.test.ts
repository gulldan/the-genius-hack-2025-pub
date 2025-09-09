import { test, expect } from "bun:test";
import { createApplication, createAttendance, db } from "../src/sql/queries.ts";

test("pagination performance", () => {
  const ids: number[] = [];
  for (let i = 0; i < 1000; i++) {
    createApplication.run(1, 1, 1, 1, "approved", "{}", null);
    const id = db.query("SELECT last_insert_rowid() as id").get().id as number;
    ids.push(id);
  }
  ids.forEach((id) => {
    createAttendance.run(id, 1, "checked_in", "manual", null);
  });
  const startApps = Date.now();
  const apps = db.query("SELECT * FROM applications LIMIT 50 OFFSET 0").all();
  const appsDuration = Date.now() - startApps;
  const startAtt = Date.now();
  const att = db.query("SELECT * FROM attendance LIMIT 50 OFFSET 0").all();
  const attDuration = Date.now() - startAtt;
  expect(apps.length).toBe(50);
  expect(att.length).toBe(50);
  expect(appsDuration).toBeLessThan(1000);
  expect(attDuration).toBeLessThan(1000);
});
