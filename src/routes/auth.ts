import type { Elysia } from "elysia";
import { render } from "../lib/template.ts";
import { generateCsrfToken, verifyCsrf } from "../lib/csrf.ts";
import { rateLimit } from "../lib/rateLimit.ts";
import { validateEmail } from "../lib/validators.ts";
import { getCurrentUser } from "../lib/auth.ts";
import {
	verifyTelegramAuth,
	generateTelegramLoginWidget,
	TELEGRAM_ENABLED,
} from "../lib/telegram.ts";
import {
	insertUser,
	getUserByTelegramId,
	linkTelegramUser,
	db,
} from "../sql/queries.ts";

export const authRoutes = (app: Elysia) =>
	app
		// Login page
                .get("/login", ({ query }) => {
                        const telegramWidget = generateTelegramLoginWidget("/auth/telegram");
                        const { token, cookie } = generateCsrfToken();
                        const error = (query as Record<string, string>)?.error;
                        const success = (query as Record<string, string>)?.success;
                        return render(
                                "auth/login",
                                { telegramWidget, telegramEnabled: TELEGRAM_ENABLED, csrf: token, error, success },
                                { "Set-Cookie": cookie },
                        );
                })

		// Demo email/password login
		.post("/login", ({ body, headers }) => {
			const { email, password, csrf } = body as { email: string; password: string; csrf: string };
			
			// Проверяем CSRF токен
			if (!verifyCsrf(headers, csrf)) {
				return new Response(null, {
					status: 302,
					headers: { Location: "/login?error=invalid_csrf" },
				});
			}
			
			// Простая демо-аутентификация
			if (password !== "demo123") {
				return new Response(null, {
					status: 302,
					headers: { Location: "/login?error=invalid_credentials" },
				});
			}

			// Найти пользователя по email
			const user = db.query("SELECT * FROM users WHERE email = ?").get(email);
			if (!user) {
				return new Response(null, {
					status: 302,
					headers: { Location: "/login?error=user_not_found" },
				});
			}

			// Парсим роли
			let roles = ["volunteer"];
			if (user.roles) {
				try {
					roles = JSON.parse(user.roles);
				} catch {
					roles = ["volunteer"];
				}
			}

			// Определяем куда перенаправить в зависимости от роли и email
			let redirectPath = "/account";
			
			// Админ с мультиролями может выбирать
			if (user.email === "admin@example.com") {
				redirectPath = "/role-selector"; // Админ выбирает роль
			} 
			// Чистый координатор
			else if (roles.includes("coordinator") && !roles.includes("organizer")) {
				redirectPath = "/coordinator";
			} 
			// Чистый организатор
			else if (roles.includes("organizer") && !roles.includes("coordinator")) {
				redirectPath = "/org/dashboard";
			}
			// Волонтер или мультироль - на аккаунт
			else {
				redirectPath = "/account";
			}

			// Устанавливаем сессию
			return new Response(null, {
				status: 302,
				headers: {
					Location: redirectPath,
					"Set-Cookie": `user_id=${user.id}; Path=/; HttpOnly; SameSite=Strict`,
				},
			});
		})

		// Telegram auth callback
		.post("/auth/telegram", ({ body }) => {
			const authData = body as Record<string, any>;

			// Verify Telegram data (skip verification for mock data)
			const isMockAuth = authData.hash?.startsWith("mock_hash_");
			if (
				!isMockAuth &&
				!verifyTelegramAuth(authData, process.env.TELEGRAM_BOT_TOKEN || "")
			) {
				return new Response("Invalid authentication data", { status: 400 });
			}

			if (isMockAuth && !TELEGRAM_ENABLED) {
				console.log("🤖 [MOCK] Telegram авторизация:", authData);
			}

			const telegramUserId = authData.id;
			const telegramUsername = authData.username;
			const firstName = authData.first_name;
			const lastName = authData.last_name;
			const fullName = `${firstName} ${lastName || ""}`.trim();

			// Check if user already exists
			let user = getUserByTelegramId.get(telegramUserId);

			if (!user) {
				// Create new user
				const result = insertUser.run(fullName, null, null, '["volunteer"]');
				const userId = result.lastInsertRowid as number;

				// Link Telegram account
				linkTelegramUser.run(userId, telegramUserId, telegramUsername);

				user = db.query("SELECT * FROM users WHERE id = ?").get(userId);
			}

			// Set session (simplified - in production use proper session management)
			return new Response(null, {
				status: 302,
				headers: {
					Location: "/account",
					"Set-Cookie": `user_id=${user.id}; Path=/; HttpOnly; SameSite=Strict`,
				},
			});
		})

		// Logout
		.post("/logout", () => {
			return new Response(null, {
				status: 302,
				headers: {
					Location: "/",
					"Set-Cookie":
						"user_id=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
				},
			});
		})
		.get("/logout", () => {
			return new Response(null, {
				status: 302,
				headers: {
					Location: "/",
					"Set-Cookie":
						"user_id=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
				},
			});
		})

		// Role selector for multi-role users
		.get("/role-selector", ({ headers }) => {
			const user = getCurrentUser(headers);
			if (!user) {
				return new Response(null, {
					status: 302,
					headers: { Location: "/login" },
				});
			}

			// Только для админа с мультиролями
			if (user.email !== "admin@example.com") {
				return new Response(null, {
					status: 302,
					headers: { Location: "/account" },
				});
			}

			return render("auth/role-selector", { user });
		})

		// Handle role selection
		.post("/role-selector", ({ headers, body }) => {
			const user = getCurrentUser(headers);
			if (!user || user.email !== "admin@example.com") {
				return new Response(null, {
					status: 302,
					headers: { Location: "/account" },
				});
			}

			const { selectedRole } = body as { selectedRole: string };
			
			let redirectPath = "/account";
			if (selectedRole === "coordinator") {
				redirectPath = "/coordinator";
			} else if (selectedRole === "organizer") {
				redirectPath = "/org/dashboard";
			} else if (selectedRole === "volunteer") {
				redirectPath = "/account";
			}

			return new Response(null, {
				status: 302,
				headers: { Location: redirectPath },
			});
		})

		// Registration page
                .get("/register", () => {
                        const { token, cookie } = generateCsrfToken();
                        return render("auth/register", { csrf: token }, { "Set-Cookie": cookie });
                })

		// Handle registration
                .post("/register", ({ body, headers }) => {
                        const { name, email, phone, telegram_username, csrf_token } = body as any;

                        if (!verifyCsrf(headers, csrf_token)) {
                                return new Response("Invalid CSRF token", { status: 403 });
                        }
                        if (!rateLimit(headers)) {
                                return new Response("Too many requests", { status: 429 });
                        }
                        if (!validateEmail(email)) {
                                return render("auth/register", {
                                        error: "Неверный email",
                                        csrf: generateCsrfToken().token,
                                });
                        }

                        try {
                                const result = insertUser.run(name, email, phone, '["volunteer"]');
                                const userId = result.lastInsertRowid as number;

                                if (telegram_username) {
                                        // Store for later linking when user connects via Telegram
                                }

                                return new Response(null, {
                                        status: 302,
                                        headers: {
                                                Location: "/login?registered=1",
                                        },
                                });
                        } catch (error) {
                                return render("auth/register", {
                                        error: "Ошибка регистрации. Возможно, email уже используется.",
                                });
                        }
                });
