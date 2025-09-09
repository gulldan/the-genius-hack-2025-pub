import type { Elysia } from "elysia";
import { insertIncident } from "../sql/queries.ts";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";

export const incidentRoutes = (app: Elysia) =>
        app.post("/api/incidents", async ({ request }) => {
                const form = await request.formData();
                const event_id = Number(form.get("event_id"));
                const shift_id = form.get("shift_id") ? Number(form.get("shift_id")) : null;
                const user_id = form.get("user_id") ? Number(form.get("user_id")) : null;
                const type = String(form.get("type"));
                const note = String(form.get("note") || "");
                const created_by = Number(form.get("created_by"));

                const photoFiles = form.getAll("photos");
                const uploadsDir = "public/uploads";
                if (!existsSync(uploadsDir)) {
                        await mkdir(uploadsDir, { recursive: true });
                }
                const photoUrls: string[] = [];
                for (const file of photoFiles) {
                        const f = file as File;
                        if (f && f.name) {
                                const buffer = Buffer.from(await f.arrayBuffer());
                                const fileName = `${Date.now()}-${f.name}`;
                                const filePath = `${uploadsDir}/${fileName}`;
                                await Bun.write(filePath, buffer);
                                photoUrls.push(`/uploads/${fileName}`);
                        }
                }

                insertIncident.run(
                        event_id,
                        shift_id,
                        user_id,
                        type,
                        note,
                        photoUrls.length ? JSON.stringify(photoUrls) : null,
                        created_by,
                );

                return { success: true };
        });
