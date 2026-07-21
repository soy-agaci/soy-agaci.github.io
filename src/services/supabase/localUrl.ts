export function localSupabaseUrl(value: string, protocol: 'http:' | 'https:'): string {
    try {
        const url = new URL(value);
        const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
            || url.hostname.startsWith('192.168.') || url.hostname.startsWith('10.')
            || /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname);
        if (local && url.port === '54321') url.protocol = protocol;
        return url.href;
    } catch { return value; }
}
