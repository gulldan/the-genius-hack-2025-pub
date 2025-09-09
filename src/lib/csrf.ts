import { randomBytes } from 'node:crypto';

export function generateCsrfToken() {
    const token = randomBytes(16).toString('hex');
    return {
        token,
        cookie: `csrf_token=${token}; Path=/; HttpOnly; SameSite=Strict`
    };
}

export function verifyCsrf(headers: Record<string, any> | Headers, token?: string): boolean {
    const cookieHeader = headers instanceof Headers ? headers.get('cookie') : headers.cookie;
    if (!cookieHeader || !token) return false;
    const match = cookieHeader.match(/(?:^|;\s*)csrf_token=([^;]+)/);
    return !!match && match[1] === token;
}
