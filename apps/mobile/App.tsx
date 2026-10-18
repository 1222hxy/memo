/**
 * 第一个可运行的回忆循环：回忆 → 揭示 → 自评，全部由 @memo/core 驱动。
 * 目前数据在内存里、评分用四个按钮；下一步换成滑块、接入本地 SQLite 和同步。
 */
import {
  buildReviewLog,
  GRADE_LABELS,
  GRADES,
  newId,
  newMemoryState,
  pickAhead,
  pickNext,
  resolveSlider,
  Scheduler,
  shouldOfferPause,
  detentPosition,
  type Grade,
  type Memory,
  type Pick,
} from '@memo/core';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';

const SAMPLES = [
  { q: '矩阵可逆的充要条件是什么？', a: '行列式不为 0。\n等价于：满秩，0 不是它的特征值。' },
  { q: 'ephemeral', a: '短暂的，转瞬即逝的' },
  { q: '导数的定义', a: "f'(x) = lim(h→0) [f(x+h) − f(x)] / h" },
  { q: '主动回忆为什么比重复阅读有效？', a: '提取本身会强化记忆（测试效应）。' },
];

type Screen = 'question' | 'answer' | 'pause' | 'rest' | 'empty';

function initialMemories(): { memories: Memory[]; text: Record<string, (typeof SAMPLES)[number]> } {
  const text: Record<string, (typeof SAMPLES)[number]> = {};
  const memories = SAMPLES.map((s, i) => {
    const cardId = newId();
    text[cardId] = s;
    return { id: newId(), cardId, masks: [], state: newMemoryState(), introducedAt: null, createdAt: Date.now() + i };
  });
  return { memories, text };
}

