import type { Elysia } from "elysia";
import {
        canAccessOrganization,
        getCurrentUser,
        requireRoles,
        withAuth,
} from "../lib/auth.ts";
import { render } from "../lib/template";
import { generateCsrfToken, verifyCsrf } from "../lib/csrf.ts";
import { rateLimit } from "../lib/rateLimit.ts";
import { validateDate, validateNumber, validateJSON } from "../lib/validators.ts";
import {
        db,
        eventById,
        eventsByOrg,
        insertEvent,
        updateEvent,
        insertRole,
        insertShift,
        roleById,
        rolesByEvent,
        shiftsByRole,
        updateEventTelegramLink,
        updateShiftTelegramLink,
        updateShiftCheckinLink,
} from "../sql/queries.ts";
import { updateApplicationStatus } from "../lib/applications.ts";
import { generateTelegramDeepLink } from "../lib/telegram.ts";
import { sendNotification } from "../lib/notifications.ts";

const closeEvent = (eventId: number) => {
	db.query("UPDATE events SET status = 'closed' WHERE id = ?").run(eventId);
	const event = eventById.get(eventId);
	const approved = db
		.query(
			"SELECT user_id FROM applications WHERE event_id = ? AND status = 'approved'",
		)
		.all(eventId);
	approved.forEach((row) => {
		sendNotification({
			user_id: row.user_id,
			event_id: eventId,
			type: "event_closed",
			data: { event_title: event?.title },
		});
	});
};

