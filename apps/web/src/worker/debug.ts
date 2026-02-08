interface DebugConfig {
  enabled: boolean;
  categories: Set<string>; // 'db', 'session', 'sync', 'crud', 'fetch', 'all'
}

const debugConfig: DebugConfig = {
  enabled: false,
  categories: new Set(['all']),
};

export function createDebugger() {
  return {
    get enabled() { return debugConfig.enabled; },

    log(category: string, message: string, ...args: unknown[]) {
      if (!debugConfig.enabled) return;
      if (!debugConfig.categories.has('all') && !debugConfig.categories.has(category)) return;
      console.log(`[SW:${category}]`, message, ...args);
    },

    setEnabled(enabled: boolean, categories?: string[]) {
      debugConfig.enabled = enabled;
      if (categories) {
        debugConfig.categories = new Set(categories);
      }
    },
  };
}

export type Debugger = ReturnType<typeof createDebugger>;
