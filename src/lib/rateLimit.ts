const requests = new Map<string, { count: number; time: number }>();

function getIp(headers: Record<string, any> | Headers): string {
    if (headers instanceof Headers) {
        return headers.get('x-forwarded-for') || headers.get('x-real-ip') || 'unknown';
    }
    return headers['x-forwarded-for'] || headers['x-real-ip'] || 'unknown';
}

export function rateLimit(headers: Record<string, any> | Headers, limit = 10, windowMs = 60000): boolean {
    const ip = getIp(headers);
    const now = Date.now();
    const info = requests.get(ip);
    if (!info || now - info.time > windowMs) {
        requests.set(ip, { count: 1, time: now });
        return true;
    }
    info.count++;
    if (info.count > limit) {
        return false;
    }
    return true;
}
