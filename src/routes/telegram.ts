import type { Elysia } from "elysia";
import {
        TELEGRAM_ENABLED,
        sendTelegramMessage,
        TelegramTemplates,
        generateTelegramDeepLink,
        pendingCheckins,
        calculateDistance,
} from "../lib/telegram.ts";
import {
        getUserByTelegramId,
        applicationById,
        updateAttendance,
        createAttendance,
        attendanceByApplication,
        db,
        checkoutAttendance,
} from "../sql/queries.ts";
import {
        notifyCheckinSuccess,
        scheduleCheckoutReminder,
        notifyShiftCompleted,
} from "../lib/notifications.ts";
import { updateApplicationStatus } from "../lib/applications.ts";

export const telegramRoutes = (app: Elysia) =>
	app
		// Webhook для получения сообщений от Telegram бота
		.post("/webhook/telegram", async ({ body }) => {
			if (!TELEGRAM_ENABLED) {
				console.log("📱 [MOCK] Telegram webhook:", body);
				return { ok: true };
			}

			const update = body as any;

			try {
				if (update.message) {
					await handleMessage(update.message);
				} else if (update.callback_query) {
					await handleCallbackQuery(update.callback_query);
				}

				return { ok: true };
			} catch (error) {
				console.error("Telegram webhook error:", error);
				return { ok: false, error: error.message };
			}
		})

		// Отправка уведомлений (для тестирования)
		.post("/api/notifications/test", async ({ body }) => {
			const { type, user_id, data } = body as any;

			const user = db.query("SELECT * FROM users WHERE id = ?").get(user_id);
			if (!user || !user.telegram_user_id) {
				return {
					success: false,
					error: "Пользователь не найден или Telegram не подключён",
				};
			}

			let message;
			switch (type) {
				case "application_confirmed":
					message = TelegramTemplates.applicationConfirmation(
						data.event_title,
						data.role_title,
						data.shift_time,
					);
					break;

				case "shift_reminder":
					message = TelegramTemplates.shiftReminder(
						data.event_title,
						data.role_title,
						data.shift_time,
						data.checkin_link,
					);
					break;

				case "checkin_success":
					message = TelegramTemplates.checkinSuccess(
						data.event_title,
						data.hours_expected,
					);
					break;

				case "checkout_request":
					message = TelegramTemplates.checkoutRequest(
						data.event_title,
						data.hours_worked,
					);
					break;

				default:
					return { success: false, error: "Неизвестный тип уведомления" };
			}

			const sent = await sendTelegramMessage(user.telegram_user_id, message);
			return { success: sent };
		})

		// Deep link обработчики
                .get("/tg/start/:payload", ({ params }) => {
                        const payload = params.payload;
                        console.log("📱 Telegram start payload:", payload);

                        // Парсим payload
                        if (payload.startsWith("EVT_")) {
                                const eventId = payload.replace("EVT_", "");
				return new Response(null, {
					status: 302,
					headers: { Location: `/events/${eventId}` },
				});
			} else if (payload.startsWith("SHF_")) {
				const shiftId = payload.replace("SHF_", "");
				return new Response(null, {
					status: 302,
					headers: { Location: `/shifts/${shiftId}/checkin` },
				});
                        } else if (payload.startsWith("CHECKIN_")) {
                                const token = decodeURIComponent(
                                        payload.replace("CHECKIN_", ""),
                                );
                                return new Response(null, {
                                        status: 302,
                                        headers: { Location: `/checkin/token/${token}` },
                                });
                        }

			return new Response(null, {
				status: 302,
				headers: { Location: "/" },
			});
		});

