import type { Elysia } from "elysia";
import { getCurrentUser, withAuth } from "../lib/auth.ts";
import { render } from "../lib/template";
import {
	db,
	updateUserSkills,
	updateUserNotifications,
} from "../sql/queries.ts";
import { TELEGRAM_BOT_USERNAME, generateTelegramLoginWidget, verifyTelegramAuth } from "../lib/telegram.ts";
import { generateCsrfToken, verifyCsrf } from "../lib/csrf.ts";

export const accountRoutes = (app: Elysia) =>
	app
		.get("/account", ({ headers }) => {
			const user = getCurrentUser(headers);

			if (!user) {
				return new Response(null, {
					status: 302,
					headers: { Location: "/login" },
				});
			}

			// Получаем заявки пользователя
			const applications = db
				.query(`
        SELECT 
          a.*, 
          e.title as event_title, 
          e.start_date, 
          e.address,
          r.title as role_title, 
          s.start_time, 
          s.end_time,
          att.status as attendance_status,
          att.hours_worked
        FROM applications a 
        JOIN events e ON a.event_id = e.id
        JOIN roles r ON a.role_id = r.id 
        JOIN shifts s ON a.shift_id = s.id
        LEFT JOIN attendance att ON att.application_id = a.id
        WHERE a.user_id = ?1 
        ORDER BY e.start_date DESC
      `)
				.all(user.id);

			// Подсчитываем статистику и активность
			const activity = applications
				.filter((app) => app.attendance_status === "checked_out")
				.map((app) => ({
					date: (app.start_date as string).slice(0, 10),
					hours: app.hours_worked || 0,
				}));

			const activityDates = new Set(activity.map((a) => a.date));
			let streak = 0;
			for (
				let d = new Date();
				activityDates.has(d.toISOString().slice(0, 10));
				d.setDate(d.getDate() - 1)
			) {
				streak++;
			}

			const stats: {
				total_hours: number;
				completed_events: number;
				upcoming_events: number;
				pending_applications: number;
				streak: number;
				badges?: string[];
			} = {
				total_hours: activity.reduce((sum, a) => sum + a.hours, 0),
				completed_events: activity.length,
				upcoming_events: applications.filter((app) => {
					const eventDate = new Date(app.start_date);
					return eventDate > new Date() && app.status === "approved";
				}).length,
				pending_applications: applications.filter(
					(app) => app.status === "pending",
				).length,
				streak,
			};

			const badges: string[] = [];
			if (stats.total_hours >= 1) badges.push("Первый час");
			if (stats.total_hours >= 50) badges.push("50 часов");
			if (stats.completed_events >= 10) badges.push("10 событий");
			stats.badges = badges;

			// Ближайшие смены
			const upcomingShifts = applications.filter((app) => {
				const start = new Date(app.start_time);
				return start > new Date() && app.status === "approved";
			});

			// Навыки пользователя
			let userSkills: string[] = [];
			if (user.skills) {
				try {
					userSkills = JSON.parse(user.skills as string);
				} catch {
					userSkills = [];
				}
			}

			const allSkills = [
				"Коммуникация",
				"Организация",
				"Первая помощь",
				"Медиа",
			];

			const { token, cookie } = generateCsrfToken();
			return render(
				"account",
				withAuth(
					{
						applications,
						stats,
						activity,
						upcomingShifts,
						allSkills,
						userSkills,
						botUsername: TELEGRAM_BOT_USERNAME,
						csrf: token,
					},
					headers,
				),
				{ "Set-Cookie": cookie },
			);
		})
		.post("/account/skills", ({ headers, body }) => {
			const user = getCurrentUser(headers);
			if (!user) {
				return new Response(null, {
					status: 302,
					headers: { Location: "/login" },
				});
			}

			const form = body as { skills?: string | string[]; csrf_token?: string };
			if (!verifyCsrf(headers, form.csrf_token)) {
				return new Response("Invalid CSRF token", { status: 403 });
			}

			let skills = form.skills || [];
			if (!Array.isArray(skills)) skills = [skills];
			updateUserSkills.run(user.id, JSON.stringify(skills));
			return new Response(null, {
				status: 302,
				headers: { Location: "/account" },
			});
		})
		.get("/account/notifications", ({ headers }) => {
			const user = getCurrentUser(headers);
			if (!user) {
				return new Response(null, {
					status: 302,
					headers: { Location: "/login" },
				});
			}

			const categories = db
				.query(
					`SELECT DISTINCT category FROM events WHERE category IS NOT NULL`,
				)
				.all()
				.map((r: any) => r.category as string);

			let interests: string[] = [];
			if (user.interests) {
				try {
					interests = JSON.parse(user.interests as string);
				} catch {
					interests = [];
				}
			}

			const settings = {
				notifications_telegram: user.notifications_telegram ?? 1,
				notifications_email: user.notifications_email ?? 1,
				notifications_sms: user.notifications_sms ?? 0,
			};

			const categoryLabels: Record<string, string> = {
				health: "Здоровье",
				social: "Социальная помощь",
				sports: "Спорт",
				culture: "Культура",
				education: "Образование",
			};

			const { token, cookie } = generateCsrfToken();
			return render(
				"notifications",
				withAuth(
					{
						settings,
						categories,
						categoryLabels,
						interests,
						telegramLinked: !!user.telegram_user_id,
						botLink: `https://t.me/${TELEGRAM_BOT_USERNAME}`,
						csrf: token,
					},
					headers,
				),
				{ "Set-Cookie": cookie },
			);
		})
		.post("/account/notifications", ({ headers, body }) => {
			const user = getCurrentUser(headers);
			if (!user) {
				return new Response(null, {
					status: 302,
					headers: { Location: "/login" },
				});
			}

			const form = body as Record<string, any>;
			if (!verifyCsrf(headers, form.csrf_token)) {
				return new Response("Invalid CSRF token", { status: 403 });
			}

			const telegram = form.telegram === "on" ? 1 : 0;
			const email = form.email === "on" ? 1 : 0;
			const sms = form.sms === "on" ? 1 : 0;
			let interests = form.interests || [];
			if (!Array.isArray(interests)) interests = [interests];

			updateUserNotifications.run(
				user.id,
				telegram,
				email,
				sms,
				JSON.stringify(interests),
			);

			return new Response(null, {
				status: 302,
				headers: { Location: "/account/notifications" },
			});
		})
		.get("/history", ({ headers }) => {
			const user = getCurrentUser(headers);
			if (!user) {
				return new Response(null, {
					status: 302,
					headers: { Location: "/login" },
				});
			}

			const events = db
				.query(`
        SELECT
          a.id,
          e.title as event_title,
          e.start_date,
          r.title as role_title,
          att.hours_worked,
          att.hours_verified,
          att.status as attendance_status
        FROM applications a
        JOIN events e ON a.event_id = e.id
        JOIN roles r ON a.role_id = r.id
        LEFT JOIN attendance att ON att.application_id = a.id
        JOIN shifts s ON a.shift_id = s.id
        WHERE a.user_id = ?1 AND s.end_time < datetime('now')
        ORDER BY e.start_date DESC
      `)
				.all(user.id);

			return render("history", withAuth({ events }, headers));
		})
		.post("/history/:id/request", ({ params }) => {
			console.log(`⏳ Запрос подтверждения часов для заявки ${params.id}`);
			return new Response(null, {
				status: 302,
				headers: { Location: "/history" },
			});
		})

		// Подключение Telegram
		.get("/account/telegram/connect", ({ headers }) => {
			const user = getCurrentUser(headers);
			if (!user) {
				return new Response(null, {
					status: 302,
					headers: { Location: "/login" },
				});
			}

			const telegramWidget = generateTelegramLoginWidget("/account/telegram/auth");
			
			return render("telegram-connect", withAuth({ 
				botUsername: TELEGRAM_BOT_USERNAME,
				connectUrl: "/account/telegram/auth",
				telegramWidget
			}, headers));
		})

		.post("/account/telegram/auth", ({ headers, body }) => {
			const user = getCurrentUser(headers);
			if (!user) {
				return new Response(null, {
					status: 302,
					headers: { Location: "/login" },
				});
			}

			const telegramData = body as Record<string, any>;
			
			// Проверяем валидность данных от Telegram
			const isValid = verifyTelegramAuth(telegramData, process.env.TELEGRAM_BOT_TOKEN || "");
			
			if (!isValid) {
				return new Response(null, {
					status: 302,
					headers: { Location: "/account?error=telegram_auth_failed" },
				});
			}

			// Проверяем, не привязан ли уже этот Telegram аккаунт
			const existingUser = db.query("SELECT id FROM users WHERE telegram_user_id = ? AND id != ?")
				.get(telegramData.id, user.id);
			
			if (existingUser) {
				return new Response(null, {
					status: 302,
					headers: { Location: "/account?error=telegram_already_linked" },
				});
			}

			// Привязываем Telegram к аккаунту
			db.query(`
				UPDATE users 
				SET telegram_user_id = ?, 
				    telegram_username = ?, 
				    telegram_linked_at = datetime('now')
				WHERE id = ?
			`).run(
				telegramData.id,
				telegramData.username || null,
				user.id
			);

			return new Response(null, {
				status: 302,
				headers: { Location: "/account?success=telegram_connected" },
			});
		})

		.post("/account/telegram/disconnect", ({ headers, body }) => {
			const user = getCurrentUser(headers);
			if (!user) {
				return new Response(null, {
					status: 302,
					headers: { Location: "/login" },
				});
			}

			const form = body as Record<string, any>;
			if (!verifyCsrf(headers, form.csrf_token)) {
				return new Response("Invalid CSRF token", { status: 403 });
			}

			// Отвязываем Telegram от аккаунта
			db.query(`
				UPDATE users 
				SET telegram_user_id = NULL, 
				    telegram_username = NULL, 
				    telegram_linked_at = NULL
				WHERE id = ?
			`).run(user.id);

			return new Response(null, {
				status: 302,
				headers: { Location: "/account?success=telegram_disconnected" },
			});
		})

		// Страница редактирования профиля
		.get("/account/edit", ({ headers }) => {
			const user = getCurrentUser(headers);
			if (!user) {
				return new Response(null, {
					status: 302,
					headers: { Location: "/login" },
				});
			}

			const { token } = generateCsrfToken();

			// Список доступных языков
			const availableLanguages = [
				'Русский', 'English', 'Español', 'Français', 'Deutsch', 
				'中文', 'العربية', 'हिन्दी', 'Italiano', 'Português'
			];

			// Парсим существующие языки пользователя
			let userLanguages = [];
			if (user.languages) {
				try {
					userLanguages = JSON.parse(user.languages);
				} catch {
					userLanguages = [];
				}
			}

			return render("account/edit", withAuth({ 
				csrf: token,
				availableLanguages,
				userLanguages,
				error: null,
				success: null
			}, headers));
		})

		// Обновление профиля
		.post("/account/edit", ({ headers, body }) => {
			const user = getCurrentUser(headers);
			if (!user) {
				return new Response(null, {
					status: 302,
					headers: { Location: "/login" },
				});
			}

			// Проверяем CSRF токен
			const formData = body as Record<string, any>;
			if (!verifyCsrf(headers, formData.csrf_token)) {
				return new Response("Invalid CSRF token", { status: 403 });
			}

			const { name, phone, languages, bio } = formData;

			// Валидация данных
			const errors = [];
			
			if (!name || name.trim().length < 2) {
				errors.push("Имя должно содержать минимум 2 символа");
			}
			
			if (name && name.trim().length > 100) {
				errors.push("Имя не должно превышать 100 символов");
			}

			if (phone && !/^\+?[\d\s\-\(\)]{10,20}$/.test(phone.trim())) {
				errors.push("Некорректный формат телефона");
			}

			if (bio && bio.length > 500) {
				errors.push("Биография не должна превышать 500 символов");
			}

			// Обработка языков
			let languagesJson = "[]";
			if (languages) {
				const selectedLanguages = Array.isArray(languages) ? languages : [languages];
				languagesJson = JSON.stringify(selectedLanguages.slice(0, 5)); // Максимум 5 языков
			}

			if (errors.length > 0) {
				const { token } = generateCsrfToken();
				const availableLanguages = [
					'Русский', 'English', 'Español', 'Français', 'Deutsch', 
					'中文', 'العربية', 'हिन्दी', 'Italiano', 'Português'
				];

				return render("account/edit", withAuth({ 
					csrf: token,
					availableLanguages,
					userLanguages: JSON.parse(languagesJson),
					errors,
					formData
				}, headers));
			}

			try {
				// Обновляем данные пользователя
				db.query(`
					UPDATE users 
					SET name = ?, phone = ?, languages = ?, bio = ?, updated_at = datetime('now')
					WHERE id = ?
				`).run(
					name.trim(),
					phone ? phone.trim() : null,
					languagesJson,
					bio ? bio.trim() : null,
					user.id
				);

				return new Response(null, {
					status: 302,
					headers: { Location: "/account?success=profile_updated" },
				});
			} catch (error) {
				console.error("Error updating profile:", error);
				
				const { token } = generateCsrfToken();
				const availableLanguages = [
					'Русский', 'English', 'Español', 'Français', 'Deutsch', 
					'中文', 'العربية', 'हिन्दी', 'Italiano', 'Português'
				];

				return render("account/edit", withAuth({ 
					csrf: token,
					availableLanguages,
					userLanguages: JSON.parse(languagesJson),
					error: "Произошла ошибка при сохранении данных",
					formData
				}, headers));
			}
		});
