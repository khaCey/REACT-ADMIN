/** One in-flight import per process; expose only non-sensitive completion metadata. */
export function createCalendarPollRunner(sync, now = () => new Date().toISOString()) {
  let inFlight = null;
  const state = { running: false, lastStartedAt: null, lastSuccessAt: null, lastFailureAt: null, failed: false, version: 0 };
  return {
    status: () => ({ ...state }),
    run() {
      if (inFlight) return inFlight;
      state.running = true;
      state.lastStartedAt = now();
      inFlight = Promise.resolve().then(sync).then((result) => {
        if (result?.ok && !result.skipped) {
          state.lastSuccessAt = now();
          state.failed = false;
          state.version += 1;
        }
        return result;
      }).catch((error) => {
        state.lastFailureAt = now();
        state.failed = true;
        throw error;
      }).finally(() => {
        state.running = false;
        inFlight = null;
      });
      return inFlight;
    },
  };
}
