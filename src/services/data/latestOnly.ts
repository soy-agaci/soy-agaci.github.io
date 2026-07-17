export class LatestOnly {
    private sequence = 0;

    async run<T>(load: () => Promise<T>, apply: (value: T) => void): Promise<boolean> {
        const current = ++this.sequence;
        let value: T;
        try {
            value = await load();
        } catch (error) {
            if (current !== this.sequence) return false;
            throw error;
        }
        if (current !== this.sequence) return false;
        apply(value);
        return true;
    }
}
