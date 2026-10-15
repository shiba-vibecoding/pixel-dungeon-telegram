import { describe, expect, it } from 'vitest';
import { opaqueError } from '../src/diag';

describe('«Script error.» from another origin', () => {
  it('is opaque: no file, no line, no error object', () => {
    expect(opaqueError({ message: 'Script error.', filename: '', lineno: 0, error: null })).toBe(true);
    expect(opaqueError({ message: 'Script error', filename: '', lineno: 0, error: undefined })).toBe(true);
  });

  it('our own errors say where and what, and are kept', () => {
    expect(opaqueError({ message: 'Script error.', filename: 'https://x/a.js', lineno: 3, error: new Error('x') })).toBe(false);
    expect(opaqueError({ message: "Cannot read properties of null (reading 'world')", filename: '', lineno: 0, error: null })).toBe(false);
  });
});
