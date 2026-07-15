import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export type JobStatus = 'InProgress' | 'Completed' | 'Interrupted' | 'PausedError' | 'Cancelled';

export interface Job {
  id: string;
  name: string;
  status: JobStatus;
  logs: string[];
  created_at: number;
}

interface JobStore {
  jobs: Job[];
  isActivityCenterOpen: boolean;
  
  fetchJobs: () => Promise<void>;
  startJob: (name: string) => Promise<Job>;
  cancelJob: (id: string) => Promise<void>;
  resumeJob: (id: string) => Promise<void>;
  dismissJob: (id: string) => Promise<void>;
  
  setActivityCenterOpen: (isOpen: boolean) => void;
  toggleActivityCenter: () => void;
}

export const useJobStore = create<JobStore>((set, get) => {
  let pollInterval: any = null;

  const startPolling = () => {
    if (pollInterval) return;
    pollInterval = setInterval(() => {
      get().fetchJobs();
    }, 2000);
  };

  startPolling();

  return {
    jobs: [],
    isActivityCenterOpen: false,

    fetchJobs: async () => {
      try {
        const jobs = await invoke<Job[]>('get_active_jobs');
        set({ jobs });
      } catch (e) {
        console.error('Failed to fetch jobs', e);
      }
    },

    startJob: async (name: string) => {
      try {
        const newJob = await invoke<Job>('start_job', { name });
        await get().fetchJobs();
        return newJob;
      } catch (e) {
        console.error('Failed to start job', e);
        throw e;
      }
    },

    cancelJob: async (id: string) => {
      try {
        await invoke('cancel_job', { id });
        await get().fetchJobs();
      } catch (e) {
        console.error('Failed to cancel job', e);
      }
    },

    resumeJob: async (id: string) => {
      try {
        // Technically this restarts or sets it to InProgress
        await invoke('update_job', { id, status: 'InProgress', log: 'Resumed by user' });
        await get().fetchJobs();
      } catch (e) {
        console.error('Failed to resume job', e);
      }
    },

    dismissJob: async (id: string) => {
      try {
        // Here we just mark it Cancelled or remove it. 
        await invoke('cancel_job', { id });
        await get().fetchJobs();
      } catch (e) {
        console.error('Failed to dismiss job', e);
      }
    },

    setActivityCenterOpen: (isOpen: boolean) => set({ isActivityCenterOpen: isOpen }),
    toggleActivityCenter: () => set((state) => ({ isActivityCenterOpen: !state.isActivityCenterOpen })),
  };
});
