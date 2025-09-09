import {
        attendanceByApplication,
        checkoutAttendance,
        db,
} from "../sql/queries.ts";
import {
	generateTelegramDeepLink,
	sendTelegramMessage,
	TelegramTemplates,
} from "./telegram.ts";

export interface NotificationData {
	user_id: number;
	event_id?: number;
	application_id?: number;
	shift_id?: number;
	type:
		| "application_confirmed"
		| "shift_reminder"
		| "checkin_success"
		| "checkout_request"
		| "shift_completed"
		| "event_cancelled"
		| "shift_changed"
		| "event_closed"
		| "hours_verified";
	data?: Record<string, unknown>;
}

/**
 * Отправить уведомление пользователю
 */
export async function sendNotification(
	notification: NotificationData,
): Promise<boolean> {
	const user = db
		.query("SELECT * FROM users WHERE id = ?")
		.get(notification.user_id);
	if (!user) {
		console.error("User not found:", notification.user_id);
		return false;
	}

	// Логируем аналитику
	logAnalyticsEvent("notification_sent", {
		user_id: notification.user_id,
		type: notification.type,
		channel: user.telegram_user_id ? "telegram" : "email",
	});

	// Отправляем через Telegram если подключён
	if (user.telegram_user_id && user.notifications_telegram) {
		return await sendTelegramNotification(user.telegram_user_id, notification);
	}

	// Фолбэк на email (заглушка)
	if (user.email && user.notifications_email) {
		return await sendEmailNotification(user.email, notification);
	}

	console.log(
		"📧 [MOCK] No notification channels available for user:",
		user.name,
	);
	return false;
}

/**
 * Отправить Telegram уведомление
 */
async function sendTelegramNotification(
	telegramUserId: number,
	notification: NotificationData,
): Promise<boolean> {
	let message: { text: string; reply_markup?: any } | undefined;

	switch (notification.type) {
		case "application_confirmed": {
			if (!notification.application_id) return false;
			const appData = await getApplicationDetails(notification.application_id);

			message = TelegramTemplates.applicationConfirmation(
				appData.event_title,
				appData.role_title,
				appData.shift_time,
			);
			break;
		}

		case "shift_reminder": {
			if (!notification.application_id) return false;
			const reminderData = await getApplicationDetails(
				notification.application_id,
			);
			const shiftCheckinLink = generateTelegramDeepLink(
				"startapp",
				`SHF_${notification.shift_id}`,
			);

                        message = TelegramTemplates.shiftReminder(
                                reminderData.event_title,
                                reminderData.role_title,
                                reminderData.shift_time,
                                shiftCheckinLink,
                                notification.application_id!,
                        );
                        break;
                }

		case "checkin_success": {
			if (!notification.application_id) return false;
			const checkinData = await getApplicationDetails(
				notification.application_id,
			);
			message = TelegramTemplates.checkinSuccess(
				checkinData.event_title,
				notification.data?.hours_expected || 4,
			);
			break;
		}

                case "checkout_request": {
                        if (!notification.application_id) return false;
                        const checkoutData = await getApplicationDetails(
                                notification.application_id,
                        );
                        message = TelegramTemplates.checkoutRequest(
                                checkoutData.event_title,
                                notification.data?.hours_worked || 4,
                                notification.application_id,
                        );
                        break;
                }

		case "shift_completed": {
			if (!notification.application_id) return false;
			const completedData = await getApplicationDetails(
				notification.application_id,
			);
			message = TelegramTemplates.shiftCompleted(
				completedData.event_title,
				notification.data?.hours_worked || 0,
			);
			break;
		}

		case "hours_verified": {
			if (!notification.application_id) return false;
			const verifiedData = await getApplicationDetails(
				notification.application_id,
			);
			message = TelegramTemplates.hoursVerified(
				verifiedData.event_title,
				notification.data?.hours_worked || 0,
			);
			break;
		}

		case "event_cancelled":
			message = {
				text: `😔 Мероприятие отменено\n\n${notification.data?.event_title}\n\nИзвините за неудобства. Мы найдём для вас другие возможности!`,
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: "🔍 Найти другие события",
								url: "https://volunteerhub.example.com/events",
							},
						],
					],
				},
			};
			break;

		case "event_closed":
			message = {
				text: `✅ Событие завершено\n\n${notification.data?.event_title}\n\nСпасибо за участие!`,
			};
			break;

		case "shift_changed":
			message = {
				text: `⚠️ Изменения в расписании\n\n${notification.data?.event_title}\n\nВремя смены изменено:\n${notification.data?.old_time} → ${notification.data?.new_time}\n\nПроверьте детали на сайте.`,
				reply_markup: {
					inline_keyboard: [
						[
							{ text: "✅ Подходит", callback_data: "schedule_change_ok" },
							{
								text: "❌ Не подходит",
								callback_data: "schedule_change_cancel",
							},
						],
					],
				},
			};
			break;

		default:
			console.error("Unknown notification type:", notification.type);
			return false;
	}

	return await sendTelegramMessage(telegramUserId, message);
}

