import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { AgentSummary, ChatMessage, ConnectionStatus, RelayConnection } from '../relayClient';
import { colors } from '../theme';

interface ChatScreenProps {
  conn: RelayConnection;
  chatId?: string;
  agent: AgentSummary | null;
  title: string;
  onBack: () => void;
}

let localId = 0;
const nextId = () => `local-${Date.now()}-${++localId}`;

export function ChatScreen({ conn, chatId: initialChatId, agent, title, onBack }: ChatScreenProps) {
  const [chatId, setChatId] = useState(initialChatId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(Boolean(initialChatId));
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>(conn.status);
  const [appOnline, setAppOnline] = useState(conn.appOnline);
  const activeReqId = useRef<string | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  useEffect(() => conn.onStatus((s, online) => { setStatus(s); setAppOnline(online); }), [conn]);

  useEffect(() => {
    if (!initialChatId) return;
    let cancelled = false;
    (async () => {
      try {
        const history = await conn.getHistory(initialChatId);
        if (!cancelled) setMessages(history);
      } catch {
        // Mac offline — show what we have (nothing); banner explains why.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [conn, initialChatId]);

  useEffect(() => {
    const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(timer);
  }, [messages.length, streamingId]);

  const updateMessage = (id: string, patch: Partial<ChatMessage>) =>
    setMessages(prev => prev.map(m => (m.id === id ? { ...m, ...patch } : m)));

  function send() {
    const text = input.trim();
    if (!text || streamingId) return;
    setInput('');

    const userMsg: ChatMessage = { id: nextId(), role: 'user', content: text, timestamp: Date.now() };
    const assistantId = nextId();
    setMessages(prev => [...prev, userMsg, { id: assistantId, role: 'assistant', content: '', timestamp: Date.now() }]);
    setStreamingId(assistantId);

    let streamed = '';
    const finish = () => { setStreamingId(null); activeReqId.current = null; };

    activeReqId.current = conn.sendChat(
      { text, agentId: agent?.id, chatId },
      {
        onWaiting: () => {
          updateMessage(assistantId, {
            role: 'system',
            content: 'Your Mac is unreachable — this message is saved on your phone and will send automatically when it reconnects.',
          });
        },
        onAccepted: newChatId => {
          setChatId(newChatId);
          // If this send had been waiting offline, flip back to a live stream bubble.
          updateMessage(assistantId, { role: 'assistant', content: '' });
        },
        onToken: token => {
          streamed += token;
          updateMessage(assistantId, { content: streamed });
        },
        onDone: message => {
          updateMessage(assistantId, { content: message?.content ?? streamed });
          finish();
        },
        onQueued: () => {
          updateMessage(assistantId, {
            role: 'system',
            content: 'Your Mac app is closed — the message was queued and will be answered when it opens.',
          });
          finish();
        },
        onCancelled: finish,
        onError: error => {
          updateMessage(assistantId, { role: 'system', content: `Failed: ${error}` });
          finish();
        },
      },
    );
  }

  const banner =
    status !== 'online' ? { text: 'Mac unreachable — messages wait on your phone until it reconnects', color: colors.warning } :
    !appOnline ? { text: 'Mac app closed — messages queue in its Inbox', color: colors.warning } :
    null;

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        <View style={{ width: 48 }} />
      </View>

      {banner && (
        <View style={[styles.banner, { borderColor: banner.color }]}>
          <Text style={[styles.bannerText, { color: banner.color }]}>{banner.text}</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.accent} /></View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => m.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          renderItem={({ item }) => (
            <View
              style={[
                styles.bubble,
                item.role === 'user' ? styles.userBubble : item.role === 'system' ? styles.systemBubble : styles.assistantBubble,
              ]}
            >
              <Text style={item.role === 'user' ? styles.userText : item.role === 'system' ? styles.systemText : styles.assistantText}>
                {item.content || (item.id === streamingId ? '…' : '')}
              </Text>
            </View>
          )}
        />
      )}

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={`Message ${agent?.name ?? 'agent'}…`}
          placeholderTextColor={colors.ink3}
          multiline
          editable={!streamingId}
        />
        {streamingId ? (
          <TouchableOpacity
            style={[styles.sendBtn, styles.stopBtn]}
            onPress={() => activeReqId.current && conn.cancelChat(activeReqId.current)}
          >
            <Text style={styles.sendText}>Stop</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.sendBtn, !input.trim() && styles.sendDisabled]}
            disabled={!input.trim()}
            onPress={send}
          >
            <Text style={styles.sendText}>Send</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: 60 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '700', width: 48 },
  headerTitle: { color: colors.ink, fontSize: 17, fontWeight: '800', flex: 1, textAlign: 'center' },
  banner: { marginHorizontal: 16, marginBottom: 4, borderWidth: 1, borderRadius: 12, paddingVertical: 6, paddingHorizontal: 12 },
  bannerText: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bubble: { maxWidth: '85%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: colors.accent },
  assistantBubble: { alignSelf: 'flex-start', backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.edge },
  systemBubble: { alignSelf: 'center', backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.edge, borderStyle: 'dashed' },
  userText: { color: '#fff', fontSize: 15, lineHeight: 21 },
  assistantText: { color: colors.ink, fontSize: 15, lineHeight: 22 },
  systemText: { color: colors.ink3, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, paddingBottom: 28, borderTopWidth: 1, borderTopColor: colors.edge },
  input: { flex: 1, backgroundColor: colors.inset, borderWidth: 1, borderColor: colors.edge, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, color: colors.ink, fontSize: 15, maxHeight: 120 },
  sendBtn: { backgroundColor: colors.accent, borderRadius: 16, paddingHorizontal: 18, paddingVertical: 12 },
  stopBtn: { backgroundColor: colors.danger },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
