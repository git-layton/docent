import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { credentialStore } from './src/credentialStore';
import { AgentSummary, RelayConfig, RelayConnection } from './src/relayClient';
import { PairScreen } from './src/screens/PairScreen';
import { ChatsScreen } from './src/screens/ChatsScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { colors } from './src/theme';

const CONFIG_KEY = 'relayConfig';

type Route =
  | { name: 'loading' }
  | { name: 'pair' }
  | { name: 'chats' }
  | { name: 'chat'; chatId?: string; agent: AgentSummary | null; title: string };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'loading' });
  const connRef = useRef<RelayConnection | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const raw = await credentialStore.get(CONFIG_KEY);
        if (raw) {
          connRef.current = new RelayConnection(JSON.parse(raw));
          setRoute({ name: 'chats' });
          return;
        }
      } catch {
        // Corrupt config — fall through to pairing.
      }
      setRoute({ name: 'pair' });
    })();
    return () => connRef.current?.close();
  }, []);

  async function handlePaired(config: RelayConfig) {
    await credentialStore.set(CONFIG_KEY, JSON.stringify(config));
    connRef.current?.close();
    connRef.current = new RelayConnection(config);
    setRoute({ name: 'chats' });
  }

  async function handleUnpair() {
    await credentialStore.delete(CONFIG_KEY);
    connRef.current?.close();
    connRef.current = null;
    setRoute({ name: 'pair' });
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {route.name === 'loading' && (
        <View style={styles.loading}><ActivityIndicator color={colors.accent} size="large" /></View>
      )}
      {route.name === 'pair' && <PairScreen onPaired={handlePaired} />}
      {route.name === 'chats' && connRef.current && (
        <ChatsScreen
          conn={connRef.current}
          onOpenChat={({ chatId, agent, title }) => setRoute({ name: 'chat', chatId, agent, title })}
          onUnpair={handleUnpair}
        />
      )}
      {route.name === 'chat' && connRef.current && (
        <ChatScreen
          conn={connRef.current}
          chatId={route.chatId}
          agent={route.agent}
          title={route.title}
          onBack={() => setRoute({ name: 'chats' })}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