/**
 * Отправить email уведомление (заглушка)
 */
async function sendEmailNotification(
	email: string,
	notification: NotificationData,
): Promise<boolean> {
	console.log("📧 [MOCK] Email notification:", {
		to: email,
		type: notification.type,
		data: notification.data,
	});

	// В реальном приложении здесь была бы интеграция с email сервисом
	return true;
}

/**
 * Получить данные по заявке: событие, роль и смена
 */
async function getApplicationDetails(applicationId: number) {
	const result = db
		.query(`
    SELECT e.title as event_title,
           r.title as role_title,
           s.start_time,
           s.end_time
    FROM applications a
    JOIN events e ON a.event_id = e.id
    JOIN roles r ON a.role_id = r.id
    JOIN shifts s ON a.shift_id = s.id
    WHERE a.id = ?
  `)
		.get(applicationId);

	if (!result) {
		return {
			event_title: "Неизвестное событие",
			role_title: "Неизвестная роль",
			shift_time: "Время не указано",
		};
	}

	return {
		event_title: result.event_title,
		role_title: result.role_title,
		shift_time: `${result.start_time} - ${result.end_time}`,
		start_time: result.start_time,
		end_time: result.end_time,
	};
}

/**
 * Запланировать напоминания для события
 */
export async function scheduleEventReminders(eventId: number): Promise<void> {
	// Получаем все одобренные заявки для события
	const applications = db
		.query(`
    SELECT a.*, u.telegram_user_id, s.start_time
    FROM applications a
    JOIN users u ON a.user_id = u.id
    JOIN shifts s ON a.shift_id = s.id
    WHERE a.event_id = ? AND a.status = 'approved' AND u.telegram_user_id IS NOT NULL
  `)
		.all(eventId);

	console.log(
		`📅 [MOCK] Запланированы напоминания для ${applications.length} участников события ${eventId}`,
	);

	// В реальном приложении здесь была бы интеграция с планировщиком задач (cron, Redis Queue, etc.)
	applications.forEach((app) => {
		const shiftTime = new Date(app.start_time);
		const reminder24h = new Date(shiftTime.getTime() - 24 * 60 * 60 * 1000);
		const reminder2h = new Date(shiftTime.getTime() - 2 * 60 * 60 * 1000);

		console.log(`📱 [MOCK] Напоминания для пользователя ${app.user_id}:`);
		console.log(`  - За 24ч: ${reminder24h.toLocaleString("ru-RU")}`);
		console.log(`  - За 2ч: ${reminder2h.toLocaleString("ru-RU")}`);
	});
}

/**
 * Отправить напоминание о смене
 */
export async function sendShiftReminder(
	applicationId: number,
): Promise<boolean> {
	const application = db
		.query(`
    SELECT a.*, u.telegram_user_id, e.title as event_title, r.title as role_title, s.start_time, s.end_time
    FROM applications a
    JOIN users u ON a.user_id = u.id
    JOIN events e ON a.event_id = e.id
    JOIN roles r ON a.role_id = r.id
    JOIN shifts s ON a.shift_id = s.id
    WHERE a.id = ?
  `)
		.get(applicationId);

	if (!application || !application.telegram_user_id) {
		return false;
	}

	return await sendNotification({
		user_id: application.user_id,
		event_id: application.event_id,
		application_id: applicationId,
		shift_id: application.shift_id,
		type: "shift_reminder",
	});
}

/**
 * Запланировать напоминания о смене (24ч и 2ч)
 */
export async function scheduleShiftReminders(
	applicationId: number,
): Promise<void> {
	const details = await getApplicationDetails(applicationId);
	const start = new Date(details.start_time);
	const now = Date.now();

	const ms24h = start.getTime() - 24 * 60 * 60 * 1000 - now;
	const ms2h = start.getTime() - 2 * 60 * 60 * 1000 - now;

	if (ms24h > 0) setTimeout(() => sendShiftReminder(applicationId), ms24h);
	if (ms2h > 0) setTimeout(() => sendShiftReminder(applicationId), ms2h);
}

/**
 * Запланировать запрос на завершение смены за 15 минут до конца
 */
