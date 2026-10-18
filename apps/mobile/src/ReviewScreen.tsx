/**
 * 回忆循环：回忆 → 揭示 → 自评。数据来自本地 SQLite，每次自评都写入复习记录。
 * 评分暂时还是四个按钮，下一步换成滑块。
 */
import {
  buildReviewLog,
  detentPosition,
  GRADE_LABELS,
  GRADES,
  pickAhead,
  pickNext,
  resolveSlider,
  Scheduler,
  shouldOfferPause,
  type Grade,
  type Memory,
  type Pick,
  type SelectionContext,
} from '@memo/core';
import * as Haptics from 'expo-haptics';
import { useSQLiteContext } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CardEditor } from './CardEditor';
import { CardView } from './CardView';
import {
  loadCard,
  loadMemories,
  loadSession,
  recordEvent,
  recordReview,
  type CardContent,
  type SessionState,
} from './db/repo';
import { DEVICE, TIMEZONE } from './device';
import { useColors } from './theme';

type Screen = 'loading' | 'question' | 'answer' | 'pause' | 'rest' | 'empty';

export function ReviewScreen() {
  const db = useSQLiteContext();
  const { c, dark } = useColors();
  const insets = useSafeAreaInsets();
  const scheduler = useMemo(() => new Scheduler({ mode: 'steady' }), []);

  const memories = useRef<Memory[]>([]);
  const session = useRef<SessionState>({ recentCardIds: [], newIntroducedToday: 0, picksSinceNew: 0 });
  const segment = useRef(0);
  const shownAt = useRef(0);
  const revealedAt = useRef(0);
  const ahead = useRef(false);

  const [screen, setScreen] = useState<Screen>('loading');
  const [pick, setPick] = useState<Pick | null>(null);
  const [content, setContent] = useState<CardContent | null>(null);
  const [editor, setEditor] = useState<{ cardId?: string } | null>(null);

  const ctx = useCallback(
    (now = Date.now()): SelectionContext => ({ now, scheduler, ...session.current }),
    [scheduler],
  );
  const current = pick ? memories.current.find((m) => m.id === pick.memoryId) : undefined;

  const show = useCallback(
    async (next: Pick | null) => {
      const memory = next && memories.current.find((m) => m.id === next.memoryId);
      const card = memory ? await loadCard(db, memory.cardId) : null;
      setPick(card ? next : null);
      setContent(card);
      setScreen(card ? 'question' : 'empty');
      shownAt.current = Date.now();
    },
    [db],
  );

  const reload = useCallback(async () => {
    memories.current = await loadMemories(db);
    session.current = await loadSession(db, Date.now());
  }, [db]);

  useEffect(() => {
    (async () => {
      await recordEvent(db, { type: 'app_open' }, DEVICE);
      await reload();
      await show(pickNext(memories.current, ctx()));
    })();
  }, [db, reload, show, ctx]);

  const reveal = () => {
    revealedAt.current = Date.now();
    setScreen('answer');
  };

  const rate = async (grade: Grade) => {
    if (!current || !pick || !content) return;
    Haptics.selectionAsync();
    const now = Date.now();
    const outcome = scheduler.review(current.state, grade, now);
    const log = buildReviewLog(
      {
        memoryId: current.id,
        cardId: current.cardId,
        cardVersion: content.card.version,
        device: DEVICE,
        timezone: TIMEZONE,
        scopeFolderId: null,
        pickKind: ahead.current ? 'ahead' : pick.kind,
        entry: 'app',
        offline: true,
        shownAt: shownAt.current,
        revealedAt: revealedAt.current,
        ratedAt: now,
        slider: resolveSlider('detent', detentPosition(grade)),
        sliderTrace: [],
      },
      outcome,
      scheduler,
    );
    await recordReview(db, log, now);
    ahead.current = false;

    memories.current = memories.current.map((m) =>
      m.id === current.id ? { ...m, state: outcome.after, introducedAt: m.introducedAt ?? now } : m,
    );
    const s = session.current;
    session.current = {
      recentCardIds: [current.cardId, ...s.recentCardIds].slice(0, 10),
      newIntroducedToday: s.newIntroducedToday + (pick.kind === 'new' ? 1 : 0),
      picksSinceNew: pick.kind === 'new' ? 0 : s.picksSinceNew + 1,
    };
    segment.current += 1;

    const next = pickNext(memories.current, ctx(now));
    if (shouldOfferPause(segment.current, next !== null)) {
      await recordEvent(db, { type: 'segment_end', reviewed: segment.current }, DEVICE);
      setPick(next);
      setScreen('pause');
    } else {
      await show(next);
    }
  };

  const keepGoing = async () => {
    await recordEvent(db, { type: 'pause_choice', choice: 'continue' }, DEVICE);
    segment.current = 0;
    await show(pickNext(memories.current, ctx()));
  };

  const stop = async () => {
    await recordEvent(db, { type: 'pause_choice', choice: 'stop' }, DEVICE);
    setScreen('rest');
  };

  const reviewAhead = async () => {
    ahead.current = true;
    await show(pickAhead(memories.current, ctx()));
  };

  const closeEditor = async (changed: boolean) => {
    setEditor(null);
    if (!changed) return;
    await reload();
    const stillThere = pick && memories.current.some((m) => m.id === pick.memoryId);
    if ((screen === 'question' || screen === 'answer') && stillThere && current) {
      setContent(await loadCard(db, current.cardId));
    } else if (screen !== 'rest' && screen !== 'pause') {
      await show(pickNext(memories.current, ctx()));
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: c.bg, paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}>
      <StatusBar style={dark ? 'light' : 'dark'} />

      <View style={styles.top}>
        {screen === 'answer' && content ? (
          <Pressable hitSlop={12} onPress={() => setEditor({ cardId: content.card.id })}>
            <Text style={[styles.corner, { color: c.quiet }]}>编辑</Text>
          </Pressable>
        ) : (
          <View />
        )}
        <Pressable hitSlop={12} onPress={() => setEditor({})}>
          <Text style={[styles.plus, { color: c.quiet }]}>＋</Text>
        </Pressable>
      </View>

      {(screen === 'question' || screen === 'answer') && content && current && (
        <Pressable style={styles.card} onPress={screen === 'question' ? reveal : undefined}>
          <CardView blocks={content.blocks} masks={current.masks} revealed={screen === 'answer'} c={c} />
          {screen === 'question' && <Text style={[styles.hint, { color: c.quiet }]}>想一想，然后轻点屏幕</Text>}
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
          <Text style={[styles.title, { color: c.ink }]}>这一小段完成了。</Text>
          <View style={styles.row}>
            <Pressable style={[styles.grade, { borderColor: c.line }]} onPress={stop}>
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
          {memories.current.length === 0 ? (
            <>
              <Text style={[styles.hint, { color: c.quiet }]}>还没有卡片。</Text>
              <Pressable onPress={() => setEditor({})}>
                <Text style={[styles.link, { color: c.ink }]}>写第一张</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={[styles.hint, { color: c.quiet }]}>卡片都还记得，现在不用回忆。</Text>
              <Pressable onPress={reviewAhead}>
                <Text style={[styles.link, { color: c.ink }]}>再看看</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      <Modal
        visible={editor !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => closeEditor(false)}
      >
        {editor && <CardEditor cardId={editor.cardId} c={c} onClose={closeEditor} />}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 48 },
  corner: { fontSize: 15 },
  plus: { fontSize: 26, fontWeight: '300' },
  card: { flex: 1, justifyContent: 'center', gap: 24 },
  title: { fontSize: 26, fontWeight: '600', lineHeight: 36 },
  hint: { fontSize: 15 },
  link: { fontSize: 17, fontWeight: '500' },
  grades: { flexDirection: 'row', gap: 8 },
  row: { flexDirection: 'row', gap: 12 },
  grade: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  gradeText: { fontSize: 14 },
});
