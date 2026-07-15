import { describe, expect, it, vi } from 'vitest';

describe('select compatibility components', () => {
  it('declares forwardRef render functions with valid signatures', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      vi.resetModules();
      await import('./select');

      const messages = consoleError.mock.calls.flat().join(' ');
      expect(messages).not.toContain(
        'forwardRef render functions accept exactly two parameters'
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
