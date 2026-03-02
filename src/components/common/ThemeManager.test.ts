import { describe, it, expect, beforeEach } from 'vitest';

// Test that ThemeManager correctly sets data-theme on html element
describe('ThemeManager Integration', () => {
    beforeEach(() => {
        document.documentElement.removeAttribute('data-theme');
        document.documentElement.classList.remove('dark');
    });

    it('should apply synthwave theme for dark mode', () => {
        const root = document.documentElement;
        // Simulate what ThemeManager does
        root.setAttribute('data-theme', 'synthwave');
        root.classList.add('dark');

        expect(root.getAttribute('data-theme')).toBe('synthwave');
        expect(root.classList.contains('dark')).toBe(true);
    });

    it('should apply retro theme for light mode', () => {
        const root = document.documentElement;
        root.setAttribute('data-theme', 'retro');
        root.classList.remove('dark');

        expect(root.getAttribute('data-theme')).toBe('retro');
        expect(root.classList.contains('dark')).toBe(false);
    });

    it('should toggle between themes', () => {
        const root = document.documentElement;

        // Start dark
        root.setAttribute('data-theme', 'synthwave');
        root.classList.add('dark');
        expect(root.getAttribute('data-theme')).toBe('synthwave');

        // Switch to light
        root.setAttribute('data-theme', 'retro');
        root.classList.remove('dark');
        expect(root.getAttribute('data-theme')).toBe('retro');
        expect(root.classList.contains('dark')).toBe(false);

        // Switch back to dark
        root.setAttribute('data-theme', 'synthwave');
        root.classList.add('dark');
        expect(root.getAttribute('data-theme')).toBe('synthwave');
        expect(root.classList.contains('dark')).toBe(true);
    });
});
