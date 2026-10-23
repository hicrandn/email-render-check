import { describe, it, expect } from 'vitest';
import { fitScale, MIN_SCALE, PHONE_SCREEN } from '@/app/phone-frame';

describe('phone frame', () => {
  it('has a current iPhone screen', () => {
    expect(PHONE_SCREEN).toEqual({ width: 393, height: 852 });
  });

  it('is full size when the pane is big enough', () => {
    expect(fitScale(2000, 2000)).toBe(1);
  });

  it('shrinks to fit the pane height', () => {
    const s = fitScale(2000, 700);
    expect(s).toBeGreaterThan(MIN_SCALE);
    expect(s).toBeLessThan(1);
  });

  it('never shrinks below the readable minimum', () => {
    expect(fitScale(2000, 100)).toBe(MIN_SCALE);
    expect(fitScale(100, 2000)).toBe(MIN_SCALE);
  });
});
