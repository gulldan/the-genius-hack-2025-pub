#!/usr/bin/env bun
/**
 * Production readiness health check
 */
import { Database } from "bun:sqlite";

const db = new Database("volunteer.db");

console.log("🏥 Production Health Check");
console.log("=========================\n");

let allPassed = true;

// Check database connectivity
try {
  const result = db.query("SELECT 1").get();
  console.log("✅ Database connectivity");
} catch (error) {
  console.log("❌ Database connectivity failed:", error);
  allPassed = false;
}

// Check essential tables exist
const requiredTables = ['users', 'organizations', 'events', 'roles', 'shifts', 'applications'];
for (const table of requiredTables) {
  try {
    db.query(`SELECT COUNT(*) FROM ${table}`).get();
    console.log(`✅ Table ${table} exists`);
  } catch (error) {
    console.log(`❌ Table ${table} missing`);
    allPassed = false;
  }
}

// Check data integrity
try {
  const userCount = db.query("SELECT COUNT(*) as count FROM users").get() as any;
  const orgCount = db.query("SELECT COUNT(*) as count FROM organizations").get() as any;
  const eventCount = db.query("SELECT COUNT(*) as count FROM events").get() as any;
  
  console.log(`✅ Data integrity: ${userCount.count} users, ${orgCount.count} orgs, ${eventCount.count} events`);
} catch (error) {
  console.log("❌ Data integrity check failed:", error);
  allPassed = false;
}

// Check essential columns exist
const criticalColumns = [
  { table: 'events', column: 'telegram_event_link' },
  { table: 'events', column: 'city' },
  { table: 'shifts', column: 'capacity' },
];

for (const { table, column } of criticalColumns) {
  try {
    db.query(`SELECT ${column} FROM ${table} LIMIT 1`).get();
    console.log(`✅ Column ${table}.${column} exists`);
  } catch (error) {
    console.log(`❌ Column ${table}.${column} missing`);
    allPassed = false;
  }
}

console.log("\n" + "=".repeat(25));
if (allPassed) {
  console.log("🎉 All health checks PASSED! Ready for production.");
  process.exit(0);
} else {
  console.log("⚠️  Some health checks FAILED! Not ready for production.");
  process.exit(1);
}