export const organizerRoutes = (app: Elysia) => {
	const organizerOnly = (handler: (ctx: unknown) => unknown) =>
		requireRoles(["organizer", "coordinator"], handler);

	return (
		app
			// General dashboard redirect
			.get(
				"/org/dashboard",
				organizerOnly(({ headers }) => {
					const user = getCurrentUser(headers);
					if (!user) {
						return new Response(null, {
							status: 302,
							headers: { Location: "/login" },
						});
					}

					// Умная логика выбора организации для демо
					let targetOrgId = 1; // По умолчанию первая организация

					// Елена Организаторша идет в свою организацию (Фонд "Добрые сердца")
					if (user.email === "elena.organizer@example.com") {
						targetOrgId = 4;
					}

					const targetOrg = db
						.query("SELECT id FROM organizations WHERE id = ?")
						.get(targetOrgId);
					
					if (targetOrg) {
						return new Response(null, {
							status: 302,
							headers: { Location: `/org/${targetOrg.id}` },
						});
					}

					// Fallback - первая доступная организация
					const firstOrg = db
						.query("SELECT id FROM organizations LIMIT 1")
						.get();
					if (firstOrg) {
						return new Response(null, {
							status: 302,
							headers: { Location: `/org/${firstOrg.id}` },
						});
					}

					return new Response("Организации не найдены", { status: 404 });
				}),
			)

			// Main dashboard
			.get(
				"/org/:orgId",
				organizerOnly(({ params, headers }) => {
					const user = getCurrentUser(headers);
					const orgId = params.orgId;

					// Get organization info
					const org = db
						.query("SELECT * FROM organizations WHERE id = ?")
						.get(orgId);
					if (!org) {
						return new Response("Организация не найдена", { status: 404 });
					}

					// Check access (в демо-режиме разрешаем всем)
					if (!canAccessOrganization(user, Number(orgId))) {
						return new Response("Нет доступа к организации", { status: 403 });
					}

					// Get events statistics
					const events = eventsByOrg.all(orgId);
					const stats = {
						total_events: events.length,
						published_events: events.filter((e) => e.status === "published")
							.length,
						draft_events: events.filter((e) => e.status === "draft").length,
						upcoming_events: events.filter((e) => {
							const eventDate = new Date(e.start_date);
							return eventDate > new Date() && e.status === "published";
						}).length,
					};

					// Get recent applications
					const recentApplications = db
						.query(`
        SELECT a.*, u.name as volunteer_name, e.title as event_title, r.title as role_title
        FROM applications a
        JOIN users u ON a.user_id = u.id
        JOIN events e ON a.event_id = e.id
        JOIN roles r ON a.role_id = r.id
        WHERE e.org_id = ? AND a.status = 'new'
        ORDER BY a.applied_at DESC
        LIMIT 10
      `)
						.all(orgId);

					// Get all organizations for demo switcher
					const allOrganizations = db
						.query("SELECT id, name FROM organizations ORDER BY name")
						.all();

					return render(
						"org/dashboard",
						withAuth({ org, events, stats, recentApplications, allOrganizations }, headers),
					);
				}),
			)

			.get(
				"/org/:orgId/events",
				organizerOnly(({ params, headers, query }) => {
					const orgId = params.orgId;

					// Check organization exists
					const org = db
						.query("SELECT * FROM organizations WHERE id = ?")
						.get(orgId);
					if (!org) {
						return new Response("Организация не найдена", { status: 404 });
					}

					const { status, date, city } = query as Record<string, string>;
					let where = "org_id = ?";
					const queryParams: unknown[] = [orgId];
					if (status) {
						where += " AND status = ?";
						queryParams.push(status);
					}
					if (date) {
						where += " AND start_date >= ?";
						queryParams.push(date);
					}
					if (city) {
						where += " AND city = ?";
						queryParams.push(city);
					}

					const events = db
						.query(
							`SELECT * FROM events WHERE ${where} ORDER BY start_date DESC`,
						)
						.all(...queryParams);

					return render(
						"org/events-list",
						withAuth(
							{
								events,
								orgId,
								org,
								currentStatus: status,
								currentDate: date,
								currentCity: city,
							},
							headers,
						),
					);
				}),
			)
			.post(
				"/org/:orgId/events/bulk",
				organizerOnly(({ params, body }) => {
					const { action, ids } = body as Record<string, any>;
					const idList = Array.isArray(ids) ? ids : [ids].filter(Boolean);
					if (idList.length === 0) {
						return new Response(null, {
							status: 302,
							headers: { Location: `/org/${params.orgId}/events` },
						});
					}
					const placeholders = idList.map(() => "?").join(",");
					switch (action) {
						case "publish":
							db.query(
								`UPDATE events SET status='published', published_at=datetime('now') WHERE id IN (${placeholders})`,
							).run(...idList);
							break;
						case "close":
							idList.forEach((id: string) => closeEvent(Number(id)));
							break;
						case "delete":
							db.query(`DELETE FROM events WHERE id IN (${placeholders})`).run(
								...idList,
							);
							break;
					}
					return new Response(null, {
						status: 302,
						headers: { Location: `/org/${params.orgId}/events` },
					});
				}),
			)
                        .get(
                                "/org/:orgId/events/new",
                                organizerOnly(({ params, headers }) => {
                                        const { token, cookie } = generateCsrfToken();
                                        return render(
                                                "org/event-new",
                                                withAuth({ orgId: params.orgId, csrf: token }, headers),
                                                { "Set-Cookie": cookie },
                                        );
                                }),
                        )
                        .post(
                                "/org/:orgId/events/new",
                                organizerOnly(({ params, body, headers }) => {
                                        const {
                                                title,
                                                short_description,
                                                long_description,
                                                location_type,
                                                address,
                                                city,
                                                latitude,
                                                longitude,
                                                timezone,
                                                schedule_type,
                                                start_date,
                                                end_date,
                                                category,
                                                tags,
                                                custom_questions,
                                                csrf_token,
                                        } = body as Record<string, unknown>;

                                        if (!verifyCsrf(headers, csrf_token as string)) {
                                                return new Response("Invalid CSRF token", { status: 403 });
                                        }
                                        if (!rateLimit(headers)) {
                                                return new Response("Too many requests", { status: 429 });
                                        }
                                        if (!validateDate(start_date as string)) {
                                                return new Response("Invalid date", { status: 400 });
                                        }
                                        if (
                                                custom_questions &&
                                                typeof custom_questions === "string" &&
                                                !validateJSON(custom_questions)
                                        ) {
                                                return new Response("Invalid JSON", { status: 400 });
                                        }

					// Создаём slug из названия
					const slug = title
						.toLowerCase()
						.replace(/[а-я]/g, (char: string) => {
							const ru = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя";
							const en = "abvgdeejzijklmnoprstufhccss_y_eua";
							return en[ru.indexOf(char)] || char;
						})
						.replace(/[^a-z0-9]/g, "-")
						.replace(/-+/g, "-")
						.replace(/^-|-$/g, "");

                                        const id = insertEvent.run(
                                                params.orgId,
                                                slug,
                                                title,
                                                short_description || "",
                                                long_description || "",
                                                location_type || "onsite",
                                                address || "",
                                                city || null,
                                                latitude && validateNumber(Number(latitude))
                                                        ? Number(latitude)
                                                        : null,
                                                longitude && validateNumber(Number(longitude))
                                                        ? Number(longitude)
                                                        : null,
                                                timezone || "UTC",
                                                schedule_type || "oneoff",
                                                start_date,
                                                end_date || start_date,
                                                category || "",
                                                tags
                                                        ? JSON.stringify(tags.split(",").map((t: string) => t.trim()))
                                                        : "[]",
                                                "public",
                                                "draft",
                                        ).lastInsertRowid as number;

                                        const eventLink = generateTelegramDeepLink(
                                                "start",
                                                `EVT_${id}`,
                                        );
                                        updateEventTelegramLink.run(id, eventLink);

					return new Response(null, {
						status: 302,
						headers: { Location: `/org/${params.orgId}/events/${id}/roles` },
					});
				}),
			)
			.get(
				"/org/:orgId/events/:eventId/edit",
				organizerOnly(({ params }) => {
					const event = eventById.get(params.eventId);
					return render("org/event-new", {
						orgId: params.orgId,
						event,
						formAction: ``,
					});
				}),
			)
			.post(
				"/org/:orgId/events/:eventId/edit",
				organizerOnly(({ params, body }) => {
					const {
						title,
						short_description,
						long_description,
						location_type,
						address,
						city,
						latitude,
						longitude,
						timezone,
						schedule_type,
						start_date,
						end_date,
						category,
						tags,
					} = body as Record<string, unknown>;

					updateEvent.run(
						params.eventId,
						title,
						short_description || "",
						long_description || "",
						location_type || "onsite",
						address || "",
						city || null,
						latitude ? Number(latitude) : null,
						longitude ? Number(longitude) : null,
						timezone || "UTC",
						schedule_type || "oneoff",
						start_date,
						end_date || start_date,
						category || "",
						tags
							? JSON.stringify(tags.split(",").map((t: string) => t.trim()))
							: "[]",
					);
					return new Response(null, {
						status: 302,
						headers: { Location: `/org/${params.orgId}/events` },
					});
				}),
			)
			.get(
				"/org/:orgId/events/:eventId/copy",
				organizerOnly(({ params }) => {
					const event = eventById.get(params.eventId);
					const copy = { ...event, title: `${event.title} (копия)` };
					return render("org/event-new", {
						orgId: params.orgId,
						event: copy,
						formAction: `/org/${params.orgId}/events/new`,
					});
				}),
			)
			.get(
				"/org/:orgId/events/:eventId/view",
				organizerOnly(({ params, headers }) => {
					const event = eventById.get(params.eventId);
					const analytics = db
						.query(
							`SELECT COUNT(*) as total, SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as approved, SUM(CASE WHEN status='waitlisted' THEN 1 ELSE 0 END) as waitlisted FROM applications WHERE event_id = ?`,
						)
						.get(params.eventId);
					const attendance = db
						.query(
							`SELECT SUM(CASE WHEN a.status IN ('checked_in','checked_out') THEN 1 ELSE 0 END) as attended, SUM(a.hours_worked) as hours FROM attendance a JOIN applications ap ON a.application_id = ap.id WHERE ap.event_id = ?`,
						)
						.get(params.eventId);
					return render(
						"org/event-analytics",
						withAuth(
							{
								event,
								orgId: params.orgId,
								analytics,
								attendance,
							},
							headers,
						),
					);
				}),
			)
			.post(
				"/org/:orgId/events/:eventId/close",
				organizerOnly(({ params }) => {
					closeEvent(Number(params.eventId));
					return new Response(null, {
						status: 302,
						headers: { Location: `/org/${params.orgId}/events` },
					});
				}),
			)
			.get(
				"/org/:orgId/events/:eventId/roles",
				organizerOnly(({ params }) => {
					const event = eventById.get(params.eventId);
					if (!event) {
						return new Response("Event not found", { status: 404 });
					}
					const roles = rolesByEvent.all(params.eventId);
					return render("org/event-roles", { event, roles });
				}),
			)
			.post(
				"/org/:orgId/events/:eventId/roles",
				organizerOnly(({ params, body }) => {
					const {
						title,
						description,
						required_skills,
						min_age,
						required_documents,
					} = body as Record<string, unknown>;

					insertRole.run(
						params.eventId,
						title,
						description || "",
						required_skills
							? JSON.stringify(
									required_skills.split(",").map((s: string) => s.trim()),
								)
							: null,
						min_age ? Number(min_age) : null,
						required_documents
							? JSON.stringify(
									required_documents.split(",").map((d: string) => d.trim()),
								)
							: null,
					);

					return new Response(null, {
						status: 302,
						headers: {
							Location: `/org/${params.orgId}/events/${params.eventId}/roles`,
						},
					});
				}),
			)
			.get(
				"/org/:orgId/events/:eventId/roles/:roleId/shifts",
				organizerOnly(({ params }) => {
					const event = eventById.get(params.eventId);
					if (!event) {
						return new Response("Event not found", { status: 404 });
					}
					const role = roleById.get(params.roleId);
					if (!role) {
						return new Response("Role not found", { status: 404 });
					}
					const shifts = shiftsByRole.all(params.roleId);
					return render("org/role-shifts", { event, role, shifts });
				}),
			)
			.post(
				"/org/:orgId/events/:eventId/roles/:roleId/shifts",
				organizerOnly(({ params, body }) => {
					const { start_time, end_time, slots } = body as Record<
						string,
						unknown
					>;

					// Генерируем уникальный QR ID для смены
					const qrId = `QR_${params.roleId}_${Date.now()}`;

                                        const shiftId = insertShift.run(
                                                params.roleId,
                                                start_time,
                                                end_time,
                                                Number(slots),
                                                qrId,
                                        ).lastInsertRowid as number;

                                        const shiftLink = generateTelegramDeepLink(
                                                "start",
                                                `SHF_${shiftId}`,
                                        );
                                        updateShiftTelegramLink.run(shiftId, shiftLink);
                                        const checkinLink = generateTelegramDeepLink(
                                                "start",
                                                `CHECKIN_${qrId}`,
                                        );
                                        updateShiftCheckinLink.run(shiftId, checkinLink);

					return new Response(null, {
						status: 302,
						headers: {
							Location: `/org/${params.orgId}/events/${params.eventId}/roles/${params.roleId}/shifts`,
						},
					});
				}),
			)
			.get(
				"/org/:orgId/events/:eventId/publish",
				organizerOnly(({ params }) => {
					const event = eventById.get(params.eventId);
					if (!event) {
						return new Response("Event not found", { status: 404 });
					}
					const roles = rolesByEvent.all(params.eventId).map((r) => ({
						...r,
						shifts: shiftsByRole.all(r.id),
					}));
					return render("org/event-publish", { event, roles });
				}),
			)
			.post(
				"/org/:orgId/events/:eventId/publish",
				organizerOnly(({ params }) => {
					// Update event status to published
					db.query(
						"UPDATE events SET status = 'published', published_at = datetime('now') WHERE id = ?",
					).run(params.eventId);

					return new Response(null, {
						status: 302,
						headers: { Location: `/events/${params.eventId}` },
					});
				}),
			)

			// Applications management
			.get(
				"/org/:orgId/applications",
				organizerOnly(({ params, query }) => {
					const { status, event_id } = query as Record<string, unknown>;

					let whereClause = "WHERE e.org_id = ?";
					const queryParams = [params.orgId];

					if (status) {
						whereClause += " AND a.status = ?";
						queryParams.push(status);
					}

					if (event_id) {
						whereClause += " AND a.event_id = ?";
						queryParams.push(event_id);
					}

					const applications = db
						.query(`
        SELECT a.*, u.name as volunteer_name, u.email, u.phone, u.telegram_username,
               e.title as event_title, r.title as role_title,
               s.start_time, s.end_time
        FROM applications a
        JOIN users u ON a.user_id = u.id
        JOIN events e ON a.event_id = e.id
        JOIN roles r ON a.role_id = r.id
        JOIN shifts s ON a.shift_id = s.id
        ${whereClause}
        ORDER BY a.applied_at DESC
      `)
						.all(...queryParams);

					const events = eventsByOrg.all(params.orgId);

					return render("org/applications", {
						applications,
						events,
						orgId: params.orgId,
						currentStatus: status,
						currentEventId: event_id,
					});
				}),
			)

			.post(
				"/org/:orgId/applications/:applicationId/status",
				organizerOnly(async ({ params, body }) => {
					const { status } = body as { status: string };
					await updateApplicationStatus(Number(params.applicationId), status);
					return { success: true };
				}),
			)

			.post(
				"/org/:orgId/applications/bulk-status",
				organizerOnly(async ({ body }) => {
					const { ids, status } = body as {
						ids: number[];
						status: string;
					};
					for (const id of ids) {
						await updateApplicationStatus(Number(id), status);
					}
					return { success: true };
				}),
			)

			.get(
				"/org/:orgId/applications/:status",
				organizerOnly(({ params }) => {
					const status = params.status;
					const applications = db
						.query(`
        SELECT a.*, u.name as volunteer_name, u.email, u.phone, u.telegram_username,
               e.title as event_title, r.title as role_title,
               s.start_time, s.end_time
        FROM applications a
        JOIN users u ON a.user_id = u.id
        JOIN events e ON a.event_id = e.id
        JOIN roles r ON a.role_id = r.id
        JOIN shifts s ON a.shift_id = s.id
        WHERE e.org_id = ? AND a.status = ?
        ORDER BY a.applied_at DESC
      `)
						.all(params.orgId, status);
					const events = eventsByOrg.all(params.orgId);
					return render("org/applications", {
						applications,
						events,
						orgId: params.orgId,
						currentStatus: status,
						currentEventId: undefined,
					});
				}),
			)
	);
};
