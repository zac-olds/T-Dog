import { describe, expect, it } from 'vitest';
import { validate } from './env.validation.js';

describe('validate', () => {
  it('accepts a config with just DATABASE_URL set', () => {
    const result = validate({ DATABASE_URL: 'postgres://localhost/db' });
    expect(result.DATABASE_URL).toBe('postgres://localhost/db');
  });

  it('coerces PORT to a number', () => {
    const result = validate({
      DATABASE_URL: 'postgres://localhost/db',
      PORT: '4000',
    });
    expect(result.PORT).toBe(4000);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => validate({})).toThrow();
  });
});
