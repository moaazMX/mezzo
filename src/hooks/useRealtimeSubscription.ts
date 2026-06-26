import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useRealtimeStatus } from '../contexts/RealtimeContext';

export type RealtimeChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE';

export type RealtimePayload = RealtimePostgresChangesPayload<Record<string, unknown>>;

export interface RealtimeTableCallbacks {
  onInsert?: (payload: RealtimePayload) => void;
  onUpdate?: (payload: RealtimePayload) => void;
  onDelete?: (payload: RealtimePayload) => void;
  /** Fires for every event when no specific handler exists for that event type. */
  onChange?: (payload: RealtimePayload, eventType: RealtimeChangeEvent) => void;
}

export interface RealtimeTableConfig extends RealtimeTableCallbacks {
  table: string;
  schema?: string;
  /** Postgres filter, e.g. `customer_id=eq.abc-123` */
  filter?: string;
}

export interface UseRealtimeSubscriptionOptions {
  channelName: string;
  subscriptions: RealtimeTableConfig[];
  enabled?: boolean;
  /** Refetch after reconnect (not on first subscribe). */
  onReconnect?: () => void;
}

const REALTIME_EVENTS: RealtimeChangeEvent[] = ['INSERT', 'UPDATE', 'DELETE'];

function dispatchPayload(config: RealtimeTableConfig, payload: RealtimePayload) {
  const eventType = payload.eventType as RealtimeChangeEvent;
  if (eventType === 'INSERT' && config.onInsert) {
    config.onInsert(payload);
    return;
  }
  if (eventType === 'UPDATE' && config.onUpdate) {
    config.onUpdate(payload);
    return;
  }
  if (eventType === 'DELETE' && config.onDelete) {
    config.onDelete(payload);
    return;
  }
  config.onChange?.(payload, eventType);
}

/**
 * Subscribe to one or more Postgres tables via Supabase Realtime.
 * Registers INSERT / UPDATE / DELETE listeners separately per table.
 */
export function useRealtimeSubscription({
  channelName,
  subscriptions,
  enabled = true,
  onReconnect,
}: UseRealtimeSubscriptionOptions): { isConnected: boolean } {
  const { setChannelStatus } = useRealtimeStatus();
  const [isConnected, setIsConnected] = useState(false);

  const subscriptionsRef = useRef(subscriptions);
  subscriptionsRef.current = subscriptions;

  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  const wasConnectedRef = useRef(false);
  const awaitingReconnectRef = useRef(false);

  useEffect(() => {
    if (!enabled || subscriptions.length === 0) {
      setIsConnected(false);
      setChannelStatus(channelName, false);
      return;
    }

    let channel: RealtimeChannel = supabase.channel(channelName);

    for (const sub of subscriptionsRef.current) {
      const schema = sub.schema ?? 'public';
      for (const event of REALTIME_EVENTS) {
        const config: {
          event: RealtimeChangeEvent;
          schema: string;
          table: string;
          filter?: string;
        } = {
          event,
          schema,
          table: sub.table,
        };
        if (sub.filter) config.filter = sub.filter;

        channel = channel.on(
          'postgres_changes',
          config,
          (payload: RealtimePayload) => {
            const current = subscriptionsRef.current.find((s) => s.table === sub.table);
            if (current) dispatchPayload(current, payload);
          }
        );
      }
    }

    channel.subscribe((status) => {
      const connected = status === 'SUBSCRIBED';
      setIsConnected(connected);
      setChannelStatus(channelName, connected);

      if (connected) {
        if (awaitingReconnectRef.current && wasConnectedRef.current) {
          onReconnectRef.current?.();
        }
        awaitingReconnectRef.current = false;
        wasConnectedRef.current = true;
        return;
      }

      if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        if (wasConnectedRef.current) {
          awaitingReconnectRef.current = true;
        }
        setChannelStatus(channelName, false);
      }
    });

    return () => {
      wasConnectedRef.current = false;
      awaitingReconnectRef.current = false;
      setIsConnected(false);
      setChannelStatus(channelName, false);
      void supabase.removeChannel(channel);
    };
  }, [channelName, enabled, setChannelStatus, subscriptions.length]);

  return { isConnected };
}

/** Single-table shorthand matching useRealtimeSubscription(table, filter, callbacks). */
export function useRealtimeTable(
  table: string,
  filter: string | undefined,
  callbacks: RealtimeTableCallbacks,
  options?: {
    channelName?: string;
    enabled?: boolean;
    onReconnect?: () => void;
  }
): { isConnected: boolean } {
  return useRealtimeSubscription({
    channelName: options?.channelName ?? `realtime-${table}`,
    enabled: options?.enabled,
    onReconnect: options?.onReconnect,
    subscriptions: [{ table, filter, ...callbacks }],
  });
}

/** Subscribe to multiple tables and refetch on any change (and on reconnect). */
export function useRealtimeRefetch(
  channelName: string,
  tables: string[],
  refetch: () => void,
  options?: {
    enabled?: boolean;
    onPayload?: (payload: RealtimePayload, table: string) => void;
  }
): { isConnected: boolean } {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  const onPayloadRef = useRef(options?.onPayload);
  onPayloadRef.current = options?.onPayload;

  const subscriptions: RealtimeTableConfig[] = tables.map((table) => ({
    table,
    onChange: (payload) => {
      onPayloadRef.current?.(payload, table);
      refetchRef.current();
    },
  }));

  return useRealtimeSubscription({
    channelName,
    subscriptions,
    enabled: options?.enabled,
    onReconnect: () => refetchRef.current(),
  });
}
