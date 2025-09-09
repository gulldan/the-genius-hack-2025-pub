import { db } from "../sql/queries.ts";

/**
 * Получить текущего пользователя из cookie
 */
export function getCurrentUser(headers?: Record<string, string> | Headers) {
	let cookieHeader: string | null = null;

	if (headers instanceof Headers) {
		cookieHeader = headers.get("cookie");
	} else {
		cookieHeader = headers?.cookie || null;
	}

	if (!cookieHeader) return null;

	const match = cookieHeader.match(/(?:^|;\s*)user_id=(\d+)/);
	if (!match) return null;

	const userId = Number(match[1]);
	if (!userId) return null;

	const user = db.query("SELECT * FROM users WHERE id = ?").get(userId);
	if (!user) return null;

	if (user.roles) {
		try {
			user.roles = JSON.parse(user.roles);
		} catch {
			user.roles = ["volunteer"];
		}
	}

	console.log("🔐 Current user:", {
		id: user.id,
		name: user.name,
		roles: user.roles,
	});

	return user;
}

/**
 * Middleware для добавления пользователя в контекст шаблона
 */
export function withAuth(templateData: any, headers?: Record<string, string>) {
	const user = getCurrentUser(headers);
	return {
		...templateData,
		user,
	};
}

/**
 * Проверка ролей пользователя
 */
export function hasRole(user: any, role: string): boolean {
	if (!user || !user.roles) return false;

	const roles = Array.isArray(user.roles)
		? user.roles
		: JSON.parse(user.roles || "[]");
	return roles.includes(role);
}

/**
 * Middleware для проверки ролей
 */
export function requireRoles(roles: string[], handler: any) {
	return (ctx: any) => {
		const user = getCurrentUser(ctx.headers);
		if (!user) {
			return new Response(null, {
				status: 302,
				headers: { Location: "/login" },
			});
		}

		const allowed = roles.some((r) => hasRole(user, r));
		if (!allowed) {
			return new Response("Недостаточно прав", { status: 403 });
		}

		return handler(ctx);
	};
}

/**
 * Проверка доступа к организации
 */
export function canAccessOrganization(user: any, orgId: number): boolean {
	if (!user) return false;

	console.log("🔐 Checking org access:", {
		userId: user.id,
		orgId,
		roles: user.roles,
	});

	// В демо-режиме разрешаем доступ ко всем организациям для всех пользователей
	return true; // Упрощаем для демо
}
