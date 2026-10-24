import { POLLING, type GetAnalysisResponse } from "../../contracts";
/** A UI deadline never recreates a task, including when a network request hangs. */
export function pollJob(
  get: () => Promise<GetAnalysisResponse>,
  onResult: (result: GetAnalysisResponse) => void,
  onError: (error: unknown) => void,
  onTimeout: () => void,
) {
  let stopped = false;
  let interval: ReturnType<typeof setTimeout> | undefined;
  const deadline = setTimeout(() => {
    stop();
    onTimeout();
  }, POLLING.uiTimeoutMs);
  function stop() {
    stopped = true;
    clearTimeout(interval);
    clearTimeout(deadline);
  }
  async function tick() {
    try {
      const result = await get();
      if (stopped) return;
      onResult(result);
      if (result.job.state === "succeeded" || result.job.state === "failed") {
        stop();
        return;
      }
      interval = setTimeout(() => void tick(), POLLING.intervalMs);
    } catch (error) {
      if (!stopped) {
        stop();
        onError(error);
      }
    }
  }
  interval = setTimeout(() => void tick(), POLLING.intervalMs);
  return stop;
}
