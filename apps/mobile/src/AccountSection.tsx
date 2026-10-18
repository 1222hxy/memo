/**
 * 设置里的「云同步」：用邮箱和密码登录，显示同步状态。
 * 不发邮件，所以不需要配置邮件服务（SMTP）。
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useSync } from './sync/SyncProvider';
import type { Colors } from './theme';

function ago(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 10) return '刚刚';
  if (s < 60) return `${s} 秒前`;
  if (s < 3600) return `${Math.round(s / 60)} 分钟前`;
  return new Date(t).toLocaleString();
}

export function AccountSection({ c }: { c: Colors }) {
  const { configured, session, status, syncNow, signIn, signUp, signOut } = useSync();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = email.includes('@') && password.length >= 6;
  const run = async (task: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    const err = await task();
    setBusy(false);
    if (err) setError(err);
  };

  let body;
  if (!configured) {
    body = <Text style={[styles.note, { color: c.quiet }]}>还没有配置云端，数据只保存在这台设备上。</Text>;
  } else if (session) {
    const line =
      status?.state === 'syncing'
        ? '正在同步…'
        : status?.state === 'error'
          ? `同步出错：${status.error}`
          : status?.lastSyncedAt
            ? `已同步 · ${ago(status.lastSyncedAt)}`
            : '准备同步…';
    body = (
      <>
        <Text style={[styles.value, { color: c.ink }]}>{session.user.email}</Text>
        <Text style={[styles.note, { color: status?.state === 'error' ? c.danger : c.quiet }]}>
          {line}
          {status && status.pending > 0 ? ` · 还有 ${status.pending} 条改动待上传` : ''}
        </Text>
        <View style={styles.actions}>
          <Pressable onPress={syncNow} hitSlop={8}>
            <Text style={[styles.action, { color: c.accent }]}>立即同步</Text>
          </Pressable>
          <Pressable onPress={signOut} hitSlop={8}>
            <Text style={[styles.action, { color: c.quiet }]}>退出登录</Text>
          </Pressable>
        </View>
      </>
    );
  } else {
    body = (
      <>
        <Text style={[styles.note, { color: c.quiet }]}>
          登录后，卡片和复习记录会在你的设备之间同步。第一次用先点「注册」，其他设备用同一个账号登录。
        </Text>
        <TextInput
          style={[styles.input, { color: c.ink, borderColor: c.line }]}
          value={email}
          onChangeText={setEmail}
          placeholder="邮箱"
          placeholderTextColor={c.quiet}
          keyboardType="email-address"
          textContentType="username"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          style={[styles.input, { color: c.ink, borderColor: c.line }]}
          value={password}
          onChangeText={setPassword}
          placeholder="密码（至少 6 位）"
          placeholderTextColor={c.quiet}
          secureTextEntry
          textContentType="password"
          autoCapitalize="none"
        />
        <View style={styles.actions}>
          <Pressable disabled={busy || !ready} onPress={() => run(() => signIn(email.trim(), password))}>
            <Text style={[styles.action, { color: ready ? c.accent : c.line }]}>登录</Text>
          </Pressable>
          <Pressable disabled={busy || !ready} onPress={() => run(() => signUp(email.trim(), password))}>
            <Text style={[styles.action, { color: ready ? c.ink : c.line }]}>注册</Text>
          </Pressable>
        </View>
      </>
    );
  }

  return (
    <View style={styles.group}>
      <Text style={[styles.title, { color: c.quiet }]}>云同步</Text>
      <View style={[styles.box, { borderColor: c.line }]}>
        {body}
        {busy && <ActivityIndicator style={styles.spinner} />}
        {error && <Text style={[styles.note, { color: c.danger }]}>{error}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  title: { fontSize: 13 },
  box: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 10 },
  value: { fontSize: 16 },
  note: { fontSize: 13, lineHeight: 19 },
  input: { fontSize: 16, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  actions: { flexDirection: 'row', gap: 24 },
  action: { fontSize: 15, fontWeight: '500' },
  spinner: { alignSelf: 'flex-start' },
});
