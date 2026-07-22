import { vi } from "vitest";

const mockChrome = {
  runtime: {
    getURL: vi.fn((path) => `chrome-extension://mock/${path}`),
    sendMessage: vi.fn(),
  },
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    },
  },
  offscreen: {
    createDocument: vi.fn(),
    hasDocument: vi.fn().mockResolvedValue(false),
  }
};

(global as any).chrome = mockChrome;
