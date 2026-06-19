import { useState, useEffect, useRef } from 'react';
import {
  Settings, X, ImageIcon, ShieldCheck, Loader2, Wand2, Globe, Database, CalendarDays, Link, BookOpen,
  MessageSquare, MessageCircle, Mail, CheckCircle2, Layers, Plus, Trash2, Eye, Upload, ExternalLink,
  Sun, Moon, Monitor, Check, ListTodo, Volume2, StickyNote, Sparkles
} from 'lucide-react';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';
import { normalizeVoiceProfile } from '../services/voice';
import { buildVoiceCard, buildRelationshipVoiceCard } from '../services/voiceRuntime';
import { VoiceSetupModal } from './VoiceSetupModal';
import { getLoadedVoices, suggestDefaultVoiceURI } from '../lib/voice';
import { ACCENT_OPTIONS } from '../lib/theme';
import { useMemoryStore } from '../store/useMemoryStore';
import { useAgentStore } from '../store/useAgentStore';
import { listPlaybooks, reinforcePlaybook, type Playbook } from '../services/appliedMemory';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { db } from '../services/database';
import { migrateLocalCalendarToEventkit, localCalendarMigrationCount, migrateLocalTasksToEventkit, localTasksMigrationCount } from '../services/connectors/migrate';
import { getCalendar, getTasks, getNotes } from '../services/connectors';
import { AGENT_FORGE_GUIDE, AGENT_FORGE_GUIDE_RELATIVE_PATH } from '../data/agentForgeUserDocs';
import { describeImage, resolveVisionRoute } from '../services/llm';

// 1×1 PNG used purely to round-trip the vision provider on "Test" (proves the key/endpoint works).
const VISION_TEST_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

interface ProfileSettingsModalProps {
  fetchImageModels: () => void;
  testImageEngine: () => void;
  viewImageInCanvas: (src: string) => void;
}

