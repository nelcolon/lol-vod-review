import { describe, expect, it } from 'vitest';
import { contentRange, parseRange } from './range';

describe('parseRange', () => {
  const size = 1000;
  it('returns full when there is no header', () => {
    expect(parseRange(null, size)).toEqual({ kind: 'full' });
    expect(parseRange(undefined, size)).toEqual({ kind: 'full' });
    expect(parseRange('', size)).toEqual({ kind: 'full' });
  });
  it('ignores non-bytes units and garbage', () => {
    expect(parseRange('items=0-10', size)).toEqual({ kind: 'full' });
    expect(parseRange('bytes=abc', size)).toEqual({ kind: 'full' });
    expect(parseRange('bytes=-', size)).toEqual({ kind: 'full' });
  });
  it('parses an explicit closed range', () => {
    expect(parseRange('bytes=0-499', size)).toEqual({ kind: 'partial', start: 0, end: 499 });
    expect(parseRange('bytes=500-999', size)).toEqual({ kind: 'partial', start: 500, end: 999 });
  });
  it('parses an open-ended range (what Chromium sends when seeking)', () => {
    expect(parseRange('bytes=250-', size)).toEqual({ kind: 'partial', start: 250, end: 999 });
    expect(parseRange('bytes=0-', size)).toEqual({ kind: 'partial', start: 0, end: 999 });
  });
  it('clamps an end past EOF', () => {
    expect(parseRange('bytes=900-5000', size)).toEqual({ kind: 'partial', start: 900, end: 999 });
  });
  it('parses a suffix range', () => {
    expect(parseRange('bytes=-100', size)).toEqual({ kind: 'partial', start: 900, end: 999 });
    expect(parseRange('bytes=-5000', size)).toEqual({ kind: 'partial', start: 0, end: 999 });
  });
  it('flags unsatisfiable ranges', () => {
    expect(parseRange('bytes=1000-', size)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRange('bytes=1500-1600', size)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRange('bytes=600-500', size)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRange('bytes=-0', size)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRange('bytes=0-10', 0)).toEqual({ kind: 'unsatisfiable' });
  });
  it('only honours the first of multiple ranges', () => {
    expect(parseRange('bytes=0-9, 20-29', size)).toEqual({ kind: 'partial', start: 0, end: 9 });
  });
  it('tolerates whitespace and case', () => {
    expect(parseRange(' Bytes = 10 - 20 ', size)).toEqual({ kind: 'partial', start: 10, end: 20 });
  });
  it('formats Content-Range', () => {
    expect(contentRange(0, 499, 1000)).toBe('bytes 0-499/1000');
  });
});
