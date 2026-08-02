// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  getActiveStorageEngine,
  getStorageEngineFlag,
  setActiveStorageEngine,
  setStorageEngineFlag,
} from '../offlineStorageEngine';

describe('offlineStorageEngine flag', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to indexeddb when the flag was never set', () => {
    expect(getStorageEngineFlag()).toBe('indexeddb');
  });

  it('defaults the active-engine marker to null before the first boot', () => {
    expect(getActiveStorageEngine()).toBeNull();
  });

  it('round-trips an explicit choice', () => {
    setStorageEngineFlag('localstorage');
    expect(getStorageEngineFlag()).toBe('localstorage');
    setActiveStorageEngine('localstorage');
    expect(getActiveStorageEngine()).toBe('localstorage');
  });
});
