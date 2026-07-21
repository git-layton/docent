import { Globe, Database, CalendarDays, MessageSquare, Mail, FolderOpen, Layers, CalendarClock, Glasses } from 'lucide-react';
import { DocentMark } from './DocentMark';

export const AVAILABLE_TOOLS = [
  { id: 'web_search', name: 'Web Search', icon: Globe, desc: 'Allow agent to search the live internet.' },
  { id: 'local_workspace', name: 'Knowledge Base', icon: Database, desc: "Search your Knowledge Base — memos, notes, and saved files." },
  { id: 'calendar_sync', name: 'Local Planner', icon: CalendarDays, desc: 'Agent can add events & reminders to your local tasks.md planner.' },
  { id: 'slack', name: 'Slack', icon: MessageSquare, desc: 'Search messages and post to Slack channels.', requiresIntegration: 'slack' },
  { id: 'gmail', name: 'Gmail', icon: Mail, desc: 'Read and send email via Gmail.', requiresIntegration: 'googleWorkspace', requiresScope: 'gmail' },
  { id: 'google_drive', name: 'Google Drive', icon: FolderOpen, desc: 'Read and write Google Drive files, Docs, and Sheets.', requiresIntegration: 'googleWorkspace', requiresScope: 'drive' },
  { id: 'gus', name: 'GUS', icon: Layers, desc: 'Query work items, stories, and sprints in Salesforce Agile Accelerator.', requiresIntegration: 'gus' },
  { id: 'google_calendar', name: 'Google Calendar', icon: CalendarClock, desc: 'Read and create events across your connected Google calendars.', requiresIntegration: 'googleWorkspaces' },
];

export const BOT_COLORS = [
  { id: 'brand', bg: 'bg-[#2C3E50]', border: 'border-[#2C3E50]', text: 'text-[#9EADC8]' },
  { id: 'amber', bg: 'bg-[#D4AA7D]', border: 'border-[#D4AA7D]', text: 'text-[#D4AA7D]' },
  { id: 'rose', bg: 'bg-[#C98A8A]', border: 'border-[#C98A8A]', text: 'text-[#C98A8A]' },
  { id: 'sage', bg: 'bg-[#9FBBAF]', border: 'border-[#9FBBAF]', text: 'text-[#9FBBAF]' },
  { id: 'lavender', bg: 'bg-[#A89FBB]', border: 'border-[#A89FBB]', text: 'text-[#A89FBB]' },
  { id: 'sky', bg: 'bg-[#9EADC8]', border: 'border-[#9EADC8]', text: 'text-[#9EADC8]' },
  { id: 'mint', bg: 'bg-[#A9C8A1]', border: 'border-[#A9C8A1]', text: 'text-[#A9C8A1]' },
  { id: 'peach', bg: 'bg-[#D9A098]', border: 'border-[#D9A098]', text: 'text-[#D9A098]' },
  { id: 'slate', bg: 'bg-[#6A829E]', border: 'border-[#6A829E]', text: 'text-[#6A829E]' },
  { id: 'blush', bg: 'bg-[#E3B5A4]', border: 'border-[#E3B5A4]', text: 'text-[#E3B5A4]' },
  { id: 'sand', bg: 'bg-[#D4C3A3]', border: 'border-[#D4C3A3]', text: 'text-[#D4C3A3]' },
  { id: 'olive', bg: 'bg-[#899C85]', border: 'border-[#899C85]', text: 'text-[#899C85]' },
  { id: 'crimson', bg: 'bg-[#990000]', border: 'border-[#990000]', text: 'text-[#990000]' },
  { id: 'teal', bg: 'bg-[#008080]', border: 'border-[#008080]', text: 'text-[#008080]' },
  { id: 'indigo', bg: 'bg-[#4B0082]', border: 'border-[#4B0082]', text: 'text-[#4B0082]' },
  { id: 'gold', bg: 'bg-[#DAA520]', border: 'border-[#DAA520]', text: 'text-[#DAA520]' },
  { id: 'plum', bg: 'bg-[#DDA0DD]', border: 'border-[#DDA0DD]', text: 'text-[#DDA0DD]' },
];

export const AgentIcon = ({ agent, sizeClass = 'w-5 h-5', containerClass = 'p-2 rounded-xl shadow-md' }: any) => {
  if (agent?.id === 'docent' || agent?.name === 'Docent') {
    return (
      <div className={`${containerClass} bg-ink text-panel flex items-center justify-center shrink-0`}>
        <DocentMark className={sizeClass} />
      </div>
    );
  }
  if (agent?.avatar?.type === 'image' && agent?.avatar?.value) {
    return <img src={agent.avatar.value} alt={agent.name} className={`${containerClass} p-0 object-cover`} style={{ width: '2.25rem', height: '2.25rem' }} />;
  }
  const bg = BOT_COLORS.find(c => c.id === agent?.avatar?.color)?.bg ?? 'bg-accent';
  return <div className={`${containerClass} ${bg} flex items-center justify-center shrink-0`}><Glasses className={`${sizeClass} text-white dark:text-black`} /></div>;
};
