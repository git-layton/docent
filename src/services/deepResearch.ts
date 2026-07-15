import { invoke } from '@tauri-apps/api/core';
import { runBrowserAgent } from './browserAgent';
import { useJobStore } from '../store/useJobStore';
import { useChatStore } from '../store/useChatStore';

export async function launchDeepResearch(topic: string, modelConfig: any, chatId: string | null) {
  const job = await useJobStore.getState().startJob(`Deep Research: ${topic}`);
  
  try {
    const result = await runBrowserAgent({
      task: `Deep research the following topic: ${topic}. Browse the web to find comprehensive information.`,
      startUrl: `https://duckduckgo.com/?q=${encodeURIComponent(topic)}`,
      modelConfig,
      maxSteps: 15,
      onProgress: (p) => {
        // Update the job with a log message
        invoke('update_job', { 
          id: job.id, 
          status: 'InProgress', 
          logMessage: `[Step ${p.step}/${p.maxSteps || '?'}] ${p.action} → ${p.url}` 
        }).catch(console.error);
      }
    });
    
    if (result.error) {
      await invoke('update_job', { id: job.id, status: 'PausedError', logMessage: `Error: ${result.error}` });
      return;
    }
    
    await invoke('update_job', { id: job.id, status: 'Completed', logMessage: 'Research completed successfully.' });
    
    // Post the result to the chat if there's an active chat
    if (chatId) {
      const message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `**Deep Research Results for "${topic}"**\n\n${result.answer}\n\n*Steps taken: ${result.steps}*\n*Sources:*\n${result.sources.map(s => `- [${s.title}](${s.url})`).join('\n')}`,
        createdAt: Date.now(),
        participantId: 'system',
      };
      
      const store = useChatStore.getState();
      store.setMessages((prev) => {
        const currentMessages = prev[chatId] || [];
        return {
          ...prev,
          [chatId]: [...currentMessages, message]
        };
      });
      await store.persist();
    }
    
  } catch (err: any) {
    await invoke('update_job', { id: job.id, status: 'PausedError', logMessage: `Fatal error: ${err?.message || String(err)}` });
  }
}
