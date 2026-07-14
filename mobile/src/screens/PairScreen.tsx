import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { claimPairing, RelayConfig, QrPayload } from '../relayClient';
import { colors } from '../theme';

const DEFAULT_PORT = 8765;

export function PairScreen({ onPaired }: { onPaired: (config: RelayConfig) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<'scan' | 'manual'>('scan');
  const [host, setHost] = useState('');
  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState(Platform.OS === 'ios' ? 'iPhone' : 'Android phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function pair(hosts: string[], port: number, pairCode: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const config = await claimPairing(hosts, port, pairCode.trim().toUpperCase(), deviceName.trim() || 'Phone');
      onPaired(config);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  function handleScan(data: string) {
    if (busy) return;
    try {
      const payload: QrPayload = JSON.parse(data);
      if (!payload?.code || !Array.isArray(payload.hosts) || payload.hosts.length === 0) return;
      pair(payload.hosts, payload.port || DEFAULT_PORT, payload.code);
    } catch {
      // Not our QR — keep scanning.
    }
  }

  const scanReady = permission?.granted && mode === 'scan';

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.title}>Agent Forge</Text>
      <Text style={styles.subtitle}>
        Pair with your Mac: open Settings → Connect → Mobile Companion and tap “Pair a Phone”.
      </Text>

      {scanReady ? (
        <View style={styles.cameraWrap}>
          <CameraView
            style={StyleSheet.absoluteFill}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => handleScan(data)}
          />
          {busy && (
            <View style={styles.cameraOverlay}>
              <ActivityIndicator color={colors.accent} size="large" />
            </View>
          )}
        </View>
      ) : mode === 'scan' ? (
        <View style={styles.permissionBox}>
          <Text style={styles.bodyText}>Camera access is needed to scan the pairing QR code.</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission}>
            <Text style={styles.primaryBtnText}>Allow camera</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.form}>
          <Text style={styles.label}>Mac address</Text>
          <TextInput
            style={styles.input}
            value={host}
            onChangeText={setHost}
            placeholder="my-mac.local or Tailscale name"
            placeholderTextColor={colors.ink3}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.label}>Pairing code</Text>
          <TextInput
            style={[styles.input, styles.codeInput]}
            value={code}
            onChangeText={setCode}
            placeholder="ABCD2345"
            placeholderTextColor={colors.ink3}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
          />
          <Text style={styles.label}>This device's name</Text>
          <TextInput
            style={styles.input}
            value={deviceName}
            onChangeText={setDeviceName}
            placeholderTextColor={colors.ink3}
          />
          <TouchableOpacity
            style={[styles.primaryBtn, (!host.trim() || code.trim().length < 8 || busy) && styles.btnDisabled]}
            disabled={!host.trim() || code.trim().length < 8 || busy}
            onPress={() => pair([host.trim()], DEFAULT_PORT, code)}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Pair</Text>}
          </TouchableOpacity>
        </View>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity onPress={() => { setMode(mode === 'scan' ? 'manual' : 'scan'); setError(''); }}>
        <Text style={styles.switchMode}>
          {mode === 'scan' ? 'Enter code manually instead' : 'Scan QR code instead'}
        </Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800', letterSpacing: 0.5 },
  subtitle: { color: colors.ink3, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  cameraWrap: { width: 260, height: 260, borderRadius: 24, overflow: 'hidden', borderWidth: 2, borderColor: colors.accent },
  cameraOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(11,12,15,0.6)', alignItems: 'center', justifyContent: 'center' },
  permissionBox: { alignItems: 'center', gap: 12, padding: 24 },
  form: { width: '100%', gap: 8 },
  label: { color: colors.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginTop: 8 },
  input: { backgroundColor: colors.inset, borderWidth: 1, borderColor: colors.edge, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: colors.ink, fontSize: 15 },
  codeInput: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', letterSpacing: 6, textAlign: 'center', fontSize: 18 },
  primaryBtn: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  btnDisabled: { opacity: 0.4 },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  bodyText: { color: colors.ink2, fontSize: 14, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 13, textAlign: 'center' },
  switchMode: { color: colors.accent, fontSize: 14, fontWeight: '600', padding: 8 },
});
