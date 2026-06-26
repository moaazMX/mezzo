import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface RealtimeContextValue {
  isLive: boolean;
  setChannelStatus: (channelName: string, connected: boolean) => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [channels, setChannels] = useState<Record<string, boolean>>({});

  const setChannelStatus = useCallback((channelName: string, connected: boolean) => {
    setChannels((prev) => {
      if (prev[channelName] === connected) return prev;
      return { ...prev, [channelName]: connected };
    });
  }, []);

  const isLive = useMemo(() => Object.values(channels).some(Boolean), [channels]);

  const value = useMemo(
    () => ({ isLive, setChannelStatus }),
    [isLive, setChannelStatus]
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtimeStatus() {
  const ctx = useContext(RealtimeContext);
  return {
    isLive: ctx?.isLive ?? false,
    setChannelStatus: ctx?.setChannelStatus ?? (() => {}),
  };
}
