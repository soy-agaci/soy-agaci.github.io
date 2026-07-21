import { beforeEach, describe, expect, it } from 'vitest';
import { closeEditorSidebar, closeEditorSidebarOnMobile, openEditorSidebar } from '../src/ui/editor';

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

    it('closes only when the viewport is mobile', () => {
        const sidebar = document.getElementById('family-sidebar') as HTMLElement;
        const matchMedia = (matches: boolean) => Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: () => ({ matches }),
        });

        openEditorSidebar(sidebar);
        matchMedia(false);
        expect(closeEditorSidebarOnMobile()).toBe(false);
        expect(sidebar.classList.contains('active')).toBe(true);

        matchMedia(true);
        expect(closeEditorSidebarOnMobile()).toBe(true);
        expect(sidebar.classList.contains('active')).toBe(false);
    });
});
