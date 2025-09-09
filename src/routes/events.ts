import type { Elysia } from "elysia";
import { AnalyticsEvents, logEvent } from "../lib/analytics.ts";
import { getCurrentUser, withAuth } from "../lib/auth.ts";
import {
	scheduleShiftReminders,
	sendNotification,
} from "../lib/notifications.ts";
import { render } from "../lib/template";
import { generateCsrfToken, verifyCsrf } from "../lib/csrf.ts";
import { rateLimit } from "../lib/rateLimit.ts";
import { validateNumber, validateEmail, validateAge, validatePhone, validateString, sanitizeHtml } from "../lib/validators.ts";
import {
        createApplication,
        db,
        eventById,
        eventsByIds,
        roleById,
        rolesByEvent,
        searchEvents,
        shiftsByRole,
        upcomingEvents,
} from "../sql/queries.ts";
import { TelegramMiniApp } from "../lib/telegram.ts";

export const eventsRoutes = (app: Elysia) =>
	app
		.get("/", ({ headers }) => {
			const events = upcomingEvents.all();

			// Получаем реальную статистику для главной страницы
			const stats = {
				volunteers: db.query("SELECT COUNT(*) as count FROM users").get().count,
				events: db
					.query(
						"SELECT COUNT(*) as count FROM events WHERE status = 'published'",
					)
					.get().count,
				organizations: db
					.query("SELECT COUNT(*) as count FROM organizations")
					.get().count,
				hours:
					db
						.query(
							"SELECT SUM(hours_worked) as total FROM attendance WHERE hours_worked > 0",
						)
						.get().total || 0,
			};

			// Генерируем CSRF токен для форм входа
			const { token: csrf, cookie } = generateCsrfToken();

			return render("index", withAuth({ events, stats, csrf }, headers), { "Set-Cookie": cookie });
		})
                .get("/events", ({ headers }) => {
                        const events = upcomingEvents.all();
                        const tgLink = TelegramMiniApp.generateLink("catalog");
                        return render("events", withAuth({ events, tgLink }, headers));
                })
                .get("/events/search", ({ query }) => {
			const {
				q,
				date_range,
				location,
				category,
				format,
				min_age,
				skills,
				interests,
				duration,
				sort,
				radius,
				lat,
				lon,
			} = query as Record<string, string>;

			const eventsRaw = searchEvents.all(
				q ? `%${q}%` : "%",
				getDateFilter(date_range),
				null,
				category || null,
				location ? `%${location}%` : null,
				format || null,
				min_age ? Number(min_age) : null,
				skills ? `%${skills}%` : null,
				interests ? `%${interests}%` : null,
				duration ? Number(duration) : null,
			) as unknown[];

			let events = eventsRaw;

			if (lat && lon && radius) {
				const R = 6371; // km
				const latNum = Number(lat);
				const lonNum = Number(lon);
				const radiusNum = Number(radius);
				events = events.filter((e) => {
					if (e.latitude == null || e.longitude == null) return false;
					const dLat = ((e.latitude - latNum) * Math.PI) / 180;
					const dLon = ((e.longitude - lonNum) * Math.PI) / 180;
					const a =
						Math.sin(dLat / 2) * Math.sin(dLat / 2) +
						Math.cos((latNum * Math.PI) / 180) *
							Math.cos((e.latitude * Math.PI) / 180) *
							Math.sin(dLon / 2) *
							Math.sin(dLon / 2);
					const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
					const distance = R * c;
					return distance <= radiusNum;
				});
			}

			switch (sort) {
				case "new":
					events.sort(
						(a, b) =>
							new Date(b.created_at).getTime() -
							new Date(a.created_at).getTime(),
					);
					break;
				case "popular":
					events.sort(
						(a, b) => (b.application_count || 0) - (a.application_count || 0),
					);
					break;
				default:
					events.sort(
						(a, b) =>
							new Date(a.start_date).getTime() -
							new Date(b.start_date).getTime(),
					);
			}

			return render("partials/events-grid", { events });
		})
		.get("/favorites", ({ headers }) =>
			render("favorites", withAuth({}, headers)),
		)
		.get("/events/favorites", ({ query }) => {
			const idsParam = (query.ids as string) || "";
			const ids = idsParam
				.split(",")
				.map((id) => Number(id))
				.filter(Boolean);
			const events = eventsByIds(ids);
			return render("partials/events-grid", { events });
		})
                .get("/events/:id", ({ params, headers }) => {
                        const event = eventById.get(params.id);
                        if (!event) {
                                return new Response("Событие не найдено", { status: 404 });
                        }

			if (event.custom_questions) {
				try {
					event.custom_questions = JSON.parse(event.custom_questions);
				} catch {
					event.custom_questions = [];
				}
			}

                        const roles = rolesByEvent.all(params.id);
			// Получаем смены для каждой роли с данными о заявках
			const rolesWithShifts = roles.map((role) => {
				const shifts = shiftsByRole.all(role.id).map((shift) => {
					// Получаем количество одобренных и ожидающих заявок для каждой смены
					const shiftStats = db.query(`
						SELECT 
							COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_count,
							COUNT(CASE WHEN status = 'waitlisted' THEN 1 END) as waitlisted_count
						FROM applications 
						WHERE shift_id = ?
					`).get(shift.id) as { approved_count: number; waitlisted_count: number };
					
					return {
						...shift,
						approved_count: shiftStats.approved_count,
						waitlisted_count: shiftStats.waitlisted_count,
					};
				});
				
				return {
					...role,
					shifts,
				};
			});

                        const tgLink = TelegramMiniApp.generateLink(
                                `event/${params.id}`,
                        );
                        const { token, cookie } = generateCsrfToken();
                        return render(
                                "event",
                                withAuth(
                                        { event, roles: rolesWithShifts, tgLink, csrf: token },
                                        headers,
                                ),
                                { "Set-Cookie": cookie },
                        );
                })
                .post("/applications", async ({ body, headers }) => {
                        const bodyData = body as Record<string, unknown>;
                        if (!verifyCsrf(headers, bodyData.csrf_token as string)) {
                                return new Response("Invalid CSRF token", { status: 403 });
                        }
                        if (!rateLimit(headers)) {
                                return new Response("Too many requests", { status: 429 });
                        }
                        const event_id = Number(bodyData.event_id);
                        const role_id = Number(bodyData.role_id);
                        const shift_id = Number(bodyData.shift_id);
                        const comment = bodyData.comment as string | undefined;
                        const age = bodyData.age as string | undefined;
                        const email = bodyData.email as string | undefined;
                        const name = bodyData.name as string | undefined;
                        const phone = bodyData.phone as string | undefined;
                        
                        // Валидация основных параметров
                        if (
                                !validateNumber(event_id) ||
                                !validateNumber(role_id) ||
                                !validateNumber(shift_id)
                        ) {
                                return new Response("Неверные параметры запроса", { status: 400 });
                        }
                        
                        // Валидация контактных данных
                        if (email && !validateEmail(email)) {
                                return new Response("Неверный формат email", { status: 400 });
                        }
                        if (phone && !validatePhone(phone)) {
                                return new Response("Неверный формат телефона", { status: 400 });
                        }
                        if (name && !validateString(name, 2, 100)) {
                                return new Response("Имя должно содержать от 2 до 100 символов", { status: 400 });
                        }
                        if (age && !validateAge(Number(age))) {
                                return new Response("Возраст должен быть от 14 до 100 лет", { status: 400 });
                        }
                        if (comment && !validateString(comment, 0, 1000)) {
                                return new Response("Комментарий слишком длинный (максимум 1000 символов)", { status: 400 });
                        }

			const user = getCurrentUser(headers);
			if (!user) {
				const returnUrl = encodeURIComponent(`/events/${event_id}`);
				return new Response(null, {
					status: 302,
					headers: { Location: `/login?return=${returnUrl}` },
				});
			}

			const event = eventById.get(event_id);
			if (!event || event.status !== "published") {
				return new Response("Приём заявок закрыт", { status: 400 });
			}

			const role = roleById.get(role_id);
			if (role?.min_age && (!age || Number(age) < role.min_age)) {
				return new Response("Недостаточный возраст", { status: 400 });
			}

			if (role?.required_skills) {
				let required: string[] = [];
				try {
					required = JSON.parse(role.required_skills);
				} catch {
					required = String(role.required_skills)
						.split(",")
						.map((s) => s.trim());
				}
				let userSkills: string[] = [];
				if (user.skills) {
					try {
						userSkills = JSON.parse(user.skills);
					} catch {
						userSkills = String(user.skills)
							.split(",")
							.map((s) => s.trim());
					}
				}
				const hasAllSkills = required.every((s) => userSkills.includes(s));
				if (!hasAllSkills) {
					return new Response("Недостаточно навыков", {
						status: 400,
					});
				}
			}

			// Очищаем данные от потенциального XSS
			const answers: Record<string, unknown> = { 
				comment: comment ? sanitizeHtml(comment) : undefined,
				name: name ? sanitizeHtml(name) : undefined,
				email: email ? sanitizeHtml(email) : undefined,
				phone: phone ? sanitizeHtml(phone) : undefined,
			};
			const uploadedFiles: string[] = [];
			const questions = event.custom_questions
				? JSON.parse(event.custom_questions)
				: [];
			questions.forEach((q: Record<string, unknown>, index: number) => {
				const fieldName = `question_${index}`;
				const value = bodyData[fieldName];
				if (
					q.type === "file" &&
					value &&
					typeof value === "object" &&
					"name" in (value as Record<string, unknown>)
				) {
					uploadedFiles.push((value as { name?: string }).name || fieldName);
				} else if (value !== undefined && typeof value === "string") {
					answers[fieldName] = sanitizeHtml(value);
				} else if (value !== undefined) {
					answers[fieldName] = value;
				}
			});
			if (age !== undefined) {
				answers.age = Number(age);
			}

			const shift = db
				.query<{ capacity: number; approved: number; auto_approve: boolean }>(
					`SELECT s.capacity as capacity, s.auto_approve,
        COALESCE(SUM(CASE WHEN a.status='approved' THEN 1 ELSE 0 END),0) as approved
        FROM shifts s LEFT JOIN applications a ON s.id = a.shift_id
        WHERE s.id = ?`,
				)
				.get(shift_id);
			
			// Определяем статус заявки
			let status = "pending";
			if (shift) {
				const forceWaitlist = (bodyData.force_waitlist as string) === "true";
				
				if (forceWaitlist || shift.approved >= shift.capacity) {
					status = "waitlisted";
				} else if (shift.auto_approve) {
					status = "approved";
				}
			}

			createApplication.run(
				user.id,
				event_id,
				role_id,
				shift_id,
				status,
				JSON.stringify(answers),
				uploadedFiles.length ? JSON.stringify(uploadedFiles) : null,
			);

			const appId = db.query("SELECT last_insert_rowid() as id").get()
				.id as number;

			logEvent({
				user_id: user.id,
				event_type: AnalyticsEvents.SIGNUP_SUBMITTED,
				event_data: { event_id, role_id, shift_id, status },
			});

			if (status !== "waitlisted") {
				await sendNotification({
					user_id: user.id,
					event_id,
					application_id: appId,
					shift_id,
					type: "application_confirmed",
				});
				await scheduleShiftReminders(appId);
			}

			const redirectParam = status === "waitlisted" ? "waitlisted" : "applied";
			return new Response(null, {
				status: 302,
				headers: {
					Location: `/events/${event_id}?${redirectParam}=1`,
				},
			});
		});

// Вспомогательные функции
function getDateFilter(dateRange: string): string | null {
	const today = new Date();

	switch (dateRange) {
		case "today":
			return today.toISOString().split("T")[0];
		case "tomorrow": {
			const tomorrow = new Date(today);
			tomorrow.setDate(tomorrow.getDate() + 1);
			return tomorrow.toISOString().split("T")[0];
		}
		case "this_week":
			return today.toISOString().split("T")[0];
		case "this_month":
			return today.toISOString().split("T")[0];
		default:
			return null;
	}
}
