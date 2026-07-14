import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AgentSummary, ChatSummary, ConnectionStatus, RelayConnection } from '../relayClient';
import { colors } from '../theme';

interface ChatsScreenProps {
  conn: RelayConnection;
  onOpenChat: (params: { chatId?: string; agent: AgentSummary | null; title: string }) => void;
  onUnpair: () => void;
}

export function ChatsScreen({ conn, onOpenChat, onUnpair }: ChatsScreenProps) {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>(conn.status);
  const [appOnline, setAppOnline] = useState(conn.appOnline);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (conn.status !== 'online' || !conn.appOnline) return;
    try {
      const [agentList, chatList] = await Promise.all([conn.listAgents(), conn.listChats()]);
      setAgents(agentList);
      setChats(chatList);
      setError('');
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [conn]);

  useEffect(() => {
    const off = conn.onStatus((s, online) => {
      setStatus(s);
      setAppOnline(online);
      if (s === 'online' && online) load();
    });
    return off;
  }, [conn, load]);

  const agentName = (id: string) => agents.find(a => a.id === id)?.name ?? 'Agent';

  const banner =
    status === 'connecting' ? { text: 'Connecting to your Mac…', color: colors.warning } :
    status === 'offline' ? { text: 'Mac unreachable — messages wait on your phone until it reconnects', color: colors.warning } :
    !appOnline ? { text: 'Mac app is closed — messages queue in its Inbox', color: colors.warning } :
    null;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Agent Forge</Text>
        <TouchableOpacity onPress={onUnpair} hitSlop={12}>
          <Text style={styles.unpair}>Unpair</Text>
        </TouchableOpacity>
      </View>

      {banner && (
        <View style={[styles.banner, { borderColor: banner.color }]}>
          <Text style={[styles.bannerText, { color: banner.color }]}>{banner.text}</Text>
        </View>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.sectionLabel}>Agents</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.agentRow} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
        {agents.map(agent => (
          <TouchableOpacity
            key={agent.id}
            style={styles.agentChip}
            onPress={() => onOpenChat({ agent, title: agent.name })}
          >
            <Text style={styles.agentChipName}>{agent.name}</Text>
            {agent.role ? <Text style={styles.agentChipRole}>{agent.role}</Text> : null}
          </TouchableOpacity>
        ))}
        {agents.length === 0 && (
          <Text style={styles.emptyText}>{appOnline ? 'Loading agents…' : 'Agents appear when your Mac app is open'}</Text>
        )}
      </ScrollView>

      <Text style={styles.sectionLabel}>Recent chats</Text>
      <FlatList
        data={chats}
        keyExtractor={chat => chat.id}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.ink3} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 8 }}
        ListEmptyComponent={<Text style={styles.emptyText}>No chats yet — pick an agent above to start one.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.chatRow}
            onPress={() => onOpenChat({
              chatId: item.id,
              agent: agents.find(a => a.id === item.agentId) ?? null,
              title: item.name || agentName(item.agentId),
            })}
          >
            <View style={styles.chatRowTop}>
              <Text style={styles.chatName} numberOfLines={1}>{item.name || 'Chat'}</Text>
              <Text style={styles.chatAgent}>{agentName(item.agentId)}</Text>
            </View>
            {item.lastMessage ? <Text style={styles.chatPreview} numberOfLines={2}>{item.lastMessage}</Text> : null}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: 60 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  headerTitle: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  unpair: { color: colors.ink3, fontSize: 13, fontWeight: '600' },
  banner: { marginHorizontal: 16, marginBottom: 8, borderWidth: 1, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 },
  bannerText: { fontSize: 12, fontWeight: '700' },
  error: { color: colors.danger, fontSize: 12, paddingHorizontal: 16, paddingBottom: 4 },
  sectionLabel: { color: colors.ink3, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.2, paddingHorizontal: 16, marginTop: 12, marginBottom: 8 },
  agentRow: { flexGrow: 0 },
  agentChip: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.edge, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, minWidth: 110 },
  agentChipName: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  agentChipRole: { color: colors.ink3, fontSize: 11, marginTop: 2 },
  chatRow: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.edge, borderRadius: 16, padding: 14 },
  chatRowTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  chatName: { color: colors.ink, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  chatAgent: { color: colors.accent, fontSize: 11, fontWeight: '700' },
  chatPreview: { color: colors.ink3, fontSize: 12, marginTop: 4, lineHeight: 17 },
  emptyText: { color: colors.ink3, fontSize: 13, paddingHorizontal: 16, paddingVertical: 8 },
});