// Обработчики сообщений
async function handleMessage(message: any) {
        const chatId = message.chat.id;
        const text = message.text;
        const userId = message.from.id;

        if (message.location) {
                const pending = pendingCheckins.get(userId);
                if (pending) {
                        const distance = calculateDistance(
                                pending.geofence.lat,
                                pending.geofence.lon,
                                message.location.latitude,
                                message.location.longitude,
                        );
                        if (distance > pending.geofence.radius) {
                                await sendTelegramMessage(chatId, {
                                        text: "Вы вне допустимой зоны",
                                });
                                pendingCheckins.delete(userId);
                                return;
                        }
                        const existing = attendanceByApplication.get(
                                pending.applicationId,
                        );
                        if (existing?.status === "checked_in") {
                                await sendTelegramMessage(chatId, {
                                        text: "Уже зарегистрированы",
                                });
                                pendingCheckins.delete(userId);
                                return;
                        }
                        if (existing) {
                                updateAttendance.run(
                                        pending.applicationId,
                                        "checked_in",
                                        new Date().toISOString(),
                                        "telegram",
                                        `${message.location.latitude},${message.location.longitude}`,
                                );
                        } else {
                                createAttendance.run(
                                        pending.applicationId,
                                        pending.shiftId,
                                        "checked_in",
                                        "telegram",
                                        `${message.location.latitude},${message.location.longitude}`,
                                );
                        }
                        await notifyCheckinSuccess(
                                Number(pending.applicationId),
                        );
                        await scheduleCheckoutReminder(
                                Number(pending.applicationId),
                        );
                        pendingCheckins.delete(userId);
                        return;
                }
        }

        console.log("📱 [MOCK] Получено сообщение:", { chatId, text, userId });

	// Найти пользователя
	const user = getUserByTelegramId.get(userId);
	if (!user) {
		await sendTelegramMessage(chatId, {
			text: "Привет! Чтобы использовать бота, сначала войдите на сайт через Telegram: https://volunteerhub.example.com/login",
		});
		return;
	}

	// Обработка команд
        if (text === "/start") {
		await sendTelegramMessage(chatId, {
			text: `Привет, ${user.name}! 👋\n\nЧто хотите сделать?`,
			reply_markup: {
				inline_keyboard: [
					[
						{
							text: "🔍 Найти события",
							url: "https://volunteerhub.example.com/events",
						},
						{
							text: "👤 Мой профиль",
							url: "https://volunteerhub.example.com/account",
						},
					],
					[
						{
							text: "📱 Открыть приложение",
							web_app: { url: "https://volunteerhub.example.com/" },
						},
					],
				],
			},
		});
        } else if (text === "/myevents") {
		// Показать предстоящие события пользователя
		const applications = db
			.query(`
      SELECT e.title, r.title as role_title, s.start_time, s.end_time
      FROM applications a
      JOIN events e ON a.event_id = e.id
      JOIN roles r ON a.role_id = r.id
      JOIN shifts s ON a.shift_id = s.id
      WHERE a.user_id = ? AND e.start_date >= date('now') AND a.status = 'approved'
      ORDER BY e.start_date
      LIMIT 5
    `)
			.all(user.id);

		if (applications.length > 0) {
			let text = "📅 Ваши предстоящие мероприятия:\n\n";
			applications.forEach((app, index) => {
				text += `${index + 1}. ${app.title}\n`;
				text += `   Роль: ${app.role_title}\n`;
				text += `   Время: ${app.start_time} - ${app.end_time}\n\n`;
			});

			await sendTelegramMessage(chatId, { text });
                } else {
			await sendTelegramMessage(chatId, {
				text: "У вас пока нет предстоящих мероприятий.\n\n🔍 Найдите интересные возможности на сайте!",
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: "🔍 Найти события",
								url: "https://volunteerhub.example.com/events",
							},
						],
					],
				},
			});
                }
        } else if (text === "/help") {
                await sendTelegramMessage(chatId, {
                        text:
                                "Доступные команды:\n/start - главное меню\n/myevents - мои события\n/help - помощь",
                });
        } else if (text === "/checkin" && user.roles?.includes("coordinator")) {
                await sendTelegramMessage(chatId, {
                        text: "Откройте панель координатора: https://volunteerhub.example.com/events",
                });
        } else if (text === "/roster" && user.roles?.includes("coordinator")) {
                await sendTelegramMessage(chatId, {
                        text: "Список участников доступен в панели координатора.",
                });
        } else {
                // Общий ответ
                await sendTelegramMessage(chatId, {
                        text: "Извините, я не понимаю эту команду. Используйте /start для главного меню.",
                });
	}
}

// Обработчики callback кнопок
async function handleCallbackQuery(callbackQuery: any) {
	const chatId = callbackQuery.message.chat.id;
        const data = callbackQuery.data;
        const userId = callbackQuery.from.id;

	console.log("📱 [MOCK] Callback query:", { chatId, data, userId });

	const user = getUserByTelegramId.get(userId);
	if (!user) {
		return;
	}

        const [action, id] = String(data).split(":");

        switch (action) {
                case "confirm_attendance":
                        if (id) updateApplicationStatus(Number(id), "approved");
                        await sendTelegramMessage(chatId, {
                                text: "✅ Участие подтверждено! Увидимся на мероприятии.",
                        });
                        break;

                case "cancel_attendance":
                        if (id) updateApplicationStatus(Number(id), "cancelled");
                        await sendTelegramMessage(chatId, {
                                text: "😔 Жаль, что не сможете прийти. Мы найдём замену из листа ожидания.",
                        });
                        break;

                case "checkout_confirm":
                        if (id) {
                                const app = applicationById.get(id);
                                if (app) {
                                        const start = new Date(app.start_time);
                                        const hours =
                                                (Date.now() - start.getTime()) /
                                                3_600_000;
                                        checkoutAttendance.run(id, hours);
                                        await notifyShiftCompleted(Number(id), hours);
                                }
                        }
                        await sendTelegramMessage(chatId, {
                                text: "✅ Смена завершена! Спасибо за вашу работу! 🙏\n\nВаши волонтёрские часы будут добавлены в профиль после подтверждения координатором.",
                        });
                        break;

                case "extend_shift":
                        if (id) await scheduleCheckoutReminder(Number(id));
                        await sendTelegramMessage(chatId, {
                                text: "⏰ Хорошо, продолжайте работу. Мы отправим напоминание через час.",
                        });
                        break;

                case "add_calendar":
                        await sendTelegramMessage(chatId, {
                                text: "📅 Функция добавления в календарь - в разработке.\n\nПока что сохраните дату самостоятельно!",
                        });
                        break;

		case "event_details":
			await sendTelegramMessage(chatId, {
				text: "ℹ️ Подробности мероприятия доступны на сайте.",
				reply_markup: {
					inline_keyboard: [
						[
							{
								text: "🌐 Открыть на сайте",
								url: "https://volunteerhub.example.com/events/1",
							},
						],
					],
				},
			});
			break;

                default:
                        console.log("Unknown callback data:", data);
        }

	// Ответ на callback query
	await fetch(
		`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				callback_query_id: callbackQuery.id,
				text: "Обработано",
			}),
		},
	);
}
