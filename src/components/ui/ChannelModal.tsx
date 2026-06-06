import React, { useState, useEffect } from 'react';
import { X, Hash, Check, Trash2 } from 'lucide-react';
import { useAgentStore } from '../../store/useAgentStore';
import { BOT_COLORS } from './AgentIcon';
import type { Channel } from '../../store/useChatStore';

interface ChannelModalProps {
  mode: 'create' | 'edit';
  channel?: Channel;
  onClose: () => void;
  onSave: (channel: Partial<Channel>) => void;
  onDelete?: () => void;
}

function sanitizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function ChannelModal({ mode, channel, onClose, onSave, onDelete }: ChannelModalProps) {
  const assistants = useAgentStore(s => s.assistants);

  const [name, setName] = useState(channel?.name ?? '');
  const [selectedIds, setSelectedIds] = useState<string[]>(channel?.enrolledAgentIds ?? []);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [nameError, setNameError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = sanitizeName(e.target.value);
    setName(sanitized);
    if (sanitized) setNameError('');
  };

  const toggleAgent = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleSave = () => {
    if (!name.trim()) { setNameError('Channel name is required'); return; }
    if (selectedIds.length === 0) { setNameError('Select at least one agent'); return; }
    onSave({ name, enrolledAgentIds: selectedIds });
  };

  const getAgentColor = (agent: any) => {
    return BOT_COLORS.find(c => c.id === agent?.avatar?.color)?.bg ?? 'bg-[#4A5D75]';
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-neutral-900 rounded-2xl p-6 max-w-md w-full mx-4 border border-neutral-800 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Hash className="w-4 h-4 text-[#4A5D75]" />
            <h2 className="text-sm font-black text-white uppercase tracking-wide">
              {mode === 'create' ? 'New Channel' : 'Edit Channel'}
            </h2>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mb-5">
          <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400 mb-2 block">
            Channel Name
          </label>
          <div className="flex items-center bg-neutral-800 rounded-xl border border-neutral-700 focus-within:border-[#4A5D75] transition-colors overflow-hidden">
            <span className="pl-3 pr-1 text-sm font-bold text-[#4A5D75] select-none">#</span>
            <input
              autoFocus
              value={name}
              onChange={handleNameChange}
              placeholder="channel-name"
              className="flex-1 bg-transparent px-2 py-3 text-sm text-white placeholder-neutral-600 outline-none font-medium"
            />
          </div>
          {nameError && <p className="text-[10px] text-[#C98A8A] mt-1.5 font-bold">{nameError}</p>}
        </div>

        <div className="mb-6">
          <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400 mb-2 block">
            Enrolled Agents
          </label>
          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {assistants.map((agent) => {
              const isSelected = selectedIds.includes(agent.id);
              const isPrimary = selectedIds[0] === agent.id;
              const colorBg = getAgentColor(agent);
              return (
                <button
                  key={agent.id}
                  onClick={() => toggleAgent(agent.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all text-left ${
                    isSelected
                      ? 'bg-[#4A5D75]/10 border-[#4A5D75]/40'
                      : 'bg-neutral-800/50 border-neutral-700/50 hover:border-neutral-600'
                  }`}
                >
                  <div className={`w-6 h-6 rounded-full ${colorBg} flex items-center justify-center shrink-0`}>
                    <span className="text-[9px] font-black text-white">{agent.name.charAt(0).toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-bold text-neutral-200 truncate block">{agent.name}</span>
                    {isPrimary && isSelected && (
                      <span className="text-[9px] text-[#7A9E8D] font-bold">Primary</span>
                    )}
                  </div>
                  {isSelected && (
                    <Check className="w-3.5 h-3.5 text-[#4A5D75] shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
          {selectedIds.length === 0 && (
            <p className="text-[10px] text-neutral-500 mt-2 font-medium">Select at least one agent. First selected becomes primary.</p>
          )}
        </div>

        <div className="flex gap-2">
          {mode === 'edit' && onDelete && (
            confirmDelete ? (
              <button
                onClick={onDelete}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-[#C98A8A]/20 border border-[#C98A8A]/40 text-[#C98A8A] text-[10px] font-black uppercase tracking-wide hover:bg-[#C98A8A]/30 transition-all"
              >
                <Trash2 className="w-3 h-3" />
                Confirm Delete
              </button>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-neutral-800 border border-neutral-700 text-neutral-400 text-[10px] font-black uppercase tracking-wide hover:border-[#C98A8A]/40 hover:text-[#C98A8A] transition-all"
              >
                <Trash2 className="w-3 h-3" />
                Delete
              </button>
            )
          )}
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-neutral-800 border border-neutral-700 text-neutral-400 text-[10px] font-black uppercase tracking-wide hover:text-neutral-200 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2.5 rounded-xl bg-[#4A5D75] hover:bg-[#5A6D85] text-white text-[10px] font-black uppercase tracking-wide transition-all active:scale-95"
          >
            {mode === 'create' ? 'Create Channel' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
