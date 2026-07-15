import { requiredEnv } from './required-env';

describe('requiredEnv', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original };
  });

  afterAll(() => {
    process.env = original;
  });

  it('returns a trimmed configured value', () => {
    process.env.JWT_SECRET = '  configured-secret  ';
    expect(requiredEnv('JWT_SECRET')).toBe('configured-secret');
  });

  it.each([undefined, '', '   '])('rejects an absent or blank value', value => {
    if (value === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = value;
    expect(() => requiredEnv('JWT_SECRET')).toThrow(
      'Missing required environment variable: JWT_SECRET'
    );
  });
});