export async function scheduleCheckoutReminder(
	applicationId: number,
): Promise<void> {
	const details = await getApplicationDetails(applicationId);
	const start = new Date(details.start_time);
	const end = new Date(details.end_time);
	const expectedHours = (end.getTime() - start.getTime()) / 3_600_000;

	const msBeforeEnd = end.getTime() - 15 * 60 * 1000 - Date.now();
	if (msBeforeEnd > 0)
		setTimeout(
			() => requestCheckout(applicationId, expectedHours),
			msBeforeEnd,
		);

	const msAuto = end.getTime() - Date.now();
	if (msAuto > 0)
		setTimeout(async () => {
			const att = attendanceByApplication.get(applicationId);
			if (att?.status === "checked_in") {
				checkoutAttendance.run(applicationId, expectedHours);
				await notifyShiftCompleted(applicationId, expectedHours);
			}
		}, msAuto);
}

/**
 * Логирование аналитических событий
 */
function logAnalyticsEvent(eventType: string, data: Record<string, any>): void {
	try {
		db.query(`
      INSERT INTO analytics_events (user_id, event_type, event_data, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(data.user_id || null, eventType, JSON.stringify(data));
	} catch (error) {
		console.error("Analytics logging error:", error);
	}
}

/**
 * Автоматические уведомления при изменении статуса заявки
 */
export async function handleApplicationStatusChange(
	applicationId: number,
	newStatus: string,
	oldStatus: string,
): Promise<void> {
	if (newStatus === "approved" && oldStatus !== "approved") {
		await sendNotification({
			user_id: 0, // Будет получен из заявки
			event_id: 0, // Будет получен из заявки
			application_id: applicationId,
			type: "application_confirmed",
		});

		// Планируем напоминания
		const app = db
			.query("SELECT event_id FROM applications WHERE id = ?")
			.get(applicationId);
		if (app) {
			await scheduleEventReminders(app.event_id);
		}
	}
}

/**
 * Уведомления для чекина
 */
export async function notifyCheckinSuccess(
	applicationId: number,
): Promise<boolean> {
	const application = db
		.query(`
    SELECT a.user_id, a.event_id, e.title as event_title, s.start_time, s.end_time
    FROM applications a
    JOIN events e ON a.event_id = e.id
    JOIN shifts s ON a.shift_id = s.id
    WHERE a.id = ?
  `)
		.get(applicationId);

	if (!application) {
		return false;
	}

	const expectedHours =
		(new Date(application.end_time).getTime() -
			new Date(application.start_time).getTime()) /
		3_600_000;

	return await sendNotification({
		user_id: application.user_id,
		event_id: application.event_id,
		application_id: applicationId,
		type: "checkin_success",
		data: {
			event_title: application.event_title,
			hours_expected: expectedHours,
		},
	});
}

/**
 * Запрос на чекаут
 */
export async function requestCheckout(
	applicationId: number,
	hoursWorked: number,
): Promise<boolean> {
	const application = db
		.query(`
    SELECT a.user_id, a.event_id, e.title as event_title
    FROM applications a
    JOIN events e ON a.event_id = e.id
    WHERE a.id = ?
  `)
		.get(applicationId);

	if (!application) {
		return false;
	}

	return await sendNotification({
		user_id: application.user_id,
		event_id: application.event_id,
		application_id: applicationId,
		type: "checkout_request",
		data: {
			event_title: application.event_title,
			hours_worked: hoursWorked,
		},
	});
}

/**
 * Финальное благодарственное сообщение после завершения смены
 */
export async function notifyShiftCompleted(
	applicationId: number,
	hoursWorked: number,
): Promise<boolean> {
	const application = db
		.query(`
    SELECT a.user_id, a.event_id, e.title as event_title
    FROM applications a
    JOIN events e ON a.event_id = e.id
    WHERE a.id = ?
  `)
		.get(applicationId);

	if (!application) {
		return false;
	}

	return await sendNotification({
		user_id: application.user_id,
		event_id: application.event_id,
		application_id: applicationId,
		type: "shift_completed",
		data: {
			event_title: application.event_title,
			hours_worked: hoursWorked,
		},
	});
}

/**
 * Уведомление после подтверждения часов
 */
export async function notifyHoursVerified(
	applicationId: number,
	hoursWorked: number,
): Promise<boolean> {
	const application = db
		.query(`
    SELECT a.user_id, a.event_id, e.title as event_title
    FROM applications a
    JOIN events e ON a.event_id = e.id
    WHERE a.id = ?
  `)
		.get(applicationId);

	if (!application) {
		return false;
	}

	return await sendNotification({
		user_id: application.user_id,
		event_id: application.event_id,
		application_id: applicationId,
		type: "hours_verified",
		data: {
			event_title: application.event_title,
			hours_worked: hoursWorked,
		},
	});
}
