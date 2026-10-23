import type { SWRConfiguration } from "swr";
import { ApiError } from "./api";

/**
 * Options for the screens that refresh by themselves (phones, projector, panel).
 * After a failed request SWR stops its regular refresh and retries after 5 s,
 * 10 s, 20 s… up to two minutes, so one blip on the Wi-Fi would leave a screen
 * out of date for most of a round. Retry at the same pace instead, and stop only
 * when retrying cannot help (not found, login needed).
 */
export function live<T>(
  interval: number | ((data: T | undefined) => number),
  retryMs = typeof interval === "number" ? interval : 2000,
): SWRConfiguration {
  return {
    // A function picks the pace from the latest data (e.g. faster while a round is open).
    refreshInterval: interval as SWRConfiguration["refreshInterval"],
    onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
      if (error instanceof ApiError && (error.status === 404 || error.status === 401)) return;
      setTimeout(() => revalidate({ retryCount }), retryMs);
    },
  };
}
