/**
 * 回忆循环：回忆 → 揭示 → 自评。数据来自本地 SQLite，每次自评都写入复习记录。
 */
import {
  buildReviewLog,
  cardsInScope,
  DEFAULT_MODE,
  pickAhead,
  pickNext,
  Scheduler,
  shouldOfferPause,
  type Memory,
  type Pick,
  type SelectionContext,
  type SliderPoint,
  type SliderResult,
} from '@memo/core';
import { useSQLiteContext } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CardEditor } from './CardEditor';
import { CardView } from './CardView';
import {
  getSetting,
  loadCard,
  loadFolders,
  loadMemories,
  loadPlacements,
  loadSession,
  recordEvent,
  recordReview,
  setSetting,
  type CardContent,
  type SessionState,
} from './db/repo';
import { DEVICE, TIMEZONE } from './device';
import { LibrarySheet } from './LibrarySheet';
import { RatingSlider } from './RatingSlider';
import { SettingsSheet, type Preferences } from './SettingsSheet';
import { useSync } from './sync/SyncProvider';
import { useColors } from './theme';

type Screen = 'loading' | 'question' | 'answer' | 'pause' | 'rest' | 'empty';

const DEFAULT_PREFS: Preferences = { sliderMode: 'detent', reviewMode: DEFAULT_MODE };

