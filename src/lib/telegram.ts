import { createHash, createHmac } from "node:crypto";

// Telegram Bot configuration and secrets
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
export const TELEGRAM_BOT_USERNAME =
        process.env.TELEGRAM_BOT_USERNAME || "volunteerhub_bot";
export const TELEGRAM_ENABLED = !!TELEGRAM_BOT_TOKEN;
export const QR_SECRET = process.env.QR_SECRET || "demo-secret";
export const SESSION_SECRET = process.env.SESSION_SECRET || "change-me";

export const pendingCheckins = new Map<
	number,
	{
		applicationId: string;
		shiftId: string;
		geofence: { lat: number; lon: number; radius: number };
	}
>();

export function calculateDistance(
	lat1: number,
	lon1: number,
	lat2: number,
	lon2: number,
): number {
	const toRad = (x: number) => (x * Math.PI) / 180;
	const R = 6_371_000;
	const dLat = toRad(lat2 - lat1);
	const dLon = toRad(lon2 - lon1);
	const a =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos(toRad(lat1)) *
			Math.cos(toRad(lat2)) *
			Math.sin(dLon / 2) *
			Math.sin(dLon / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return R * c;
}

/**
 * Verify Telegram login widget data
 * @param authData - Data received from Telegram Login Widget
 * @param botToken - Bot token for verification
 * @returns boolean - true if data is valid
 */
export function verifyTelegramAuth(
        authData: Record<string, any>,
        botToken: string,
): boolean {
        const { hash, ...data } = authData;

        if (!hash) return false;

        // Allow mock hash when bot disabled
        if (!TELEGRAM_ENABLED && String(hash).startsWith("mock_hash")) {
                return true;
        }

        // Create data-check-string
        const dataCheckString = Object.keys(data)
                .sort()
                .map((key) => `${key}=${data[key]}`)
                .join("\n");

        // Create secret key
        const secretKey = createHash("sha256").update(botToken).digest();

        // Create HMAC
        const hmac = createHmac("sha256", secretKey)
                .update(dataCheckString)
                .digest("hex");

        return hmac === hash;
}

/**
 * Generate deep link for Telegram bot
 * @param command - Command to execute (e.g., 'start', 'startapp')
 * @param payload - Payload to pass to the bot
 * @returns string - Deep link URL
 */
export function generateTelegramDeepLink(
	command: "start" | "startapp",
	payload: string,
): string {
	const baseUrl = `https://t.me/${TELEGRAM_BOT_USERNAME}`;
	return `${baseUrl}?${command}=${payload}`;
}

/**
 * Generate QR code data for check-in
 * @param applicationId - Application ID
 * @param shiftId - Shift ID
 * @returns string - QR code data
 */
export function generateCheckinQRData(
        applicationId: string,
        shiftId: string,
): string {
        const timestamp = Date.now();
        const data = `CHECKIN:${applicationId}:${shiftId}:${timestamp}`;

        // Add simple signature to prevent tampering
        const signature = createHmac("sha256", QR_SECRET)
                .update(data)
                .digest("hex")
                .substring(0, 8);

        return `${data}:${signature}`;
}

/**
 * Verify QR code data
 * @param qrData - QR code data to verify
 * @returns object - Parsed and verified data or null if invalid
 */
export function verifyCheckinQRData(
	qrData: string,
): { applicationId: string; shiftId: string; timestamp: number } | null {
	const parts = qrData.split(":");
	if (parts.length !== 5 || parts[0] !== "CHECKIN") {
		return null;
	}

	const [, applicationId, shiftId, timestampStr, signature] = parts;
	const timestamp = parseInt(timestampStr, 10);

	// Verify signature
	const data = `CHECKIN:${applicationId}:${shiftId}:${timestamp}`;
	const expectedSignature = createHmac(
		"sha256",
		process.env.QR_SECRET || "default-secret",
	)
		.update(data)
		.digest("hex")
		.substring(0, 8);

	if (signature !== expectedSignature) {
		return null;
	}

	// Check if QR code is not too old (24 hours)
	if (Date.now() - timestamp > 24 * 60 * 60 * 1000) {
		return null;
	}

	return { applicationId, shiftId, timestamp };
}

/**
 * Generate Telegram message templates
 */
export const TelegramTemplates = {
	applicationConfirmation: (
		eventTitle: string,
		roleTitle: string,
		shiftTime: string,
	) => ({
		text: `✅ Ваша заявка принята!\n\n🎯 Мероприятие: ${eventTitle}\n👤 Роль: ${roleTitle}\n⏰ Смена: ${shiftTime}\n\nМы отправим напоминание перед началом мероприятия.`,
		reply_markup: {
			inline_keyboard: [
				[
					{ text: "📅 Добавить в календарь", callback_data: "add_calendar" },
					{ text: "ℹ️ Подробнее", callback_data: "event_details" },
				],
			],
		},
	}),

        shiftReminder: (
                eventTitle: string,
                roleTitle: string,
                shiftTime: string,
                checkinLink: string,
                applicationId: number,
        ) => ({
		text: `⏰ Напоминание о мероприятии\n\n🎯 ${eventTitle}\n👤 Роль: ${roleTitle}\n⏰ Начало: ${shiftTime}\n\n⚡ Готовы к регистрации?`,
		reply_markup: {
			inline_keyboard: [
				[
					{
						text: "✅ Подтвердить участие",
                                                callback_data: `confirm_attendance:${applicationId}`,
                                        },
                                        {
                                                text: "❌ Не смогу прийти",
                                                callback_data: `cancel_attendance:${applicationId}`,
                                        },
                                ],
                                [{ text: "📍 Открыть чекин", url: checkinLink }],
                        ],
                },
        }),

	checkinSuccess: (eventTitle: string, hoursExpected: number) => ({
		text: `✅ Регистрация успешна!\n\n🎯 ${eventTitle}\n⏰ Время начала: ${new Date().toLocaleTimeString("ru-RU")}\n\nОжидаемое время работы: ${hoursExpected} ч.\n\nУдачи! 🙌`,
		reply_markup: {
			inline_keyboard: [
				[{ text: "📋 Детали мероприятия", callback_data: "event_info" }],
			],
		},
	}),

        checkoutRequest: (
                eventTitle: string,
                hoursWorked: number,
                applicationId: number,
        ) => ({
		text: `⏰ Время завершить работу?\n\n🎯 ${eventTitle}\n⏱️ Отработано: ${hoursWorked} ч.\n\nПожалуйста, подтвердите завершение смены.`,
		reply_markup: {
			inline_keyboard: [
                                [
                                        {
                                                text: "✅ Завершить смену",
                                                callback_data: `checkout_confirm:${applicationId}`,
                                        },
                                        {
                                                text: "⏰ Продолжить работу",
                                                callback_data: `extend_shift:${applicationId}`,
                                        },
                                ],
                        ],
                },
        }),

	shiftCompleted: (eventTitle: string, hoursWorked: number) => ({
		text: `🙌 Спасибо за вашу помощь!\n\n🎯 ${eventTitle}\n🕒 Зачтено: ${hoursWorked} ч.\n\nДо встречи на следующих мероприятиях!`,
	}),

	hoursVerified: (eventTitle: string, hoursWorked: number) => ({
		text: `✅ Часы подтверждены!\n\n🎯 ${eventTitle}\n➕ Добавлено: ${hoursWorked} ч.\n\nСертификат доступен в профиле.`,
	}),
};

/**
 * Send message via Telegram Bot API
 * @param chatId - Telegram chat ID
 * @param message - Message object with text and optional reply_markup
 * @returns Promise<boolean> - Success status
 */
export async function sendTelegramMessage(
	chatId: number,
	message: { text: string; reply_markup?: any },
): Promise<boolean> {
	if (!TELEGRAM_ENABLED) {
		console.log("📱 [MOCK] Telegram сообщение:", {
			chatId,
			text: message.text,
			buttons: message.reply_markup?.inline_keyboard?.map((row: any) =>
				row.map((btn: any) => btn.text),
			),
		});
		return true; // Возвращаем успех для мока
	}

	try {
		const response = await fetch(
			`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					chat_id: chatId,
					text: message.text,
					reply_markup: message.reply_markup,
					parse_mode: "HTML",
				}),
			},
		);

		const result = await response.json();
		return result.ok;
	} catch (error) {
		console.error("Failed to send Telegram message:", error);
		return false;
	}
}

/**
 * Generate Telegram Login Widget script
 * @param redirectUrl - URL to redirect after login
 * @returns string - HTML script tag
 */
export function generateTelegramLoginWidget(redirectUrl: string): string {
	if (!TELEGRAM_ENABLED) {
		return `
      <div class="bg-slate-100 border-2 border-dashed border-slate-300 rounded-lg p-6 text-center">
        <div class="text-slate-500 mb-2">
          <i data-lucide="settings" class="w-8 h-8 mx-auto mb-2"></i>
          <p class="font-medium">Telegram не настроен</p>
        </div>
        <p class="text-sm text-slate-400 mb-4">
          Для работы с Telegram установите переменные окружения:<br>
          <code class="bg-slate-200 px-2 py-1 rounded text-xs">TELEGRAM_BOT_TOKEN</code><br>
          <code class="bg-slate-200 px-2 py-1 rounded text-xs">TELEGRAM_BOT_USERNAME</code>
        </p>
        <button 
          onclick="mockTelegramLogin()" 
          class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          🤖 Демо-вход (без Telegram)
        </button>
      </div>
      <script>
        function mockTelegramLogin() {
          // Имитируем данные от Telegram
          const mockData = {
            id: 12345,
            first_name: 'Тестовый',
            last_name: 'Пользователь', 
            username: 'test_user',
            auth_date: Math.floor(Date.now() / 1000),
            hash: 'mock_hash_' + Date.now()
          };
          
          // Отправляем на сервер
          const form = document.createElement('form');
          form.method = 'POST';
          form.action = '${redirectUrl}';
          
          Object.entries(mockData).forEach(([key, value]) => {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = key;
            input.value = String(value);
            form.appendChild(input);
          });
          
          document.body.appendChild(form);
          form.submit();
        }
      </script>
    `;
	}

	return `
    <script async src="https://telegram.org/js/telegram-widget.js?22" 
      data-telegram-login="${TELEGRAM_BOT_USERNAME}"
      data-size="large"
      data-auth-url="${redirectUrl}"
      data-request-access="write">
    </script>
  `;
}

/**
 * Mini App utilities
 */
export const TelegramMiniApp = {
	/**
	 * Initialize Mini App
	 */
	init: () => `
    <script>
      if (window.Telegram?.WebApp) {
        const tg = window.Telegram.WebApp;
        tg.ready();
        tg.expand();
        
        // Set theme
        document.documentElement.style.setProperty('--tg-theme-bg-color', tg.themeParams.bg_color || '#ffffff');
        document.documentElement.style.setProperty('--tg-theme-text-color', tg.themeParams.text_color || '#000000');
        document.documentElement.style.setProperty('--tg-theme-hint-color', tg.themeParams.hint_color || '#999999');
        document.documentElement.style.setProperty('--tg-theme-link-color', tg.themeParams.link_color || '#2481cc');
        document.documentElement.style.setProperty('--tg-theme-button-color', tg.themeParams.button_color || '#2481cc');
        document.documentElement.style.setProperty('--tg-theme-button-text-color', tg.themeParams.button_text_color || '#ffffff');
        
        // Global functions
        window.tgApp = tg;
        window.showTgAlert = (message) => tg.showAlert(message);
        window.closeTgApp = () => tg.close();
      }
    </script>
  `,

	/**
	 * Generate deep link for Mini App
	 */
	generateLink: (path: string, params?: Record<string, string>) => {
		const baseUrl = `https://t.me/${TELEGRAM_BOT_USERNAME}/app`;
		const searchParams = new URLSearchParams({ startapp: path, ...params });
		return `${baseUrl}?${searchParams.toString()}`;
	},
};
