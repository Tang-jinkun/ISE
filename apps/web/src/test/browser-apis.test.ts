import { describe, expect, it } from 'vitest';

describe('browser API test setup', () => {
  it('provides scrollIntoView for components that scroll after rendering', () => {
    expect(Element.prototype.scrollIntoView).toEqual(expect.any(Function));
  });
});