export function ReviewScreen() {
  const db = useSQLiteContext();
  const { c, dark } = useColors();
  const insets = useSafeAreaInsets();
  const sync = useSync();

  const scheduler = useRef(new Scheduler({ mode: DEFAULT_PREFS.reviewMode }));
  const memories = useRef<Memory[]>([]);
  const session = useRef<SessionState>({ recentCardIds: [], newIntroducedToday: 0, picksSinceNew: 0 });
  const segment = useRef(0);
  const shownAt = useRef(0);
  const revealedAt = useRef(0);
  const ahead = useRef(false);
  /** 复习范围内的卡片；null = 全部。 */
  const scopeCards = useRef<Set<string> | null>(null);

  const [screen, setScreen] = useState<Screen>('loading');
  const [pick, setPick] = useState<Pick | null>(null);
  const [content, setContent] = useState<CardContent | null>(null);
  const [editor, setEditor] = useState<{ cardId?: string } | null>(null);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [scope, setScope] = useState<{ id: string; name: string } | null>(null);
  const scopeId = useRef<string | null>(null);

  const ctx = useCallback(
    (now = Date.now()): SelectionContext => ({ now, scheduler: scheduler.current, ...session.current }),
    [],
  );
  const current = pick ? memories.current.find((m) => m.id === pick.memoryId) : undefined;
  /** 当前复习范围内的记忆。 */
  const pool = useCallback(
    () => (scopeCards.current ? memories.current.filter((m) => scopeCards.current!.has(m.cardId)) : memories.current),
    [],
  );

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
    const folders = await loadFolders(db);
    const folder = scopeId.current ? folders.find((f) => f.id === scopeId.current) : undefined;
    if (!folder) scopeId.current = null;
    scopeCards.current = cardsInScope(folders, await loadPlacements(db), scopeId.current);
    setScope(folder ? { id: folder.id, name: folder.name } : null);
  }, [db]);

  useEffect(() => {
    (async () => {
      await recordEvent(db, { type: 'app_open' }, DEVICE);
      const loaded: Preferences = {
        sliderMode: await getSetting(db, 'sliderMode', DEFAULT_PREFS.sliderMode),
        reviewMode: await getSetting(db, 'reviewMode', DEFAULT_PREFS.reviewMode),
      };
      scheduler.current = new Scheduler({ mode: loaded.reviewMode });
      scopeId.current = await getSetting<string | null>(db, 'scopeFolderId', null);
      setPrefs(loaded);
      await reload();
      await show(pickNext(pool(), ctx()));
    })();
  }, [db, reload, show, ctx, pool]);

  const changePrefs = async (next: Partial<Preferences>) => {
    setPrefs((p) => ({ ...p, ...next }));
    if (next.reviewMode) scheduler.current = new Scheduler({ mode: next.reviewMode });
    for (const [key, value] of Object.entries(next)) await setSetting(db, key, value, DEVICE);
  };

  const closeSettings = async () => {
    setSettingsOpen(false);
    // 换了复习模式后，空闲页面可能已经有该复习的内容了。
    if (screen === 'empty') await show(pickNext(pool(), ctx()));
  };

  const reveal = () => {
    revealedAt.current = Date.now();
    setScreen('answer');
  };

  const rate = useCallback(
    async (slider: SliderResult, sliderTrace: SliderPoint[]) => {
      if (!current || !pick || !content) return;
      const now = Date.now();
      const outcome = scheduler.current.review(current.state, slider.grade, now);
      const log = buildReviewLog(
        {
          memoryId: current.id,
          cardId: current.cardId,
          cardVersion: content.card.version,
          device: DEVICE,
          timezone: TIMEZONE,
          scopeFolderId: scopeId.current,
          pickKind: ahead.current ? 'ahead' : pick.kind,
          entry: 'app',
          offline: !sync.session || sync.status?.state === 'error',
          shownAt: shownAt.current,
          revealedAt: revealedAt.current,
          ratedAt: now,
          slider,
          sliderTrace,
        },
        outcome,
        scheduler.current,
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

      const next = pickNext(pool(), ctx(now));
      if (shouldOfferPause(segment.current, next !== null)) {
        await recordEvent(db, { type: 'segment_end', reviewed: segment.current }, DEVICE);
        setPick(next);
        setScreen('pause');
      } else {
        await show(next);
      }
    },
    [current, pick, content, db, ctx, show, pool, sync.session, sync.status?.state],
  );

  const keepGoing = async () => {
    await recordEvent(db, { type: 'pause_choice', choice: 'continue' }, DEVICE);
    segment.current = 0;
    await show(pickNext(pool(), ctx()));
  };

  const stop = async () => {
    await recordEvent(db, { type: 'pause_choice', choice: 'stop' }, DEVICE);
    setScreen('rest');
  };

  const reviewAhead = async () => {
    ahead.current = true;
    await show(pickAhead(pool(), ctx()));
  };

  const closeEditor = async (changed: boolean) => {
    setEditor(null);
    if (!changed) return;
    await reload();
    await refreshCurrent();
  };

  /** 数据或范围变了：当前题还在范围内就留着（内容可能被改过），否则换下一题。 */
  const refreshCurrent = async () => {
    const stillThere = pick && pool().some((m) => m.id === pick.memoryId);
    if ((screen === 'question' || screen === 'answer') && stillThere && current) {
      setContent(await loadCard(db, current.cardId));
    } else if (screen !== 'rest' && screen !== 'pause') {
      await show(pickNext(pool(), ctx()));
    }
  };

  const changeScope = async (folderId: string | null) => {
    scopeId.current = folderId;
    await setSetting(db, 'scopeFolderId', folderId, DEVICE);
    await recordEvent(db, { type: 'scope_changed', folderId }, DEVICE);
    await reload();
  };

  // 其他设备的改动同步过来后，重新读取数据。
  const firstVersion = useRef(sync.version);
  useEffect(() => {
    if (sync.version === firstVersion.current || screen === 'loading') return;
    firstVersion.current = sync.version;
    reload().then(refreshCurrent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.version]);

  const closeLibrary = async () => {
    setLibraryOpen(false);
    await reload();
    await refreshCurrent();
  };

  return (
    <View style={[styles.root, { backgroundColor: c.bg, paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}>
      <StatusBar style={dark ? 'light' : 'dark'} />

      <View style={styles.top}>
        <View style={styles.topLeft}>
          <Pressable hitSlop={12} onPress={() => setLibraryOpen(true)}>
            <Text style={[styles.corner, { color: c.quiet }]}>卡片库</Text>
          </Pressable>
          <Pressable hitSlop={12} onPress={() => setSettingsOpen(true)}>
            <Text style={[styles.corner, { color: c.quiet }]}>设置</Text>
          </Pressable>
        </View>
        <View style={styles.topRight}>
          {screen === 'answer' && content && (
            <Pressable hitSlop={12} onPress={() => setEditor({ cardId: content.card.id })}>
              <Text style={[styles.corner, { color: c.quiet }]}>编辑</Text>
            </Pressable>
          )}
          <Pressable hitSlop={12} onPress={() => setEditor({})}>
            <Text style={[styles.plus, { color: c.quiet }]}>＋</Text>
          </Pressable>
        </View>
      </View>

      {scope && (
        <Pressable style={styles.scope} hitSlop={8} onPress={() => changeScope(null).then(refreshCurrent)}>
          <Text style={[styles.scopeText, { color: c.accent }]} numberOfLines={1}>
            只复习「{scope.name}」 ×
          </Text>
        </Pressable>
      )}

      {(screen === 'question' || screen === 'answer') && content && current && (
        <Pressable style={styles.card} onPress={screen === 'question' ? reveal : undefined}>
          <CardView blocks={content.blocks} masks={current.masks} revealed={screen === 'answer'} c={c} />
          {screen === 'question' && <Text style={[styles.hint, { color: c.quiet }]}>想一想，然后轻点屏幕</Text>}
        </Pressable>
      )}

      {screen === 'answer' && (
        <RatingSlider
          key={`${pick?.memoryId}-${shownAt.current}`}
          mode={prefs.sliderMode}
          revealedAt={revealedAt.current}
          c={c}
          onCommit={rate}
        />
      )}

      {screen === 'pause' && (
        <View style={styles.card}>
          <Text style={[styles.title, { color: c.ink }]}>这一小段完成了。</Text>
          <View style={styles.row}>
            <Pressable style={[styles.button, { borderColor: c.line }]} onPress={stop}>
              <Text style={[styles.buttonText, { color: c.ink }]}>到此为止</Text>
            </Pressable>
            <Pressable style={[styles.button, { borderColor: c.line }]} onPress={keepGoing}>
              <Text style={[styles.buttonText, { color: c.ink }]}>继续学一会</Text>
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
          {pool().length === 0 ? (
            <>
              <Text style={[styles.hint, { color: c.quiet }]}>{scope ? '这个文件夹里还没有卡片。' : '还没有卡片。'}</Text>
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

      <Modal visible={libraryOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeLibrary}>
        <LibrarySheet c={c} scope={scope?.id ?? null} onScope={changeScope} onClose={closeLibrary} />
      </Modal>

      <Modal visible={settingsOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeSettings}>
        <SettingsSheet prefs={prefs} c={c} onChange={changePrefs} onClose={closeSettings} />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 48 },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  scope: { alignSelf: 'flex-start', paddingVertical: 4 },
  scopeText: { fontSize: 14 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  corner: { fontSize: 15 },
  plus: { fontSize: 26, fontWeight: '300' },
  card: { flex: 1, justifyContent: 'center', gap: 24 },
  title: { fontSize: 26, fontWeight: '600', lineHeight: 36 },
  hint: { fontSize: 15 },
  link: { fontSize: 17, fontWeight: '500' },
  row: { flexDirection: 'row', gap: 12 },
  button: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonText: { fontSize: 14 },
});
