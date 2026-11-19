import { createContext, useContext } from 'react';

/** Cho trang setup báo SetupGate rằng thiết lập đã hoàn tất, tránh bị đẩy ngược về /setup. */
export const SetupGateContext = createContext<() => void>(() => {});

export function useMarkSetupDone(): () => void {
  return useContext(SetupGateContext);
}
