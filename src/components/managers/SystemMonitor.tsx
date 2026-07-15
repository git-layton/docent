import React, { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useUIStore } from '../../store/useUIStore';

interface SystemMonitorProps {
  llamaServerPid: number | null;
  setLlamaServerPid: React.Dispatch<React.SetStateAction<number | null>>;
  llamaPaused: boolean;
  setLlamaPaused: React.Dispatch<React.SetStateAction<boolean>>;
  llamaCoolingDown: boolean;
  setLlamaCoolingDown: React.Dispatch<React.SetStateAction<boolean>>;
  anyGenerating: boolean;
  setGeneratingChats: React.Dispatch<React.SetStateAction<Set<string>>>;
  abortControllersRef: React.MutableRefObject<Map<string, AbortController>>;
}

export function SystemMonitor({
  llamaServerPid,
  setLlamaServerPid,
  llamaPaused,
  setLlamaPaused,
  llamaCoolingDown,
  setLlamaCoolingDown,
  anyGenerating,
  setGeneratingChats,
  abortControllersRef
}: SystemMonitorProps) {
  // RAM polling — every 2s (reaper only fires if a llama-server was actually spawned)
  useEffect(() => {
    const ramInterval = setInterval(async () => {
      try {
        const stats = await invoke<{ total_mb: number; used_mb: number; available_mb: number }>('get_ram_stats');
        useUIStore.getState().setRamStats(stats);

        // All reaper logic is gated on llamaServerPid being set
        setLlamaServerPid(pid => {
          if (pid === null) return pid;

          const hw = useUIStore.getState().hwProfile ?? { cooldown_mb: 1500, critical_mb: 800, recovery_mb: 2500 };

          setLlamaCoolingDown(prev => {
            if (stats.available_mb < hw.cooldown_mb && stats.available_mb >= hw.critical_mb && !prev && !llamaPaused) {
              useUIStore.getState().showToast('⚠️ RAM pressure — LLaMA will pause after this response');
              return true;
            }
            return prev;
          });

          setLlamaPaused(prev => {
            if (stats.available_mb < hw.critical_mb && !prev) {
              abortControllersRef.current.forEach(c => c.abort());
              abortControllersRef.current.clear();
              setGeneratingChats(new Set());
              setLlamaCoolingDown(false);
              invoke('sigstop_llama_server').catch(() => {});
              useUIStore.getState().showToast('🚨 LLaMA force-hibernated — RAM critical');
              return true;
            }
            if (stats.available_mb > hw.recovery_mb && prev) {
              invoke('sigcont_llama_server').catch(() => {});
              useUIStore.getState().showToast('✅ LLaMA resumed — RAM recovered');
              return false;
            }
            return prev;
          });

          return pid;
        });
      } catch (e) { /* Tauri not available in browser dev */ }
    }, 2000);

    return () => {
      clearInterval(ramInterval);
    };
  }, [setLlamaServerPid, setLlamaCoolingDown, setLlamaPaused, llamaPaused, abortControllersRef, setGeneratingChats]);

  // Soft-reaper: when cooling down and generation finishes naturally → apply SIGSTOP
  useEffect(() => {
    if (llamaServerPid !== null && llamaCoolingDown && !anyGenerating && !llamaPaused) {
      setLlamaCoolingDown(false);
      setLlamaPaused(true);
      invoke('sigstop_llama_server').catch(() => {});
      useUIStore.getState().showToast('🛑 LLaMA hibernated — RAM low');
    }
  }, [llamaServerPid, llamaCoolingDown, anyGenerating, llamaPaused, setLlamaCoolingDown, setLlamaPaused]);

  return null;
}