export default function App() {
  const dark = useColorScheme() === 'dark';
  const c = dark ? colors.dark : colors.light;
  const scheduler = useMemo(() => new Scheduler({ mode: 'steady' }), []);
  const [{ memories, text }, setData] = useState(initialMemories);

  const [recentCardIds, setRecent] = useState<string[]>([]);
  const [newToday, setNewToday] = useState(0);
  const [picksSinceNew, setPicksSinceNew] = useState(0);
  const [segmentCount, setSegmentCount] = useState(0);

  const ctxFor = (now: number, recent = recentCardIds, introduced = newToday, sinceNew = picksSinceNew) => ({
    now,
    scheduler,
    recentCardIds: recent,
    newIntroducedToday: introduced,
    picksSinceNew: sinceNew,
  });

  const [pick, setPick] = useState<Pick | null>(() => pickNext(memories, ctxFor(Date.now())));
  const [screen, setScreen] = useState<Screen>(pick ? 'question' : 'empty');
  const [shownAt, setShownAt] = useState(Date.now());
  const [revealedAt, setRevealedAt] = useState(0);

  const current = pick ? memories.find((m) => m.id === pick.memoryId) : undefined;
  const content = current ? text[current.cardId] : undefined;

  const show = (next: Pick | null) => {
    setPick(next);
    setScreen(next ? 'question' : 'empty');
    setShownAt(Date.now());
  };

  const reveal = () => {
    setRevealedAt(Date.now());
    setScreen('answer');
  };

  const rate = (grade: Grade) => {
    if (!current || !pick) return;
    Haptics.selectionAsync();
    const now = Date.now();
    const outcome = scheduler.review(current.state, grade, now);
    const log = buildReviewLog(
      {
        memoryId: current.id,
        cardId: current.cardId,
        cardVersion: 1,
        device: Platform.OS === 'ios' && Platform.isPad ? 'ipad' : 'iphone',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        scopeFolderId: null,
        pickKind: pick.kind,
        entry: 'app',
        offline: true,
        shownAt,
        revealedAt,
        ratedAt: now,
        slider: resolveSlider('detent', detentPosition(grade)),
        sliderTrace: [],
      },
      outcome,
      scheduler,
    );
    // TODO: 写入本地 SQLite（只增不改），由 PowerSync 同步到 Supabase。
    console.log('review', log.grade, log.thinkMs, log.stateAfter.phase);

    const updated = memories.map((m) =>
      m.id === current.id ? { ...m, state: outcome.after, introducedAt: m.introducedAt ?? now } : m,
    );
    const recent = [current.cardId, ...recentCardIds].slice(0, 10);
    const introduced = newToday + (pick.kind === 'new' ? 1 : 0);
    const sinceNew = pick.kind === 'new' ? 0 : picksSinceNew + 1;
    const count = segmentCount + 1;
    setData({ memories: updated, text });
    setRecent(recent);
    setNewToday(introduced);
    setPicksSinceNew(sinceNew);
    setSegmentCount(count);

    const next = pickNext(updated, ctxFor(now, recent, introduced, sinceNew));
    if (shouldOfferPause(count, next !== null)) {
      setPick(next);
      setScreen('pause');
    } else {
      show(next);
    }
  };

  const keepGoing = () => {
    setSegmentCount(0);
    show(pick ?? pickNext(memories, ctxFor(Date.now())));
  };

  const reviewAhead = () => show(pickAhead(memories, ctxFor(Date.now())));

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar style={dark ? 'light' : 'dark'} />

      {(screen === 'question' || screen === 'answer') && content && (
        <Pressable style={styles.card} onPress={screen === 'question' ? reveal : undefined}>
          <Text style={[styles.question, { color: c.ink }]}>{content.q}</Text>
          {screen === 'answer' ? (
            <Text style={[styles.answer, { color: c.ink }]}>{content.a}</Text>
          ) : (
            <Text style={[styles.hint, { color: c.quiet }]}>想一想，然后轻点屏幕</Text>
          )}
        </Pressable>
      )}

      {screen === 'answer' && (
        <View style={styles.grades}>
          {GRADES.map((g) => (
            <Pressable key={g} style={[styles.grade, { borderColor: c.line }]} onPress={() => rate(g)}>
              <Text style={[styles.gradeText, { color: c.ink }]}>{GRADE_LABELS[g]}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {screen === 'pause' && (
        <View style={styles.card}>
          <Text style={[styles.question, { color: c.ink }]}>这一小段完成了。</Text>
          <View style={styles.row}>
            <Pressable style={[styles.grade, { borderColor: c.line }]} onPress={() => setScreen('rest')}>
              <Text style={[styles.gradeText, { color: c.ink }]}>到此为止</Text>
            </Pressable>
            <Pressable style={[styles.grade, { borderColor: c.line }]} onPress={keepGoing}>
              <Text style={[styles.gradeText, { color: c.ink }]}>继续学一会</Text>
            </Pressable>
          </View>
        </View>
      )}

      {screen === 'rest' && (
        <View style={styles.card}>
          <Text style={[styles.hint, { color: c.quiet }]}>随时回来。</Text>
          <Pressable onPress={keepGoing}>
            <Text style={[styles.link, { color: c.ink }]}>继续学一会</Text>
          </Pressable>
        </View>
      )}

      {screen === 'empty' && (
        <View style={styles.card}>
          <Text style={[styles.hint, { color: c.quiet }]}>现在没有需要回忆的内容。</Text>
          <Pressable onPress={reviewAhead}>
            <Text style={[styles.link, { color: c.ink }]}>再看看</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const colors = {
  light: { bg: '#FAFAF7', ink: '#1C1C1E', quiet: '#8E8E93', line: '#D8D8D2' },
  dark: { bg: '#111113', ink: '#F2F2F0', quiet: '#8E8E93', line: '#3A3A3C' },
};

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24, paddingTop: 96, paddingBottom: 48 },
  card: { flex: 1, justifyContent: 'center', gap: 24 },
  question: { fontSize: 26, fontWeight: '600', lineHeight: 36 },
  answer: { fontSize: 20, lineHeight: 30 },
  hint: { fontSize: 15 },
  link: { fontSize: 17, fontWeight: '500' },
  grades: { flexDirection: 'row', gap: 8 },
  row: { flexDirection: 'row', gap: 12 },
  grade: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  gradeText: { fontSize: 14 },
});
