export function validateEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateDate(value: string): boolean {
    return !isNaN(Date.parse(value));
}

export function validateNumber(value: unknown): boolean {
    return typeof value === 'number' && Number.isFinite(value);
}

export function validateJSON(value: string): boolean {
    try {
        JSON.parse(value);
        return true;
    } catch {
        return false;
    }
}

export function validatePhone(phone: string): boolean {
    const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
    return phoneRegex.test(phone.replace(/[\s\-\(\)]/g, ''));
}

export function validateAge(age: number): boolean {
    return validateNumber(age) && age >= 14 && age <= 100;
}

export function validateString(value: string, minLength = 1, maxLength = 255): boolean {
    return typeof value === 'string' && value.length >= minLength && value.length <= maxLength;
}

export function validateUrl(url: string): boolean {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

export function sanitizeHtml(input: string): string {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
}
