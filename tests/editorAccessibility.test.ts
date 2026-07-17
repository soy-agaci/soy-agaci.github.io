import { beforeEach, describe, expect, it } from 'vitest';
import { closeEditorSidebar, openEditorSidebar } from '../src/ui/editor';

describe('editor sidebar accessibility', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <button id="invoker">Edit</button>
            <aside id="family-sidebar" aria-hidden="true" inert><input name="first_name"></aside>`;
    });

    it('makes the open dialog interactive and restores focus when closed', () => {
        const invoker = document.getElementById('invoker') as HTMLButtonElement;
        const sidebar = document.getElementById('family-sidebar') as HTMLElement;
        invoker.focus();

        openEditorSidebar(sidebar, invoker);
        expect(sidebar.hasAttribute('inert')).toBe(false);
        expect(sidebar.getAttribute('aria-hidden')).toBe('false');

        closeEditorSidebar();
        expect(sidebar.hasAttribute('inert')).toBe(true);
        expect(sidebar.getAttribute('aria-hidden')).toBe('true');
        expect(document.activeElement).toBe(invoker);
    });
});