export function ProfileSettingsModal({ fetchImageModels, testImageEngine, viewImageInCanvas }: ProfileSettingsModalProps) {
  const userName = useSettingsStore(s => s.userName);
  const userProfile = useSettingsStore(s => s.userProfile);
  const userAvatar = useSettingsStore(s => s.userAvatar);
  const integrations = useSettingsStore(s => s.integrations);
  const appSettings = useSettingsStore(s => s.appSettings);
  const profileSettingsTab = useSettingsStore(s => s.profileSettingsTab);
  const imageTestState = useSettingsStore(s => s.imageTestState);
  const imageEngineModels = useSettingsStore(s => s.imageEngineModels);
  const isFetchingImageModels = useSettingsStore(s => s.isFetchingImageModels);
  const visionTestState = useSettingsStore(s => s.visionTestState);
  const models = useSettingsStore(s => s.models);
  const theme = useSettingsStore(s => s.theme);
  const accentColor = useSettingsStore(s => s.accentColor);
  const { setUserName, setUserProfile, setUserAvatar, setIntegrations, setAppSettings, setProfileSettingsTab,
    setImageTestState, setImageEngineModels, setVisionTestState, setShowProfileSettings, setTheme, setAccentColor } = useSettingsStore.getState();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const displayName = userName?.trim() || userProfile?.split('\n')[0]?.trim().replace(/^[#\s]+/, '').trim() || 'You';

  // ── "Write Like Me" — personal writing voice ──
  const [voiceBusy, setVoiceBusy] = useState(false);
  const voice = normalizeVoiceProfile(appSettings?.voiceProfile);
  const setVoice = (patch: any) => {
    setAppSettings((prev: any) => ({ ...prev, voiceProfile: { ...normalizeVoiceProfile(prev?.voiceProfile), ...patch } }));
    void useSettingsStore.getState().persist();
  };
  const rebuildVoice = async () => {
    if (voiceBusy) return;
    if (models.length === 0) { useUIStore.getState().showToast('Connect a model first to learn your voice.'); return; }
    setVoiceBusy(true);
    try {
      const { card, sampleCounts } = await buildVoiceCard();
      setAppSettings((prev: any) => ({ ...prev, voiceProfile: { ...normalizeVoiceProfile(prev?.voiceProfile), enabled: true, card, sampleCounts, lastBuiltAt: Date.now() } }));
      await useSettingsStore.getState().persist();
      useUIStore.getState().showToast('✍️ Learned your writing voice.');
    } catch (e: any) {
      useUIStore.getState().showToast(e?.message ?? 'Could not learn your voice.');
    } finally {
      setVoiceBusy(false);
    }
  };

  // ── Per-relationship voices (the byRecipient map) — manage what was learned per person ──
  const setRecipientVoice = (relKey: string, patch: any) => {
    setAppSettings((prev: any) => {
      const cur = normalizeVoiceProfile(prev?.voiceProfile);
      const existing = cur.byRecipient?.[relKey];
      if (!existing) return prev;
      return { ...prev, voiceProfile: { ...cur, byRecipient: { ...cur.byRecipient, [relKey]: { ...existing, ...patch } } } };
    });
    void useSettingsStore.getState().persist();
  };
  const removeRecipientVoice = (relKey: string) => {
    setAppSettings((prev: any) => {
      const cur = normalizeVoiceProfile(prev?.voiceProfile);
      if (!cur.byRecipient?.[relKey]) return prev;
      const next = { ...cur.byRecipient };
      delete next[relKey];
      return { ...prev, voiceProfile: { ...cur, byRecipient: next } };
    });
    void useSettingsStore.getState().persist();
  };
  const rebuildRecipientVoice = async (relKey: string, recipientName?: string) => {
    if (voiceBusy) return;
    if (!relKey.startsWith('im:')) { useUIStore.getState().showToast('Rebuilding from messages is available for iMessage contacts.'); return; }
    if (models.length === 0) { useUIStore.getState().showToast('Connect a model first to rebuild a voice.'); return; }
    setVoiceBusy(true);
    try {
      const { card, sampleCounts } = await buildRelationshipVoiceCard(relKey.slice(3), recipientName);
      setRecipientVoice(relKey, { card, sampleCounts, source: 'auto', lastBuiltAt: Date.now() });
      useUIStore.getState().showToast(`✍️ Refreshed ${recipientName || 'their'} voice.`);
    } catch (e: any) {
      useUIStore.getState().showToast(e?.message ?? 'Could not rebuild that voice.');
    } finally {
      setVoiceBusy(false);
    }
  };

  // ── Playbooks (saved procedures) — view, trust/untrust, remove ──
  const playbookAgentId = useAgentStore(s => s.activeFolderId ?? s.assistants[0]?.id ?? null);
  const [playbooks, setPlaybooks] = useState<Array<Playbook & { path: string }>>([]);
  const loadPlaybooks = async () => { setPlaybooks(playbookAgentId ? await listPlaybooks(playbookAgentId) : []); };
  useEffect(() => { void loadPlaybooks(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [playbookAgentId]);
  const togglePlaybookTrust = async (pb: Playbook & { path: string }) => {
    if (!agentForgePath || !playbookAgentId) return;
    await reinforcePlaybook(agentForgePath, playbookAgentId, pb.trigger, { verify: !pb.verified });
    await loadPlaybooks();
  };
  const removePlaybook = async (pb: Playbook & { path: string }) => {
    try { await invoke('archive_memory_file', { path: pb.path }); }
    catch { useUIStore.getState().showToast('Could not remove that playbook.'); return; }
    await loadPlaybooks();
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const result = ev.target?.result as string;
      if (result) setUserAvatar(result);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const agentForgePath = useMemoryStore(s => s.agentForgePath);

  const [guideStatus, setGuideStatus] = useState<'installed' | 'deleted' | 'checking'>('checking');
  const [showVoiceSetup, setShowVoiceSetup] = useState(false);

  // Label for the current default voice — the chosen one, or the auto-recommended pick.
  const ttsVoiceLabel = (() => {
    const list = getLoadedVoices();
    if (appSettings.ttsVoiceURI) {
      return list.find(v => v.voiceURI === appSettings.ttsVoiceURI)?.name ?? 'Selected voice';
    }
    const rec = suggestDefaultVoiceURI(list);
    const v = rec ? list.find(x => x.voiceURI === rec) : undefined;
    return v ? `Auto — ${v.name}` : 'Auto (recommended)';
  })();

  // Mail (IMAP) connection probe — app-password login, no OAuth/web-login. Verifies we can read
  // the mailbox before we build the native inbox on top of it.
  const [mailProvider, setMailProvider] = useState<'gmail' | 'icloud'>('gmail');
  const [mailEmail, setMailEmail] = useState('');
  const [mailPassword, setMailPassword] = useState('');
  const [mailStatus, setMailStatus] = useState<{ state: 'idle' | 'testing' | 'ok' | 'error'; msg?: string }>({ state: 'idle' });
  const [addingMail, setAddingMail] = useState(false);

  // Connected mail accounts: metadata only (no secret) — passwords live in the Keychain.
  const mailAccounts: Array<{ id: string; provider: 'gmail' | 'icloud'; email: string }> = (integrations as any).mailAccounts ?? [];

  const handleMailConnect = async () => {
    const email = mailEmail.trim();
    // Gmail shows the app password as 4 space-separated groups; IMAP wants it joined.
    const password = mailPassword.replace(/\s+/g, '');
    if (!email || !password) return;
    setMailStatus({ state: 'testing' });
    try {
      const count = await invoke<number>('mail_test_connection', { provider: mailProvider, email, password });
      // Password → macOS Keychain (encrypted, local). Account metadata → settings (no secret there).
      await invoke('keychain_save', { host: `mail:${email}`, username: email, password });
      setIntegrations((prev: any) => {
        const rest = (prev.mailAccounts ?? []).filter((a: any) => a.email !== email);
        return { ...prev, mailAccounts: [...rest, { id: `mail-${Date.now()}`, provider: mailProvider, email }] };
      });
      // Persist immediately so the account survives a reload (don't rely only on the autosave subscribe).
      await useSettingsStore.getState().persist();
      setMailStatus({ state: 'ok', msg: `Connected — ${count.toLocaleString()} messages` });
      setMailEmail('');
      setMailPassword('');
      setAddingMail(false);
    } catch (e) {
      setMailStatus({ state: 'error', msg: String(e) });
    }
  };

  const handleMailRemove = async (email: string) => {
    await invoke('keychain_delete', { host: `mail:${email}` }).catch(() => {});
    setIntegrations((prev: any) => ({ ...prev, mailAccounts: (prev.mailAccounts ?? []).filter((a: any) => a.email !== email) }));
    await useSettingsStore.getState().persist();
  };

  // iMessage — there are no credentials; it reads the local Messages database, which needs Full Disk
  // Access. "Connecting" = probing that we can open chat.db. We flip `imessage.enabled` once verified.
  const [imsgStatus, setImsgStatus] = useState<{ state: 'idle' | 'checking' | 'ok' | 'error'; msg?: string }>({ state: 'idle' });
  const imessageEnabled = !!(integrations as any).imessage?.enabled;

  const handleImessageCheck = async () => {
    setImsgStatus({ state: 'checking' });
    try {
      const count = await invoke<number>('imessage_check_access');
      setIntegrations((prev: any) => ({ ...prev, imessage: { enabled: true } }));
      await useSettingsStore.getState().persist();
      setImsgStatus({ state: 'ok', msg: `Connected — ${count.toLocaleString()} conversations` });
    } catch (e) {
      setIntegrations((prev: any) => ({ ...prev, imessage: { enabled: false } }));
      setImsgStatus({ state: 'error', msg: String(e) });
    }
  };

  // Calendar — choose where events live (local store vs the native macOS calendar via EventKit),
  // grant access, pick which calendars to show, and migrate existing local birthdays/events over.
  const calendarBackend: string = (integrations as any).calendar?.backend ?? 'local';
  const selectedCalendarIds: string[] = (integrations as any).calendar?.selectedCalendarIds ?? [];
  const calendarMigrated = !!(integrations as any).calendar?.migratedToEventkit;
  const [calCals, setCalCals] = useState<Array<{ id: string; title: string; account: string }>>([]);
  const [calStatus, setCalStatus] = useState<{ state: 'idle' | 'working' | 'ok' | 'error'; msg?: string }>({ state: 'idle' });
  const [calAuth, setCalAuth] = useState<string>('notDetermined'); // TCC status — drives the "Connected" badge

  const setCalendarBackend = async (backend: string) => {
    setIntegrations((prev: any) => ({ ...prev, calendar: { ...(prev.calendar ?? {}), backend } }));
    await useSettingsStore.getState().persist();
  };

  const grantCalendarAccess = async () => {
    setCalStatus({ state: 'working', msg: 'Requesting access…' });
    try {
      const granted = await invoke<boolean>('eventkit_request_access', { kind: 'event' });
      if (!granted) { setCalAuth('denied'); setCalStatus({ state: 'error', msg: 'Calendar access was denied' }); return; }
      const cals = await invoke<Array<{ id: string; title: string; account: string }>>('eventkit_list_calendars', { kind: 'event' });
      setCalCals(cals);
      setCalAuth('authorized');
      setCalStatus({ state: 'ok', msg: `Connected — ${cals.length} calendar${cals.length === 1 ? '' : 's'} found` });
    } catch (e) { setCalStatus({ state: 'error', msg: String(e) }); }
  };

  // Probe the live TCC status whenever the native backend is active, so the "Connected" badge is
  // accurate without the user having to click Grant first.
  useEffect(() => {
    if (calendarBackend !== 'eventkit') return;
    invoke<string>('eventkit_authorization_status', { kind: 'event' }).then(setCalAuth).catch(() => {});
  }, [calendarBackend]);

  // Re-read from the native store to prove writes actually landed (the closest in-app confirmation
  // of the iCloud round-trip we can give).
  const verifyCalendarSync = async () => {
    setCalStatus({ state: 'working', msg: 'Verifying…' });
    try {
      const y = new Date().getFullYear();
      const evs = await getCalendar().listEvents(`${y}-01-01`, `${y}-12-31`);
      setCalStatus({ state: 'ok', msg: `Verified — ${evs.length} event${evs.length === 1 ? '' : 's'} in your Mac calendar this year` });
    } catch (e) { setCalStatus({ state: 'error', msg: String(e) }); }
  };

  // To-Dos — same pattern as Calendar, backed by the native Reminders app via EventKit.
  const tasksBackend: string = (integrations as any).tasks?.backend ?? 'local';
  const tasksMigrated = !!(integrations as any).tasks?.migratedToEventkit;
  const [taskLists, setTaskLists] = useState<Array<{ id: string; title: string; account: string }>>([]);
  const [taskAuth, setTaskAuth] = useState<string>('notDetermined');
  const [taskStatus, setTaskStatus] = useState<{ state: 'idle' | 'working' | 'ok' | 'error'; msg?: string }>({ state: 'idle' });

  const setTasksBackend = async (backend: string) => {
    setIntegrations((prev: any) => ({ ...prev, tasks: { ...(prev.tasks ?? {}), backend } }));
    await useSettingsStore.getState().persist();
  };

  const grantRemindersAccess = async () => {
    setTaskStatus({ state: 'working', msg: 'Requesting access…' });
    try {
      const granted = await invoke<boolean>('eventkit_request_access', { kind: 'reminder' });
      if (!granted) { setTaskAuth('denied'); setTaskStatus({ state: 'error', msg: 'Reminders access was denied' }); return; }
      const lists = await invoke<Array<{ id: string; title: string; account: string }>>('eventkit_list_calendars', { kind: 'reminder' });
      setTaskLists(lists);
      setTaskAuth('authorized');
      setTaskStatus({ state: 'ok', msg: `Connected — ${lists.length} list${lists.length === 1 ? '' : 's'} found` });
    } catch (e) { setTaskStatus({ state: 'error', msg: String(e) }); }
  };

  useEffect(() => {
    if (tasksBackend !== 'eventkit') return;
    invoke<string>('eventkit_authorization_status', { kind: 'reminder' }).then(setTaskAuth).catch(() => {});
  }, [tasksBackend]);

  const runTasksMigration = async () => {
    const count = localTasksMigrationCount();
    if (count === 0) { setTaskStatus({ state: 'error', msg: 'No open tasks to migrate' }); return; }
    if (!window.confirm(`Copy ${count} open task${count === 1 ? '' : 's'} into Reminders? Your local copy is kept.`)) return;
    setTaskStatus({ state: 'working', msg: 'Migrating…' });
    try {
      const n = await migrateLocalTasksToEventkit();
      setIntegrations((prev: any) => ({ ...prev, tasks: { ...(prev.tasks ?? {}), migratedToEventkit: true } }));
      await useSettingsStore.getState().persist();
      setTaskStatus({ state: 'ok', msg: `Migrated ${n} task${n === 1 ? '' : 's'} to Reminders — syncing to your devices` });
    } catch (e) { setTaskStatus({ state: 'error', msg: String(e) }); }
  };

  const verifyRemindersSync = async () => {
    setTaskStatus({ state: 'working', msg: 'Verifying…' });
    try {
      const ts = await getTasks().listTasks();
      setTaskStatus({ state: 'ok', msg: `Verified — ${ts.length} reminder${ts.length === 1 ? '' : 's'} in Reminders` });
    } catch (e) { setTaskStatus({ state: 'error', msg: String(e) }); }
  };

  // Notes — local store vs the native Apple Notes app (AppleScript). Connecting/verifying lists
  // folders, which triggers the one-time Automation prompt.
  const notesBackend: string = (integrations as any).notes?.backend ?? 'local';
  const [notesStatus, setNotesStatus] = useState<{ state: 'idle' | 'working' | 'ok' | 'error'; msg?: string }>({ state: 'idle' });

  const setNotesBackend = async (backend: string) => {
    setIntegrations((prev: any) => ({ ...prev, notes: { ...(prev.notes ?? {}), backend } }));
    await useSettingsStore.getState().persist();
  };

  const verifyNotes = async () => {
    setNotesStatus({ state: 'working', msg: 'Connecting…' });
    try {
      const folders = await getNotes().listFolders();
      setNotesStatus({ state: 'ok', msg: `Connected — ${folders.length} folder${folders.length === 1 ? '' : 's'} in Notes` });
    } catch (e) { setNotesStatus({ state: 'error', msg: String(e) }); }
  };

  const toggleCalendarSelected = async (id: string) => {
    setIntegrations((prev: any) => {
      const cur: string[] = prev.calendar?.selectedCalendarIds ?? [];
      const next = cur.includes(id) ? cur.filter((x: string) => x !== id) : [...cur, id];
      return { ...prev, calendar: { ...(prev.calendar ?? {}), selectedCalendarIds: next } };
    });
    await useSettingsStore.getState().persist();
  };

  const runCalendarMigration = async () => {
    const count = localCalendarMigrationCount();
    if (count === 0) { setCalStatus({ state: 'error', msg: 'No local events to migrate' }); return; }
    if (!window.confirm(`Copy ${count} local birthday/event${count === 1 ? '' : 's'} into your Mac calendar? Your local copy is kept.`)) return;
    setCalStatus({ state: 'working', msg: 'Migrating…' });
    try {
      const n = await migrateLocalCalendarToEventkit();
      setIntegrations((prev: any) => ({ ...prev, calendar: { ...(prev.calendar ?? {}), migratedToEventkit: true } }));
      await useSettingsStore.getState().persist();
      setCalStatus({ state: 'ok', msg: `Migrated ${n} event${n === 1 ? '' : 's'} to your Mac calendar — syncing to your devices` });
    } catch (e) { setCalStatus({ state: 'error', msg: String(e) }); }
  };

  useEffect(() => {
    db.get('userDocsInstalled', false).then(v => setGuideStatus(v ? 'installed' : 'deleted'));
  }, []);

  const handleRestoreGuide = async () => {
    if (!agentForgePath) return;
    try {
      await invoke('write_memory', {
        path: `${agentForgePath}/${AGENT_FORGE_GUIDE_RELATIVE_PATH}`,
        content: AGENT_FORGE_GUIDE,
        commitMessage: 'Restore Agent Forge user guide',
        agentId: null,
        contextTokens: null,
        ramState: null,
      });
      await db.set('userDocsInstalled', true);
      setGuideStatus('installed');
    } catch (e) {
      console.error('[AgentForge] Failed to restore user guide:', e);
    }
  };

  const handleDeleteGuide = async () => {
    if (!agentForgePath) return;
    try {
      await invoke('delete_memory_file', {
        path: `${agentForgePath}/${AGENT_FORGE_GUIDE_RELATIVE_PATH}`,
      });
      await db.set('userDocsInstalled', false);
      setGuideStatus('deleted');
    } catch (e) {
      console.error('[AgentForge] Failed to delete user guide:', e);
    }
  };

  const hasImplicitGoogleKey = models.some((m: any) => m.provider === 'google' && m.apiKey);
  const hasImplicitOpenAIKey = models.some((m: any) => m.provider === 'openai' && m.apiKey);
  const hasImplicitAnthropicKey = models.some((m: any) => m.provider === 'anthropic' && m.apiKey);
  const activeImageKey = appSettings.imageProvider === 'openai'
    ? (integrations.openai?.apiKey || models.find((m: any) => m.provider === 'openai' && m.apiKey)?.apiKey)
    : appSettings.imageProvider === 'google'
    ? (integrations.google?.apiKey || models.find((m: any) => m.provider === 'google' && m.apiKey)?.apiKey)
    : integrations.customImage?.apiKey || '';

  // Whether the current Image Understanding setting resolves to a usable backend (for Test/status).
  const visionRouteReady = !!resolveVisionRoute(appSettings, integrations, models);
  // Round-trip the configured vision provider on a tiny image to confirm the key/endpoint works.
  const runVisionTest = async () => {
    setVisionTestState({ loading: true, error: null, successUrl: null });
    try {
      const route = resolveVisionRoute(appSettings, integrations, models);
      if (!route) throw new Error('No vision provider available — pick one and add a key, or set an endpoint.');
      const desc = await describeImage(VISION_TEST_IMAGE, 'image/png', route);
      setVisionTestState({ loading: false, error: null, successUrl: desc || '(empty response)' });
    } catch (e: any) {
      setVisionTestState({ loading: false, error: String(e?.message || e), successUrl: null });
    }
  };

  const onClose = () => { setShowProfileSettings(false); setImageTestState({ loading: false, error: null, successUrl: null }); setVisionTestState({ loading: false, error: null, successUrl: null }); };
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in">
      <div className="bg-panel w-full max-w-2xl rounded-[2rem] p-8 shadow-2xl border border-edge text-ink flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center mb-6 shrink-0">
          <div className="flex items-center gap-3"><div className="p-2 bg-accent rounded-xl"><Settings className="w-6 h-6 text-on-accent" /></div><h3 className="text-xl font-black tracking-tighter uppercase">System Settings</h3></div>
          <button onClick={onClose} className="p-2 hover:bg-wash rounded-full"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex gap-1 border-b border-edge mb-6 shrink-0">
          {['profile', 'appearance', 'integrations', 'advanced'].map(tab => <button key={tab} onClick={() => setProfileSettingsTab(tab)} className={`pb-3 px-4 text-xs font-black uppercase tracking-widest transition-all ${profileSettingsTab === tab ? 'text-primary border-b-2 border-primary' : 'text-ink-3'}`}>{tab === 'profile' ? 'My Profile' : tab === 'appearance' ? 'Appearance' : tab === 'integrations' ? 'Integrations' : 'Advanced'}</button>)}
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
          {profileSettingsTab === 'profile' ? (
            <div>
              {/* Avatar */}
              <div className="mb-6 flex items-center gap-5">
                <div className="relative shrink-0">
                  {userAvatar ? (
                    <img src={userAvatar} alt="Avatar" className="w-20 h-20 rounded-2xl object-cover border-2 border-edge-2 shadow-md" />
                  ) : (
                    <div className="w-20 h-20 rounded-2xl bg-[#9EADC8] flex items-center justify-center shadow-md">
                      <span className="text-3xl font-black text-white uppercase select-none">
                        {displayName.charAt(0) || '?'}
                      </span>
                    </div>
                  )}
                  {userAvatar && (
                    <button
                      onClick={() => setUserAvatar('')}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-rose-500 hover:bg-rose-600 rounded-full flex items-center justify-center shadow transition-colors"
                      title="Remove photo"
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-bold text-ink-2">Profile Photo</p>
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-2 bg-wash hover:bg-inset rounded-xl text-xs font-bold transition-all"
                  >
                    <Upload className="w-3.5 h-3.5" /> Upload Photo
                  </button>
                  {userAvatar && (
                    <button onClick={() => setUserAvatar('')} className="text-xs text-rose-400 hover:text-rose-500 transition-colors text-left">Remove</button>
                  )}
                </div>
              </div>

              <div className="mb-5">
                <label className="text-tiny font-black uppercase tracking-widest text-primary dark:text-secondary-light mb-2 block">Your Name <span className="text-error">*</span></label>
                <input
                  type="text"
                  value={userName}
                  onChange={e => setUserName(e.target.value)}
                  placeholder="What should we call you?"
                  className="w-full bg-inset border-2 border-edge-2 rounded-2xl px-5 py-3 text-sm font-medium outline-none focus:border-secondary "
                />
                <p className="text-tiny text-ink-3 mt-1.5 font-medium">All agents will address you by this name.</p>
              </div>
              <label className="text-tiny font-black uppercase opacity-50 mb-2 block tracking-widest">About Me (Global Context)</label>
              <textarea value={userProfile} onChange={e => setUserProfile(e.target.value)} rows={8} className="w-full bg-inset border-2 border-edge-2 rounded-2xl px-5 py-4 text-sm font-medium resize-none outline-none focus:border-secondary " placeholder="" />

              {/* Automated Profile Update Toggle */}
              <div className="mt-6 flex items-center justify-between p-4 rounded-2xl border border-edge bg-inset ">
                 <div className="flex flex-col">
                    <span className="text-sm font-bold block">Allow Profile Updates</span>
                    <span className="text-tiny text-ink-3 font-medium tracking-wide">AI can autonomously propose updates to your profile from chat conversations.</span>
                 </div>
                 <button onClick={() => setAppSettings((prev: any) => ({ ...prev, allowProfileUpdates: !prev.allowProfileUpdates }))} className={`w-10 h-5 rounded-full transition-all relative shrink-0 ${appSettings.allowProfileUpdates ? 'bg-primary' : 'bg-inset '}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${appSettings.allowProfileUpdates ? 'right-0.5' : 'left-0.5'}`} />
                 </button>
              </div>

              {/* Write Like Me — personal writing voice */}
              <div className="mt-4 rounded-2xl border border-edge bg-inset p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Sparkles className="w-4 h-4 text-accent shrink-0" />
                    <div>
                      <span className="text-sm font-bold block">Write Like Me</span>
                      <span className="text-tiny text-ink-3 font-medium tracking-wide">Agents draft messages, emails & replies in your own voice — learned from your sent texts & mail.</span>
                    </div>
                  </div>
                  <button onClick={() => setVoice({ enabled: !voice.enabled })} className={`w-10 h-5 rounded-full transition-all relative shrink-0 ${voice.enabled ? 'bg-primary' : 'bg-inset '}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${voice.enabled ? 'right-0.5' : 'left-0.5'}`} />
                  </button>
                </div>

                {voice.enabled && (
                  <div className="mt-4 space-y-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <button onClick={rebuildVoice} disabled={voiceBusy} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent text-on-accent text-xs font-black uppercase tracking-widest hover:bg-accent-strong transition-all disabled:opacity-50">
                        {voiceBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                        {voice.card ? 'Rebuild from my messages' : 'Learn my voice'}
                      </button>
                      {voice.lastBuiltAt && (
                        <span className="text-tiny text-ink-3 font-medium">
                          {(voice.sampleCounts?.imessage ?? 0) + (voice.sampleCounts?.email ?? 0)} samples · updated {new Date(voice.lastBuiltAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>

                    <div>
                      <label className="text-tiny font-black uppercase opacity-50 mb-1.5 block tracking-widest">Your Voice Profile</label>
                      <textarea
                        value={voice.card}
                        onChange={e => setVoice({ card: e.target.value })}
                        rows={6}
                        placeholder="Tap “Learn my voice” to build this automatically from your sent messages — or describe your style here yourself."
                        className="w-full bg-panel border-2 border-edge-2 rounded-2xl px-4 py-3 text-xs font-medium resize-none outline-none focus:border-secondary leading-relaxed"
                      />
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-tiny font-black uppercase opacity-50 tracking-widest mr-1">Use in</span>
                      {(['chat', 'imessage', 'email'] as const).map(key => {
                        const label = key === 'chat' ? 'Agent chat' : key === 'imessage' ? 'Messages' : 'Email';
                        const on = voice.perSurface[key];
                        return (
                          <button key={key} onClick={() => setVoice({ perSurface: { ...voice.perSurface, [key]: !on } })} className={`px-3 py-1.5 rounded-full text-tiny font-bold transition-all ${on ? 'bg-accent text-on-accent' : 'bg-inset text-ink-3 hover:text-ink'}`}>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    {Object.keys(voice.byRecipient ?? {}).length > 0 && (
                      <div>
                        <label className="text-tiny font-black uppercase opacity-50 mb-1.5 block tracking-widest">Voices by person</label>
                        <div className="space-y-2">
                          {Object.entries(voice.byRecipient ?? {}).map(([relKey, rv]) => (
                            <div key={relKey} className="rounded-xl border border-edge-2 bg-panel px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold truncate flex-1">{rv.recipientName || relKey.replace(/^(im|mail):/, '')}</span>
                                <span className="text-tiny text-ink-3 shrink-0">
                                  {relKey.startsWith('mail:') ? 'Email' : 'Messages'}{rv.lastBuiltAt ? ` · ${new Date(rv.lastBuiltAt).toLocaleDateString()}` : ''}
                                </span>
                                <button
                                  onClick={() => setRecipientVoice(relKey, { optedIn: !rv.optedIn })}
                                  title={rv.optedIn ? 'On — replies to them use this voice' : 'Off — replies to them use your global voice'}
                                  className={`px-2 py-1 rounded-full text-tiny font-bold shrink-0 transition-all ${rv.optedIn ? 'bg-accent text-on-accent' : 'bg-inset text-ink-3 hover:text-ink'}`}
                                >
                                  {rv.optedIn ? 'On' : 'Off'}
                                </button>
                                {relKey.startsWith('im:') && (
                                  <button onClick={() => rebuildRecipientVoice(relKey, rv.recipientName)} disabled={voiceBusy} className="p-1 text-ink-3 hover:text-accent disabled:opacity-50 shrink-0" title="Rebuild from your messages to them">
                                    <Wand2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button onClick={() => removeRecipientVoice(relKey)} className="p-1 text-ink-3 hover:text-danger shrink-0" title="Remove this person's voice">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              <textarea
                                value={rv.card}
                                onChange={e => setRecipientVoice(relKey, { card: e.target.value, source: 'user_edited' })}
                                rows={3}
                                placeholder="Their voice card…"
                                className="mt-2 w-full bg-inset border border-edge-2 rounded-lg px-3 py-2 text-tiny font-medium resize-none outline-none focus:border-secondary leading-relaxed"
                              />
                            </div>
                          ))}
                        </div>
                        <p className="text-tiny text-ink-3 font-medium mt-1.5">A person's voice overrides your global voice when you reply to them. Add one from a 1:1 conversation in Messages.</p>
                      </div>
                    )}

                    <p className="text-tiny text-ink-3 font-medium">Your messages are read locally on this Mac to learn your style — only the resulting profile goes to the model you’ve connected.</p>
                  </div>
                )}
              </div>

              {/* Playbooks — saved procedures the agent can reuse */}
              {playbooks.length > 0 && (
                <div className="border-t border-edge pt-4 mt-4">
                  <label className="text-tiny font-black uppercase opacity-50 mb-1.5 block tracking-widest">Playbooks</label>
                  <div className="space-y-2">
                    {playbooks.map((pb) => (
                      <div key={pb.path} className="rounded-xl border border-edge-2 bg-panel px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold truncate flex-1">{pb.title}</span>
                          <span className="text-tiny text-ink-3 shrink-0">{pb.steps.length} step{pb.steps.length !== 1 ? 's' : ''}{pb.accept > 0 ? ` · used ${pb.accept}×` : ''}</span>
                          <button
                            onClick={() => togglePlaybookTrust(pb)}
                            title={pb.verified ? 'Trusted — the agent may offer to run this' : "Off — won't be suggested"}
                            className={`px-2 py-1 rounded-full text-tiny font-bold shrink-0 transition-all ${pb.verified ? 'bg-accent text-on-accent' : 'bg-inset text-ink-3 hover:text-ink'}`}
                          >{pb.verified ? 'Trusted' : 'Off'}</button>
                          <button onClick={() => removePlaybook(pb)} className="p-1 text-ink-3 hover:text-danger shrink-0" title="Remove this playbook">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <ol className="mt-1.5 list-decimal list-inside space-y-0.5">
                          {pb.steps.map((s, i) => <li key={i} className="text-tiny text-ink-2 leading-relaxed">{s.intent}</li>)}
                        </ol>
                      </div>
                    ))}
                  </div>
                  <p className="text-tiny text-ink-3 font-medium mt-1.5">Saved step-by-step procedures. When one is relevant the agent offers to run it — doing each step with your normal tools, confirmed one at a time.</p>
                </div>
              )}

              {/* User Guide section */}
              <div className="border-t border-edge pt-4 mt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <BookOpen className="w-4 h-4 text-secondary shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-ink">User Guide</p>
                      <p className="text-xs text-ink-3 mt-0.5">Agent Forge 2.0 help docs in your Knowledge Core</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {guideStatus === 'installed' ? (
                      <>
                        <span className="text-tiny font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Installed</span>
                        <button onClick={handleDeleteGuide} className="text-xs text-ink-3 hover:text-rose-500 transition-colors">Remove</button>
                      </>
                    ) : guideStatus === 'deleted' ? (
                      <>
                        <span className="text-tiny font-black uppercase tracking-widest text-ink-3">Not installed</span>
                        <button onClick={handleRestoreGuide} className="text-xs font-bold text-primary hover:text-primary-hover transition-colors">Restore</button>
                      </>
                    ) : (
                      <span className="text-tiny text-ink-3">...</span>
                    )}
                  </div>
                </div>
              </div>

              {/* AI Models */}
              <div className="border-t border-edge pt-4 mt-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-ink">AI Models</p>
                    <p className="text-xs text-ink-3 mt-0.5">
                      {models.length > 0
                        ? `${models.length} connected · add another anytime`
                        : 'Connect a model to power your agents'}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      const ss = useSettingsStore.getState();
                      ss.setWizardStep(3);
                      ss.setShowModelWizard(true);
                      onClose();
                    }}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-accent text-on-accent text-xs font-black uppercase tracking-widest hover:bg-accent-strong transition-all shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" /> Connect a model
                  </button>
                </div>
              </div>

              {/* Setup Wizard */}
              <div className="border-t border-edge pt-4 mt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold text-ink">Setup Wizard</p>
                    <p className="text-xs text-ink-3 mt-0.5">Re-run the full first-time setup walkthrough</p>
                  </div>
                  <button
                    onClick={async () => {
                      await db.set('onboardingComplete', false);
                      const { useSettingsStore: ss } = await import('../store/useSettingsStore');
                      ss.getState().setOnboardingComplete(false);
                      ss.getState().setShowOnboarding(true);
                      onClose();
                    }}
                    className="text-xs font-bold text-primary hover:text-primary-hover transition-colors"
                  >
                    Re-run →
                  </button>
                </div>
              </div>
            </div>
          ) : profileSettingsTab === 'appearance' ? (
            <div className="space-y-6">
              {/* Theme mode */}
              <div>
                <label className="text-tiny font-black uppercase tracking-widest text-primary dark:text-secondary-light mb-2 block">Theme</label>
                <div className="inline-flex rounded-full border border-edge-2 p-1 gap-1">
                  {([
                    { id: 'light', label: 'Light', icon: Sun },
                    { id: 'dark', label: 'Dark', icon: Moon },
                    { id: 'system', label: 'System', icon: Monitor },
                  ] as const).map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      onClick={() => setTheme(id)}
                      className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
                        theme === id
                          ? 'bg-accent text-on-accent'
                          : 'text-ink-3 hover:bg-wash'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" /> {label}
                    </button>
                  ))}
                </div>
                <p className="text-tiny text-ink-3 mt-1.5 font-medium">System follows your OS light/dark preference.</p>
              </div>

              {/* Accent color */}
              <div>
                <label className="text-tiny font-black uppercase tracking-widest text-primary dark:text-secondary-light mb-2 block">Accent Color</label>
                <div className="flex gap-3 flex-wrap">
                  {ACCENT_OPTIONS.map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => setAccentColor(opt.id)}
                      title={opt.label}
                      className={`flex flex-col items-center gap-1.5 group`}
                    >
                      <span
                        className={`w-9 h-9 rounded-full transition-all flex items-center justify-center ${
                          accentColor === opt.id
                            ? 'ring-2 ring-offset-2 ring-accent ring-offset-panel scale-105'
                            : 'group-hover:scale-105'
                        }`}
                        style={{ backgroundColor: opt.swatch }}
                      >
                        {accentColor === opt.id && <Check className="w-4 h-4 text-white drop-shadow" />}
                      </span>
                      <span className={`text-tiny font-bold ${accentColor === opt.id ? 'text-accent' : 'text-ink-3'}`}>{opt.label}</span>
                    </button>
                  ))}
                </div>
                <p className="text-tiny text-ink-3 mt-2 font-medium">Buttons, highlights, and your chat bubbles pick up this color everywhere.</p>
              </div>

              {/* Voice — guided setup for the "Read aloud" button */}
              <div>
                <label className="text-tiny font-black uppercase tracking-widest text-primary dark:text-secondary-light mb-2 flex items-center gap-2"><Volume2 className="w-3.5 h-3.5" /> Voice</label>
                <p className="text-tiny text-ink-3 mb-3 font-medium">The voice used when reading messages aloud. Each agent can pick its own in its settings.</p>
                <div className="flex items-center justify-between gap-3 p-4 rounded-2xl border border-edge bg-inset">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-ink truncate">{ttsVoiceLabel}</div>
                    <div className="text-tiny text-ink-3">Preview voices and get more natural ones.</div>
                  </div>
                  <button onClick={() => setShowVoiceSetup(true)} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-accent text-on-accent text-xs font-black uppercase tracking-widest hover:bg-accent-strong transition-all shrink-0">
                    <Volume2 className="w-3.5 h-3.5" /> Set up voice
                  </button>
                </div>
              </div>
            </div>
          ) : profileSettingsTab === 'integrations' ? (
            <div className="space-y-6">

              {/* Image Generation Tooling - Engineered UX */}
              <div className="p-6 rounded-3xl border border-edge bg-panel shadow-sm flex flex-col gap-6">
                 <div>
                    <h4 className="text-sm font-black uppercase tracking-widest flex items-center gap-2 mb-1"><ImageIcon className="w-4 h-4 text-accent" /> Image Engine</h4>
                    <p className="text-xs text-ink-3 font-medium">Configure your preferred AI image generator API. Keys are stored locally.</p>
                 </div>

                 <div>
                    <label className="text-tiny font-black uppercase opacity-50 mb-2 block tracking-widest">Provider</label>
                    <select value={appSettings.imageProvider} onChange={e => { setAppSettings((prev: any) => ({ ...prev, imageProvider: e.target.value, imageModelId: '', imageEndpoint: '' })); setImageTestState({loading:false, error:null, successUrl:null}); setImageEngineModels([]); }} className="w-full bg-inset border-2 border-edge-2 rounded-xl px-4 py-3 text-xs outline-none focus:border-secondary font-bold">
                       <option value="none">Disabled</option>
                       <option value="openai">OpenAI (DALL-E & Compatible)</option>
                       <option value="google">Google (Imagen)</option>
                       <option value="custom">Custom Endpoint</option>
                    </select>
                 </div>

                 {/* Dynamic API Key Reveal & Testing */}
                 {appSettings.imageProvider !== 'none' && (
                    <div className="animate-in slide-in-from-top-2 fade-in duration-300 bg-inset p-4 rounded-2xl border border-edge flex flex-col gap-4">

                       {/* Key Handling */}
                       {appSettings.imageProvider === 'google' && hasImplicitGoogleKey ? (
                          <div className="flex items-center gap-3 text-xs font-bold text-success-light bg-success-light/10 p-4 rounded-xl border border-success-light/20">
                             <ShieldCheck className="w-5 h-5 shrink-0" /> Active: Inheriting Google API Key from Chat Models.
                          </div>
                       ) : appSettings.imageProvider === 'openai' && hasImplicitOpenAIKey ? (
                          <div className="flex items-center gap-3 text-xs font-bold text-success-light bg-success-light/10 p-4 rounded-xl border border-success-light/20">
                             <ShieldCheck className="w-5 h-5 shrink-0" /> Active: Inheriting OpenAI API Key from Chat Models.
                          </div>
                       ) : (
                          <div className="flex flex-col gap-2">
                             <label className="text-tiny font-black uppercase tracking-widest text-ink-3">API Key</label>
                             <input
                                type="password"
                                value={
                                   appSettings.imageProvider === 'google' ? integrations.google?.apiKey || '' :
                                   appSettings.imageProvider === 'openai' ? integrations.openai?.apiKey || '' :
                                   integrations.customImage?.apiKey || ''
                                }
                                onChange={e => {
                                   const val = e.target.value;
                                   if (appSettings.imageProvider === 'google') setIntegrations((prev: any) => ({ ...prev, google: { ...prev.google, apiKey: val } }));
                                   else if (appSettings.imageProvider === 'openai') setIntegrations((prev: any) => ({ ...prev, openai: { ...prev.openai, apiKey: val } }));
                                   else setIntegrations((prev: any) => ({ ...prev, customImage: { ...prev.customImage, apiKey: val } }));
                                }}
                                placeholder={appSettings.imageProvider === 'google' ? "AIzaSy..." : "sk-..."}
                                className="w-full bg-panel border border-edge-2 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary font-mono transition-all"
                             />
                          </div>
                       )}

                       {/* Custom Endpoint Field */}
                       {appSettings.imageProvider === 'custom' && (
                          <div className="flex flex-col gap-2">
                             <label className="text-tiny font-black uppercase tracking-widest text-ink-3">Custom Base URL</label>
                             <input
                                type="text"
                                value={appSettings.imageEndpoint || ''}
                                onChange={e => setAppSettings((prev: any) => ({ ...prev, imageEndpoint: e.target.value }))}
                                placeholder="https://your-custom-endpoint.com/v1"
                                className="w-full bg-panel border border-edge-2 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary font-mono transition-all"
                             />
                          </div>
                       )}

                       {/* Fetch Models & Model Selection */}
                       <div className="flex flex-col gap-2 border-t border-edge pt-4">
                           <div className="flex items-center justify-between">
                              <label className="text-tiny font-black uppercase tracking-widest text-ink-3">Target Model ID</label>
                              <button onClick={fetchImageModels} disabled={isFetchingImageModels || !activeImageKey} className="text-tiny font-black uppercase tracking-widest text-primary hover:text-primary-dark dark:text-secondary-light dark:hover:text-white disabled:opacity-50 transition-all flex items-center gap-1">
                                  {isFetchingImageModels ? <Loader2 className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />} Fetch Models
                              </button>
                           </div>

                           {imageEngineModels.length > 0 ? (
                               <select value={appSettings.imageModelId || ''} onChange={e => setAppSettings((prev: any) => ({ ...prev, imageModelId: e.target.value }))} className="w-full bg-panel border border-edge-2 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary font-bold transition-all">
                                   <option value="" disabled>Select a model...</option>
                                   {imageEngineModels.map(m => <option key={m} value={m}>{m}</option>)}
                               </select>
                           ) : (
                               <input
                                  type="text"
                                  value={appSettings.imageModelId || ''}
                                  onChange={e => setAppSettings((prev: any) => ({ ...prev, imageModelId: e.target.value }))}
                                  placeholder={appSettings.imageProvider === 'google' ? "e.g. imagen-3.0-generate-001" : "e.g. dall-e-3"}
                                  className="w-full bg-panel border border-edge-2 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary font-mono transition-all"
                               />
                           )}
                       </div>

                       {/* TEST INTEGRATION BLOCK */}
                       <div className="pt-4 border-t border-edge flex flex-col gap-3">
                          <button
                             onClick={testImageEngine}
                             disabled={imageTestState.loading || !activeImageKey || !appSettings.imageModelId}
                             className="flex items-center justify-center gap-2 w-full py-3 bg-accent-soft hover:bg-wash text-accent-soft-ink rounded-xl text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50"
                          >
                             {imageTestState.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                             {imageTestState.loading ? 'Testing...' : 'Test Connection (Cat in Banana Costume)'}
                          </button>

                          {imageTestState.loading && (
                              <div className="p-4 bg-primary/10 text-primary dark:text-secondary-light rounded-xl border border-primary/20 text-xs font-bold leading-relaxed flex items-center gap-2 animate-pulse">
                                  <Loader2 className="w-4 h-4 animate-spin" /> Generating test image, please wait...
                              </div>
                          )}

                          {imageTestState.error && (
                              <div className="p-4 bg-error/10 text-error rounded-xl border border-error/20 text-xs font-bold leading-relaxed">
                                  {imageTestState.error}
                              </div>
                          )}
                          {imageTestState.successUrl && (
                              <div className="p-2 bg-panel rounded-xl border border-edge-2 shadow-sm text-center animate-in fade-in zoom-in-95">
                                  <img src={imageTestState.successUrl} alt="Test Success" className="w-full max-w-[200px] h-auto rounded-lg mx-auto mb-2 cursor-pointer" onClick={() => viewImageInCanvas(imageTestState.successUrl as string)} title="View full size in Canvas" />
                                  <span className="text-tiny font-black uppercase tracking-widest text-success-light flex items-center justify-center gap-1 mt-2"><ShieldCheck className="w-3 h-3" /> Connection Successful</span>
                              </div>
                          )}
                       </div>
                    </div>
                 )}

                 {/* Output Preference */}
                 {appSettings.imageProvider !== 'none' && (
                     <div className="pt-2 border-t border-edge ">
                        <span className="text-tiny font-black uppercase opacity-50 mb-3 block tracking-widest">Image Delivery Method</span>
                        <div className="flex bg-wash p-1.5 rounded-xl">
                           <button onClick={() => setAppSettings((prev: any) => ({ ...prev, defaultImageOutput: 'canvas' } as any))} className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-black uppercase tracking-widest rounded-lg transition-all ${(appSettings as any).defaultImageOutput === 'canvas' ? 'bg-white  shadow-sm text-primary dark:text-white' : 'text-ink-3 hover:text-ink-2 dark:hover:text-ink-2'}`}>Canvas Artifact</button>
                           <button onClick={() => setAppSettings((prev: any) => ({ ...prev, defaultImageOutput: 'document' } as any))} className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-black uppercase tracking-widest rounded-lg transition-all ${(appSettings as any).defaultImageOutput === 'document' ? 'bg-white  shadow-sm text-primary dark:text-white' : 'text-ink-3 hover:text-ink-2 dark:hover:text-ink-2'}`}>In-Chat Message</button>
                        </div>
                     </div>
                 )}
              </div>

              {/* Image Understanding (vision) — mirror of the Image Engine, pointed the other way */}
              <div className="p-6 rounded-3xl border border-edge bg-panel shadow-sm flex flex-col gap-6">
                 <div>
                    <h4 className="text-sm font-black uppercase tracking-widest flex items-center gap-2 mb-1"><Eye className="w-4 h-4 text-accent" /> Image Understanding</h4>
                    <p className="text-xs text-ink-3 font-medium">Lets any chat model read images you attach. Vision-capable models see them directly; text-only models use the model you pick here to read the image into text. Keys are stored locally.</p>
                 </div>

                 <div>
                    <label className="text-tiny font-black uppercase opacity-50 mb-2 block tracking-widest">Provider</label>
                    <select value={appSettings.visionProvider} onChange={e => { setAppSettings((prev: any) => ({ ...prev, visionProvider: e.target.value, visionModelId: '', visionEndpoint: '' })); setVisionTestState({ loading: false, error: null, successUrl: null }); }} className="w-full bg-inset border-2 border-edge-2 rounded-xl px-4 py-3 text-xs outline-none focus:border-secondary font-bold">
                       <option value="auto">Automatic (use a connected key)</option>
                       <option value="none">Disabled</option>
                       <option value="google">Google (Gemini)</option>
                       <option value="openai">OpenAI (GPT-4o)</option>
                       <option value="anthropic">Anthropic (Claude)</option>
                       <option value="custom">Local / Custom Endpoint</option>
                    </select>
                    {appSettings.visionProvider === 'auto' && (
                       <p className="text-tiny text-ink-3 mt-2 font-medium">{visionRouteReady ? 'Using a key already connected to your chat models — nothing leaves your Mac unless you attach an image.' : 'No connected key found yet. Connect Google/OpenAI/Anthropic, or choose Local/Custom.'}</p>
                    )}
                 </div>

                 {(appSettings.visionProvider === 'google' || appSettings.visionProvider === 'openai' || appSettings.visionProvider === 'anthropic' || appSettings.visionProvider === 'custom') && (
                    <div className="animate-in slide-in-from-top-2 fade-in duration-300 bg-inset p-4 rounded-2xl border border-edge flex flex-col gap-4">

                       {appSettings.visionProvider === 'google' && hasImplicitGoogleKey ? (
                          <div className="flex items-center gap-3 text-xs font-bold text-success-light bg-success-light/10 p-4 rounded-xl border border-success-light/20"><ShieldCheck className="w-5 h-5 shrink-0" /> Active: Inheriting Google API Key from Chat Models.</div>
                       ) : appSettings.visionProvider === 'openai' && hasImplicitOpenAIKey ? (
                          <div className="flex items-center gap-3 text-xs font-bold text-success-light bg-success-light/10 p-4 rounded-xl border border-success-light/20"><ShieldCheck className="w-5 h-5 shrink-0" /> Active: Inheriting OpenAI API Key from Chat Models.</div>
                       ) : appSettings.visionProvider === 'anthropic' && hasImplicitAnthropicKey ? (
                          <div className="flex items-center gap-3 text-xs font-bold text-success-light bg-success-light/10 p-4 rounded-xl border border-success-light/20"><ShieldCheck className="w-5 h-5 shrink-0" /> Active: Inheriting Anthropic API Key from Chat Models.</div>
                       ) : appSettings.visionProvider !== 'custom' ? (
                          <div className="flex flex-col gap-2">
                             <label className="text-tiny font-black uppercase tracking-widest text-ink-3">API Key</label>
                             <input
                                type="password"
                                value={appSettings.visionProvider === 'google' ? integrations.google?.apiKey || '' : appSettings.visionProvider === 'openai' ? integrations.openai?.apiKey || '' : integrations.anthropic?.apiKey || ''}
                                onChange={e => { const val = e.target.value; if (appSettings.visionProvider === 'google') setIntegrations((prev: any) => ({ ...prev, google: { ...prev.google, apiKey: val } })); else if (appSettings.visionProvider === 'openai') setIntegrations((prev: any) => ({ ...prev, openai: { ...prev.openai, apiKey: val } })); else setIntegrations((prev: any) => ({ ...prev, anthropic: { ...prev.anthropic, apiKey: val } })); }}
                                placeholder={appSettings.visionProvider === 'google' ? 'AIzaSy...' : appSettings.visionProvider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
                                className="w-full bg-panel border border-edge-2 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary font-mono transition-all"
                             />
                          </div>
                       ) : null}

                       {appSettings.visionProvider === 'custom' && (
                          <div className="flex flex-col gap-2">
                             <label className="text-tiny font-black uppercase tracking-widest text-ink-3">Endpoint (OpenAI-compatible)</label>
                             <input
                                type="text"
                                value={appSettings.visionEndpoint || ''}
                                onChange={e => setAppSettings((prev: any) => ({ ...prev, visionEndpoint: e.target.value }))}
                                placeholder="http://127.0.0.1:8080/v1"
                                className="w-full bg-panel border border-edge-2 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary font-mono transition-all"
                             />
                          </div>
                       )}

                       <div className="flex flex-col gap-2 border-t border-edge pt-4">
                          <label className="text-tiny font-black uppercase tracking-widest text-ink-3">Vision Model <span className="opacity-50 normal-case font-medium">(optional)</span></label>
                          <input
                             type="text"
                             value={appSettings.visionModelId || ''}
                             onChange={e => setAppSettings((prev: any) => ({ ...prev, visionModelId: e.target.value }))}
                             placeholder={appSettings.visionProvider === 'google' ? 'gemini-2.5-flash' : appSettings.visionProvider === 'openai' ? 'gpt-4o-mini' : appSettings.visionProvider === 'anthropic' ? 'claude-3-5-haiku-latest' : 'model id served at endpoint'}
                             className="w-full bg-panel border border-edge-2 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary font-mono transition-all"
                          />
                       </div>
                    </div>
                 )}

                 {appSettings.visionProvider !== 'none' && (
                    <div className="pt-2 border-t border-edge flex flex-col gap-3">
                       <button
                          onClick={runVisionTest}
                          disabled={visionTestState.loading || !visionRouteReady}
                          className="flex items-center justify-center gap-2 w-full py-3 bg-accent-soft hover:bg-wash text-accent-soft-ink rounded-xl text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50"
                       >
                          {visionTestState.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                          {visionTestState.loading ? 'Testing...' : 'Test Connection'}
                       </button>
                       {visionTestState.error && (
                          <div className="p-4 bg-error/10 text-error rounded-xl border border-error/20 text-xs font-bold leading-relaxed">{visionTestState.error}</div>
                       )}
                       {visionTestState.successUrl && (
                          <div className="p-4 bg-success-light/10 rounded-xl border border-success-light/20 text-xs leading-relaxed animate-in fade-in">
                             <span className="text-tiny font-black uppercase tracking-widest text-success-light flex items-center gap-1 mb-2"><ShieldCheck className="w-3 h-3" /> Connection successful — it can see</span>
                             <span className="text-ink-2 font-medium block">{visionTestState.successUrl}</span>
                          </div>
                       )}
                    </div>
                 )}
              </div>

              {/* Brave Search Integration */}
              <div className="p-6 rounded-3xl border border-edge bg-panel shadow-sm flex flex-col gap-4">
                 <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                     <div className="flex items-center gap-3">
                         <div className="p-3 bg-orange-50 dark:bg-orange-900/20 rounded-xl shadow-sm border border-orange-100 dark:border-orange-800"><Globe className="w-5 h-5 text-orange-500" /></div>
                         <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-black uppercase tracking-widest block">Brave Search</span>
                              <span className="text-micro font-black uppercase px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400">2,000 free/mo</span>
                            </div>
                            <span className="text-xs text-ink-3 font-medium mt-0.5">Privacy-focused web search. Free tier included. <a href="https://brave.com/search/api/" target="_blank" rel="noreferrer" className="text-secondary hover:underline font-bold inline-flex items-center gap-1">Get API Key <Link className="w-2.5 h-2.5"/></a></span>
                         </div>
                     </div>
                     <button onClick={() => setIntegrations((prev: any) => ({ ...prev, brave: { ...prev.brave, enabled: !prev.brave?.enabled } }))} className={`px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm ${integrations.brave?.enabled ? 'bg-[#DCE7E1] text-success dark:bg-[#2C3E35]/30 dark:text-[#B5CDBF]' : 'bg-primary text-white hover:bg-primary-hover'}`}>{integrations.brave?.enabled ? 'Enabled' : 'Enable'}</button>
                 </div>
                 {integrations.brave?.enabled && (
                    <div className="animate-in slide-in-from-top-2 pt-4 border-t border-edge ">
                       <input type="password" value={integrations.brave?.apiKey || ''} onChange={e => setIntegrations((prev: any) => ({ ...prev, brave: { ...prev.brave, apiKey: e.target.value } }))} placeholder="Paste your BSA... API key here" className="w-full bg-inset border border-edge-2 rounded-xl px-4 py-3 text-sm outline-none focus:border-secondary font-mono transition-all" />
                    </div>
                 )}
              </div>

              {/* Tavily Web Search Integration */}
              <div className="p-6 rounded-3xl border border-edge bg-panel shadow-sm flex flex-col gap-4">
                 <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                     <div className="flex items-center gap-3">
                         <div className="p-3 bg-inset rounded-xl shadow-sm border border-edge-2"><Globe className="w-5 h-5 text-secondary" /></div>
                         <div className="flex flex-col">
                            <span className="text-sm font-black uppercase tracking-widest block">Tavily Web Search</span>
                            <span className="text-xs text-ink-3 font-medium mt-0.5">1,000 free AI searches/month. <a href="https://tavily.com" target="_blank" rel="noreferrer" className="text-secondary hover:underline font-bold inline-flex items-center gap-1">Get API Key <Link className="w-2.5 h-2.5"/></a></span>
                         </div>
                     </div>
                     <button onClick={() => setIntegrations((prev: any) => ({ ...prev, tavily: { ...prev.tavily, enabled: !prev.tavily?.enabled } }))} className={`px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm ${integrations.tavily?.enabled ? 'bg-[#DCE7E1] text-success dark:bg-[#2C3E35]/30 dark:text-[#B5CDBF]' : 'bg-primary text-white hover:bg-primary-hover'}`}>{integrations.tavily?.enabled ? 'Enabled' : 'Enable'}</button>
                 </div>
                 {integrations.tavily?.enabled && (
                    <div className="animate-in slide-in-from-top-2 pt-4 border-t border-edge ">
                       <input type="password" value={integrations.tavily?.apiKey || ''} onChange={e => setIntegrations((prev: any) => ({ ...prev, tavily: { ...prev.tavily, apiKey: e.target.value } }))} placeholder="Paste your tvly-... API key here" className="w-full bg-inset border border-edge-2 rounded-xl px-4 py-3 text-sm outline-none focus:border-secondary font-mono transition-all" />
                    </div>
                 )}
              </div>

              {/* Slack Integration */}
              <div className="p-6 rounded-3xl border border-edge bg-panel shadow-sm flex flex-col gap-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-inset rounded-xl shadow-sm border border-edge-2"><MessageSquare className="w-5 h-5 text-secondary" /></div>
                    <div className="flex flex-col">
                      <span className="text-sm font-black uppercase tracking-widest block">Slack</span>
                      <span className="text-xs text-ink-3 font-medium mt-0.5">Let agents search messages and post to channels. Requires a Slack bot token.</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setIntegrations((prev: any) => ({ ...prev, slack: { ...prev.slack, enabled: !prev.slack?.enabled } }))}
                    className={`px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm shrink-0 ${integrations.slack?.enabled ? 'bg-[#DCE7E1] text-success dark:bg-[#2C3E35]/30 dark:text-[#B5CDBF]' : 'bg-primary text-white hover:bg-primary-hover'}`}
                  >{integrations.slack?.enabled ? 'Enabled' : 'Enable'}</button>
                </div>
                {integrations.slack?.enabled && (
                  <div className="animate-in slide-in-from-top-2 pt-4 border-t border-edge flex flex-col gap-3">
                    <label className="text-tiny font-black uppercase tracking-widest text-ink-3">Bot Token</label>
                    <input
                      type="password"
                      value={integrations.slack?.botToken || ''}
                      onChange={e => setIntegrations((prev: any) => ({ ...prev, slack: { ...prev.slack, botToken: e.target.value } }))}
                      placeholder="xoxb-..."
                      className="w-full bg-inset border border-edge-2 rounded-xl px-4 py-3 text-sm outline-none focus:border-secondary font-mono transition-all"
                    />
                    <p className="text-tiny text-ink-3 leading-relaxed">
                      Create a Slack app at <span className="font-mono bg-wash px-1 rounded">api.slack.com/apps</span> → OAuth &amp; Permissions → add scopes: <span className="font-mono bg-wash px-1 rounded">channels:history, channels:read, chat:write, search:read</span> → install to workspace → copy Bot User OAuth Token.
                    </p>
                    {integrations.slack?.botToken && (
                      <div className="flex items-center gap-2 text-tiny font-black uppercase tracking-widest text-success-light">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Token saved
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Mail accounts (IMAP) — multi-account, app-password, no web login.
                  Replaces the old Google Workspace OAuth card. */}
              <div className="p-6 rounded-3xl border border-edge bg-panel shadow-sm flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-inset rounded-xl shadow-sm border border-edge-2">
                      <Mail className="w-5 h-5 text-secondary" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-black uppercase tracking-widest block">Mail accounts</span>
                      <span className="text-xs text-ink-3 font-medium mt-0.5">Gmail &amp; iCloud over IMAP — app password, no web login. Add as many as you like.</span>
                    </div>
                  </div>
                  {!addingMail && (
                    <button
                      onClick={() => { setAddingMail(true); setMailStatus({ state: 'idle' }); setMailEmail(''); setMailPassword(''); }}
                      className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-primary text-white hover:bg-primary-hover transition-all shadow-sm shrink-0"
                    ><Plus className="w-3.5 h-3.5" /> Add account</button>
                  )}
                </div>

                {/* Connected accounts */}
                {mailAccounts.length === 0 && !addingMail && (
                  <p className="text-tiny text-ink-3 text-center py-2">No mail accounts yet. Click "Add account" to connect Gmail or iCloud.</p>
                )}
                {mailAccounts.map(acct => (
                  <div key={acct.id} className="flex items-center gap-3 pt-4 border-t border-edge ">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: acct.provider === 'gmail' ? '#D85A30' : '#378ADD' }} />
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm font-bold truncate ">{acct.email}</span>
                      <span className="text-tiny font-medium text-ink-3">{acct.provider === 'gmail' ? 'Gmail' : 'iCloud'} · IMAP connected</span>
                    </div>
                    <CheckCircle2 className="w-4 h-4 text-success-light shrink-0" />
                    <button onClick={() => handleMailRemove(acct.email)} className="p-2 text-ink-3 hover:text-error transition-colors shrink-0"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}

                {/* Add-account flow */}
                {addingMail && (
                  <div className="pt-4 border-t border-edge flex flex-col gap-4 animate-in slide-in-from-top-2">
                    <div className="flex gap-2">
                      {(['gmail', 'icloud'] as const).map(p => (
                        <button
                          key={p}
                          onClick={() => { setMailProvider(p); setMailStatus({ state: 'idle' }); }}
                          className={`flex-1 px-4 py-2.5 rounded-xl text-xs font-bold border transition-all ${mailProvider === p ? 'bg-accent-soft border-accent/30 text-accent-soft-ink' : 'border-edge-2 text-ink-3 hover:text-ink-2'}`}
                        >{p === 'gmail' ? 'Gmail' : 'iCloud'}</button>
                      ))}
                    </div>

                    {/* Step 1 — generate the app password in the real browser (the in-app login is what's blocked) */}
                    <div className="rounded-2xl border border-edge bg-inset p-4 flex flex-col gap-3">
                      <span className="text-tiny font-black uppercase tracking-widest text-ink-3">Step 1 · Get your app password</span>
                      <ol className="text-xs text-ink-3 leading-relaxed list-decimal pl-4 flex flex-col gap-1">
                        {mailProvider === 'gmail' ? (
                          <>
                            <li>Open the page below — it signs in with your real browser.</li>
                            <li>Name it <span className="font-bold">Agent Forge</span>, then click <span className="font-bold">Create</span>.</li>
                            <li>Copy the 16-character password — <span className="font-bold">save it</span>, you only see it once.</li>
                            <li>Paste it into Step 2 below.</li>
                          </>
                        ) : (
                          <>
                            <li>Open the page below and sign in.</li>
                            <li><span className="font-bold">App-Specific Passwords</span> → <span className="font-bold">+</span> → name it <span className="font-bold">Agent Forge</span>.</li>
                            <li>Copy the password — <span className="font-bold">save it</span>, you only see it once.</li>
                            <li>Paste it into Step 2 below.</li>
                          </>
                        )}
                      </ol>
                      <button
                        onClick={() => openUrl(mailProvider === 'gmail' ? 'https://myaccount.google.com/apppasswords' : 'https://account.apple.com').catch(() => {})}
                        className="self-start flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-primary text-white hover:bg-primary-hover transition-all shadow-sm"
                      ><ExternalLink className="w-3.5 h-3.5" /> {mailProvider === 'gmail' ? 'Open Gmail app passwords' : 'Open Apple ID page'}</button>
                      {mailProvider === 'gmail' && (
                        <p className="text-tiny text-ink-3 leading-relaxed">Page says it's unavailable? Switch on 2-Step Verification in your Google account first, then reopen it.</p>
                      )}
                    </div>

                    {/* Step 2 — paste it back and connect */}
                    <div className="rounded-2xl border border-edge bg-inset p-4 flex flex-col gap-3">
                      <span className="text-tiny font-black uppercase tracking-widest text-ink-3">Step 2 · Connect</span>
                      <input
                        type="email"
                        value={mailEmail}
                        onChange={e => setMailEmail(e.target.value)}
                        placeholder={mailProvider === 'gmail' ? 'you@gmail.com' : 'you@icloud.com'}
                        className="w-full bg-white border border-edge-2 rounded-xl px-4 py-3 text-sm outline-none focus:border-secondary font-mono transition-all"
                      />
                      <input
                        type="password"
                        value={mailPassword}
                        onChange={e => setMailPassword(e.target.value)}
                        placeholder="Paste the app password (spaces ok)"
                        className="w-full bg-white border border-edge-2 rounded-xl px-4 py-3 text-sm outline-none focus:border-secondary font-mono transition-all"
                      />
                      <div className="flex items-center gap-3 flex-wrap">
                        <button
                          onClick={handleMailConnect}
                          disabled={!mailEmail.trim() || !mailPassword || mailStatus.state === 'testing'}
                          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-primary text-white hover:bg-primary-hover transition-all shadow-sm shrink-0 disabled:opacity-40"
                        >
                          {mailStatus.state === 'testing' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link className="w-3.5 h-3.5" />}
                          {mailStatus.state === 'testing' ? 'Connecting…' : 'Connect & save'}
                        </button>
                        <button
                          onClick={() => { setAddingMail(false); setMailStatus({ state: 'idle' }); }}
                          className="px-4 py-2.5 rounded-xl text-xs font-bold text-ink-3 hover:text-ink-2 transition-all"
                        >Cancel</button>
                      </div>
                      {mailStatus.state === 'error' && (
                        <div className="text-tiny font-bold text-error break-words flex flex-col gap-1">
                          <span>✗ {mailStatus.msg}</span>
                          {/application-specific|app password|app-specific|185833/i.test(mailStatus.msg ?? '') && (
                            <span className="text-ink-3 font-medium">↑ That looks like your normal password. Use the app password from Step 1.</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* iMessage — reads the local Messages database (Full Disk Access); sends via Messages.app */}
              <div className="p-6 rounded-3xl border border-edge bg-panel shadow-sm flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-inset rounded-xl shadow-sm border border-edge-2">
                      <MessageCircle className="w-5 h-5 text-secondary" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-black uppercase tracking-widest block">iMessage</span>
                      <span className="text-xs text-ink-3 font-medium mt-0.5">Your iMessage &amp; SMS, read straight from this Mac. No account — just a one-time permission.</span>
                    </div>
                  </div>
                  {imessageEnabled
                    ? <span className="flex items-center gap-1.5 text-xs font-bold text-success-light shrink-0"><CheckCircle2 className="w-4 h-4" /> Connected</span>
                    : (
                      <button
                        onClick={handleImessageCheck}
                        disabled={imsgStatus.state === 'checking'}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-primary text-white hover:bg-primary-hover transition-all shadow-sm shrink-0 disabled:opacity-40"
                      >
                        {imsgStatus.state === 'checking' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link className="w-3.5 h-3.5" />}
                        {imsgStatus.state === 'checking' ? 'Checking…' : 'Connect'}
                      </button>
                    )}
                </div>

                <div className="rounded-2xl border border-edge bg-inset p-4 flex flex-col gap-3">
                  <span className="text-tiny font-black uppercase tracking-widest text-ink-3">One-time setup</span>
                  <ol className="text-xs text-ink-3 leading-relaxed list-decimal pl-4 flex flex-col gap-1">
                    <li>Open <span className="font-bold">Full Disk Access</span> and switch on <span className="font-bold">Agent Forge</span> (so it can read your message history).</li>
                    <li>Click <span className="font-bold">Connect</span> above to verify.</li>
                    <li>The first time you send, macOS asks to let Agent Forge control Messages — click <span className="font-bold">OK</span>.</li>
                  </ol>
                  <button
                    onClick={() => invoke('imessage_open_fda_settings').catch(() => {})}
                    className="self-start flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-primary text-white hover:bg-primary-hover transition-all shadow-sm"
                  ><ExternalLink className="w-3.5 h-3.5" /> Open Full Disk Access</button>
                </div>

                {imsgStatus.state === 'ok' && (
                  <span className="text-tiny font-bold text-success-light">✓ {imsgStatus.msg}</span>
                )}
                {imsgStatus.state === 'error' && (
                  <div className="text-tiny font-bold text-error break-words flex flex-col gap-1">
                    <span>✗ {imsgStatus.msg}</span>
                    <span className="text-ink-3 font-medium">↑ Turn on Full Disk Access for Agent Forge, then click Connect again. (A full quit &amp; relaunch may be needed after granting.)</span>
                  </div>
                )}
              </div>

              {/* Calendar — local store vs the native macOS Calendar (EventKit). Native syncs to iPhone via iCloud. */}
              <div className="p-6 rounded-3xl border border-edge bg-panel shadow-sm flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-inset rounded-xl shadow-sm border border-edge-2">
                    <CalendarDays className="w-5 h-5 text-secondary" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-black uppercase tracking-widest block">Calendar</span>
                    <span className="text-xs text-ink-3 font-medium mt-0.5">Keep events on this Mac, or use your real macOS Calendar — which syncs to your iPhone via iCloud.</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  {([['local', 'On this Mac'], ['eventkit', 'macOS Calendar']] as const).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setCalendarBackend(id)}
                      className={`flex-1 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all border ${calendarBackend === id ? 'bg-primary text-white border-primary' : 'bg-inset text-ink-3 border-edge-2 hover:text-ink-2'}`}
                    >{label}</button>
                  ))}
                </div>

                {calendarBackend === 'eventkit' && (
                  <div className="rounded-2xl border border-edge bg-inset p-4 flex flex-col gap-3">
                    {calAuth === 'authorized'
                      ? <span className="flex items-center gap-1.5 text-xs font-bold text-success-light"><CheckCircle2 className="w-4 h-4 shrink-0" /> Connected to macOS Calendar — changes sync to your devices via iCloud.</span>
                      : <span className="text-tiny text-ink-3 font-medium">Grant access so Agent Forge can read &amp; write your real calendar (it syncs to your iPhone via iCloud).</span>}
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={grantCalendarAccess}
                        disabled={calStatus.state === 'working'}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-primary text-white hover:bg-primary-hover transition-all shadow-sm disabled:opacity-40"
                      >
                        {calStatus.state === 'working' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link className="w-3.5 h-3.5" />} {calAuth === 'authorized' ? 'Re-check access' : 'Grant Calendar access'}
                      </button>
                      {calAuth === 'authorized' && (
                        <button
                          onClick={verifyCalendarSync}
                          disabled={calStatus.state === 'working'}
                          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-inset border border-edge-2 text-ink-2 hover:bg-wash transition-all disabled:opacity-40"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Verify sync
                        </button>
                      )}
                    </div>

                    {calCals.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-tiny font-black uppercase tracking-widest text-ink-3">Show these calendars</span>
                        {calCals.map(c => (
                          <label key={c.id} className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedCalendarIds.length === 0 || selectedCalendarIds.includes(c.id)}
                              onChange={() => toggleCalendarSelected(c.id)}
                            />
                            <span className="font-bold">{c.title}</span>
                            {c.account && <span className="text-ink-3">· {c.account}</span>}
                          </label>
                        ))}
                        <span className="text-[10px] text-ink-3 font-medium">Leave all checked to show every calendar.</span>
                      </div>
                    )}

                    <button
                      onClick={runCalendarMigration}
                      disabled={calStatus.state === 'working' || calendarMigrated}
                      className="self-start flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-inset border border-edge-2 text-ink-2 hover:bg-wash transition-all disabled:opacity-40"
                    >
                      <Upload className="w-3.5 h-3.5" /> {calendarMigrated ? 'Local events migrated' : 'Migrate local events → Mac calendar'}
                    </button>
                  </div>
                )}

                {calStatus.state === 'ok' && <span className="text-tiny font-bold text-success-light">✓ {calStatus.msg}</span>}
                {calStatus.state === 'error' && <span className="text-tiny font-bold text-error break-words">✗ {calStatus.msg}</span>}
              </div>

              {/* To-Dos — local store vs the native Reminders app (EventKit). Native syncs to iPhone via iCloud. */}
              <div className="p-6 rounded-3xl border border-edge bg-panel shadow-sm flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-inset rounded-xl shadow-sm border border-edge-2">
                    <ListTodo className="w-5 h-5 text-secondary" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-black uppercase tracking-widest block">To-Dos</span>
                    <span className="text-xs text-ink-3 font-medium mt-0.5">Keep tasks on this Mac, or use the native Reminders app — which syncs to your iPhone via iCloud.</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  {([['local', 'On this Mac'], ['eventkit', 'Reminders']] as const).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setTasksBackend(id)}
                      className={`flex-1 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all border ${tasksBackend === id ? 'bg-primary text-white border-primary' : 'bg-inset text-ink-3 border-edge-2 hover:text-ink-2'}`}
                    >{label}</button>
                  ))}
                </div>

                {tasksBackend === 'eventkit' && (
                  <div className="rounded-2xl border border-edge bg-inset p-4 flex flex-col gap-3">
                    {taskAuth === 'authorized'
                      ? <span className="flex items-center gap-1.5 text-xs font-bold text-success-light"><CheckCircle2 className="w-4 h-4 shrink-0" /> Connected to Reminders — changes sync to your devices via iCloud.</span>
                      : <span className="text-tiny text-ink-3 font-medium">Grant access so Agent Forge can read &amp; write your Reminders (they sync to your iPhone via iCloud).</span>}
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={grantRemindersAccess}
                        disabled={taskStatus.state === 'working'}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-primary text-white hover:bg-primary-hover transition-all shadow-sm disabled:opacity-40"
                      >
                        {taskStatus.state === 'working' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link className="w-3.5 h-3.5" />} {taskAuth === 'authorized' ? 'Re-check access' : 'Grant Reminders access'}
                      </button>
                      {taskAuth === 'authorized' && (
                        <button
                          onClick={verifyRemindersSync}
                          disabled={taskStatus.state === 'working'}
                          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-inset border border-edge-2 text-ink-2 hover:bg-wash transition-all disabled:opacity-40"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Verify sync
                        </button>
                      )}
                    </div>

                    {taskLists.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <span className="text-tiny font-black uppercase tracking-widest text-ink-3">Your reminder lists</span>
                        {taskLists.map(l => (
                          <span key={l.id} className="text-xs text-ink-2"><span className="font-bold">{l.title}</span>{l.account && <span className="text-ink-3"> · {l.account}</span>}</span>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={runTasksMigration}
                      disabled={taskStatus.state === 'working' || tasksMigrated}
                      className="self-start flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-inset border border-edge-2 text-ink-2 hover:bg-wash transition-all disabled:opacity-40"
                    >
                      <Upload className="w-3.5 h-3.5" /> {tasksMigrated ? 'Local tasks migrated' : 'Migrate local tasks → Reminders'}
                    </button>
                  </div>
                )}

                {taskStatus.state === 'ok' && <span className="text-tiny font-bold text-success-light">✓ {taskStatus.msg}</span>}
                {taskStatus.state === 'error' && <span className="text-tiny font-bold text-error break-words">✗ {taskStatus.msg}</span>}
              </div>

              {/* Notes — local store vs the native Apple Notes app (AppleScript). Native syncs to iPhone via iCloud. */}
              <div className="p-6 rounded-3xl border border-edge bg-panel shadow-sm flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-inset rounded-xl shadow-sm border border-edge-2">
                    <StickyNote className="w-5 h-5 text-secondary" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-black uppercase tracking-widest block">Notes</span>
                    <span className="text-xs text-ink-3 font-medium mt-0.5">Keep notes in the app, or use the native Apple Notes app — which syncs to your iPhone via iCloud.</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  {([['local', 'In the app'], ['applescript', 'Apple Notes']] as const).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setNotesBackend(id)}
                      className={`flex-1 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all border ${notesBackend === id ? 'bg-primary text-white border-primary' : 'bg-inset text-ink-3 border-edge-2 hover:text-ink-2'}`}
                    >{label}</button>
                  ))}
                </div>

                {notesBackend === 'applescript' && (
                  <div className="rounded-2xl border border-edge bg-inset p-4 flex flex-col gap-3">
                    <span className="text-tiny text-ink-3 font-medium">First use prompts macOS to let Agent Forge control Notes (Automation). Notes sync to your iPhone via iCloud.</span>
                    <button
                      onClick={verifyNotes}
                      disabled={notesStatus.state === 'working'}
                      className="self-start flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-primary text-white hover:bg-primary-hover transition-all shadow-sm disabled:opacity-40"
                    >
                      {notesStatus.state === 'working' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link className="w-3.5 h-3.5" />} Connect &amp; verify
                    </button>
                  </div>
                )}

                {notesStatus.state === 'ok' && <span className="text-tiny font-bold text-success-light">✓ {notesStatus.msg}</span>}
                {notesStatus.state === 'error' && <span className="text-tiny font-bold text-error break-words">✗ {notesStatus.msg}</span>}
              </div>

              {/* GUS — Salesforce Agile Accelerator */}
              <div className="p-6 rounded-3xl border border-edge bg-panel shadow-sm flex flex-col gap-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-inset rounded-xl shadow-sm border border-edge-2"><Layers className="w-5 h-5 text-secondary" /></div>
                    <div className="flex flex-col">
                      <span className="text-sm font-black uppercase tracking-widest block">GUS</span>
                      <span className="text-xs text-ink-3 font-medium mt-0.5">Salesforce Agile Accelerator — query work items, stories, and sprints.</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setIntegrations((prev: any) => ({ ...prev, gus: { ...prev.gus, enabled: !prev.gus?.enabled } }))}
                    className={`px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm shrink-0 ${integrations.gus?.enabled ? 'bg-[#DCE7E1] text-success dark:bg-[#2C3E35]/30 dark:text-[#B5CDBF]' : 'bg-primary text-white hover:bg-primary-hover'}`}
                  >{integrations.gus?.enabled ? 'Enabled' : 'Enable'}</button>
                </div>
                {integrations.gus?.enabled && (
                  <div className="animate-in slide-in-from-top-2 pt-4 border-t border-edge flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-tiny font-black uppercase tracking-widest text-ink-3">Salesforce Instance URL</label>
                      <input
                        type="text"
                        value={integrations.gus?.instanceUrl || ''}
                        onChange={e => setIntegrations((prev: any) => ({ ...prev, gus: { ...prev.gus, instanceUrl: e.target.value } }))}
                        placeholder="https://yourorg.my.salesforce.com"
                        className="w-full bg-inset border border-edge-2 rounded-xl px-4 py-3 text-sm outline-none focus:border-secondary font-mono transition-all"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-tiny font-black uppercase tracking-widest text-ink-3">Access Token / Session ID</label>
                      <input
                        type="password"
                        value={integrations.gus?.accessToken || ''}
                        onChange={e => setIntegrations((prev: any) => ({ ...prev, gus: { ...prev.gus, accessToken: e.target.value } }))}
                        placeholder="00Dxx0000..."
                        className="w-full bg-inset border border-edge-2 rounded-xl px-4 py-3 text-sm outline-none focus:border-secondary font-mono transition-all"
                      />
                    </div>
                    <p className="text-tiny text-ink-3 leading-relaxed">
                      Get a session token via Salesforce CLI: <span className="font-mono bg-wash px-1 rounded">sf org display --target-org &lt;alias&gt;</span> and copy the Access Token. Or create a Connected App with OAuth to get a long-lived token.
                    </p>
                    {integrations.gus?.instanceUrl && integrations.gus?.accessToken && (
                      <div className="flex items-center gap-2 text-tiny font-black uppercase tracking-widest text-success-light">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Credentials saved
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Context Window Line */}
              <div className="p-6 rounded-3xl border border-edge bg-panel shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-wash rounded-xl shadow-sm border border-edge-2"><Eye className="w-5 h-5 text-ink-3" /></div>
                  <div className="flex flex-col">
                    <span className="text-sm font-black uppercase tracking-widest ">Context Window Line</span>
                    <span className="text-xs text-ink-3 font-medium mt-0.5">Show a subtle divider in chat where the agent's memory begins — older messages are no longer in context.</span>
                  </div>
                </div>
                <button
                  onClick={() => setAppSettings((prev: any) => ({ ...prev, showContextWindowLine: !prev.showContextWindowLine }))}
                  className={`px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm shrink-0 ${appSettings?.showContextWindowLine ? 'bg-[#DCE7E1] text-success dark:bg-[#2C3E35]/30 dark:text-[#B5CDBF]' : 'bg-wash text-ink-3 hover:bg-inset'}`}
                >{appSettings?.showContextWindowLine ? 'On' : 'Off'}</button>
              </div>

              {/* Local Planner */}
              <div className="p-6 rounded-3xl border border-edge bg-panel shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-[#F9F4EE] dark:bg-[#5C452E]/20 rounded-xl shadow-sm border border-[#EEDCC4] dark:border-[#5C452E]/30"><CalendarDays className="w-5 h-5 text-accent" /></div>
                  <div className="flex flex-col">
                    <span className="text-sm font-black uppercase tracking-widest ">Local Planner</span>
                    <span className="text-xs text-ink-3 font-medium mt-0.5">Events & reminders saved to <code className="bg-wash px-1 rounded text-mini">~/AgentForge/memory/tasks.md</code></span>
                    <span className="text-tiny text-ink-3 mt-0.5">Enable the "Local Planner" tool on an agent to let it add tasks.</span>
                  </div>
                </div>
                <span className="px-4 py-2 rounded-xl text-tiny font-black uppercase tracking-widest bg-success-light/20 text-success border border-success-light/30">Active</span>
              </div>

            </div>
          ) : (
            <div className="space-y-6">
              {/* Developer Mode — gates agent shell/command execution */}
              <div className="p-5 rounded-2xl border border-edge bg-panel">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col">
                    <span className="text-sm font-black uppercase tracking-widest">Developer Mode</span>
                    <span className="text-xs text-ink-3 font-medium mt-0.5 max-w-md">Let agents propose shell &amp; git commands (you approve each one before it runs). Off by default.</span>
                  </div>
                  <button onClick={() => setAppSettings((prev: any) => ({ ...prev, developerMode: !prev.developerMode }))} className={`w-10 h-5 rounded-full transition-all relative shrink-0 ${appSettings.developerMode ? 'bg-primary' : 'bg-inset'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${appSettings.developerMode ? 'right-0.5' : 'left-0.5'}`} />
                  </button>
                </div>
              </div>

              {/* File access grants */}
              <div className="p-5 rounded-2xl border border-edge bg-panel">
                <span className="text-sm font-black uppercase tracking-widest">File Access Grants</span>
                <span className="block text-xs text-ink-3 font-medium mt-0.5 mb-3">Standing permissions agents have to files outside their workspace.</span>
                {Object.keys(appSettings.fileAccessGrants ?? {}).length === 0 ? (
                  <p className="text-xs text-ink-3 italic">No standing grants. Agents are confined to <code className="bg-wash px-1 rounded text-mini">~/AgentForge/workspace</code> unless you approve a path.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {Object.entries(appSettings.fileAccessGrants ?? {}).map(([key, g]: [string, any]) => (
                      <div key={key} className="flex items-center gap-3 p-2.5 rounded-xl bg-inset">
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="text-xs font-mono text-ink-2 truncate">{g.path}</span>
                          <span className="text-[10px] text-ink-3 uppercase tracking-widest font-bold">{g.scope} · {g.effect}</span>
                        </div>
                        <button onClick={() => useSettingsStore.getState().revokeFileGrant(key)} className="px-2.5 py-1.5 rounded-lg border border-edge-2 text-[10px] font-bold text-ink-2 hover:bg-wash uppercase tracking-widest">Revoke</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* File activity log */}
              <div className="p-5 rounded-2xl border border-edge bg-panel">
                <span className="text-sm font-black uppercase tracking-widest">File Activity</span>
                <span className="block text-xs text-ink-3 font-medium mt-0.5 mb-3">Recent file &amp; command operations.</span>
                {(appSettings.fileActivity ?? []).length === 0 ? (
                  <p className="text-xs text-ink-3 italic">No activity yet.</p>
                ) : (
                  <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto custom-scrollbar">
                    {(appSettings.fileActivity ?? []).map((a: any) => (
                      <div key={a.id} className="flex items-center gap-2 text-xs">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.ok ? 'bg-success' : 'bg-danger'}`} />
                        <span className="font-bold uppercase text-[10px] tracking-widest text-ink-3 w-14 shrink-0">{a.action}</span>
                        <span className="font-mono text-ink-2 truncate flex-1">{a.detail || a.path}</span>
                        <span className="text-[10px] text-ink-3 shrink-0">{new Date(a.at).toLocaleTimeString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <button onClick={onClose} className="w-full py-5 bg-accent text-on-accent font-black text-xs uppercase tracking-[0.2em] rounded-2xl shadow-xl mt-6 shrink-0 active:scale-[0.98] transition-all">Done</button>
      </div>
      {showVoiceSetup && <VoiceSetupModal onClose={() => setShowVoiceSetup(false)} />}
    </div>
  );
}
