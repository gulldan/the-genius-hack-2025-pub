---
marp: true
---

# Volunteer Platform

---

## Stack

- Bun runtime
- Elysia framework
- htmx + Tailwind CSS
- SQLite via bun:sqlite

---

## Domain Model

Users, Organizations, Events, Roles, Signups, Attendance

---

## Features

- Browse events and roles
- Sign up and cancel
- Coordinator check‑in
- Volunteer dashboard

---

## UI/UX

Dark theme, P3 accents, Motion One animations, View Transitions

---

## Security

CSRF tokens, signed QR check‑in

---

## Performance

Server rendered pages, minimal JS

---

## Demo

```bash
bun run scripts/seed.ts
bun run src/server.ts
```

---

## Спасибо!
