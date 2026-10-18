/**
 * 自评滑块。拖动时实时显示对应的评价，松手即提交。
 * - detent：四个档位，松手吸附到最近的档位，经过档位时轻震。
 * - continuous：连续滑动，按四等分换算成档位，跨过分界时轻震。
 * 拖动轨迹（相对揭示答案的毫秒数 + 位置）全部记录下来，写进复习记录。
 */
import {
  detentPosition,
  GRADE_LABELS,
  GRADES,
  gradeFromValue,
  resolveSlider,
  snapToDetent,
  type Grade,
  type SliderMode,
  type SliderPoint,
  type SliderResult,
} from '@memo/core';
import * as Haptics from 'expo-haptics';
import { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import type { Colors } from './theme';

const THUMB = 38;
/** 两次记录轨迹点之间的最小位置变化，避免轨迹过密。 */
const TRACE_STEP = 0.01;

interface Props {
  mode: SliderMode;
  /** 揭示答案的时间，轨迹时间相对它计算。 */
  revealedAt: number;
  c: Colors;
  onCommit: (result: SliderResult, trace: SliderPoint[]) => void;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function RatingSlider({ mode, revealedAt, c, onCommit }: Props) {
  const [width, setWidth] = useState(0);
  const [value, setValue] = useState<number | null>(null);
  const pos = useRef(new Animated.Value(0.5)).current;
  const trace = useRef<SliderPoint[]>([]);
  const lastGrade = useRef<Grade | null>(null);
  const trackX = useRef(0);
  const done = useRef(false);

  const gradeOf = (v: number) => (mode === 'detent' ? snapToDetent(v) : gradeFromValue(v));
  const usable = Math.max(1, width - THUMB);

  const responder = useMemo(() => {
    const toValue = (pageX: number) => clamp01((pageX - trackX.current - THUMB / 2) / usable);

    const update = (v: number, force = false) => {
      pos.setValue(v);
      setValue(v);
      const last = trace.current[trace.current.length - 1];
      if (force || !last || Math.abs(last.v - v) >= TRACE_STEP) {
        trace.current.push({ t: Date.now() - revealedAt, v });
      }
      const g = mode === 'detent' ? snapToDetent(v) : gradeFromValue(v);
      if (g !== lastGrade.current) {
        if (lastGrade.current !== null) Haptics.selectionAsync();
        lastGrade.current = g;
      }
    };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => !done.current,
      onMoveShouldSetPanResponder: () => !done.current,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        trackX.current = e.nativeEvent.pageX - e.nativeEvent.locationX;
        update(toValue(e.nativeEvent.pageX), true);
      },
      onPanResponderMove: (_, g) => update(toValue(g.moveX)),
      onPanResponderRelease: (_, g) => {
        const raw = toValue(g.moveX || g.x0);
        update(raw, true);
        const result = resolveSlider(mode, raw);
        done.current = true;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Animated.timing(pos, { toValue: result.value, duration: 120, useNativeDriver: false }).start();
        setValue(result.value);
        setTimeout(() => onCommit(result, trace.current), 180);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, usable, revealedAt, onCommit]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const translateX = pos.interpolate({ inputRange: [0, 1], outputRange: [0, usable] });
  const fillWidth = pos.interpolate({ inputRange: [0, 1], outputRange: [THUMB, width] });
  const active = value !== null;
  const label = active ? GRADE_LABELS[gradeOf(value)] : '拖动滑块，评价刚才的回忆';

  return (
    <View style={[styles.wrap, { backgroundColor: c.surface, borderColor: c.line }]}>
      <Text style={[styles.label, { color: active ? c.accent : c.quiet }, active && styles.labelActive]}>{label}</Text>

      <View style={styles.touch} onLayout={onLayout} {...responder.panHandlers}>
        <View pointerEvents="none" style={[styles.track, { backgroundColor: c.track }]}>
          {width > 0 && (
            <Animated.View
              style={[styles.fill, { width: fillWidth, backgroundColor: c.accent, opacity: active ? 1 : 0 }]}
            />
          )}
        </View>
        {mode === 'detent' &&
          GRADES.map((g) => {
            const at = detentPosition(g);
            const covered = active && value >= at;
            return (
              <View
                key={g}
                pointerEvents="none"
                style={[
                  styles.dot,
                  {
                    left: THUMB / 2 + at * usable - DOT / 2,
                    backgroundColor: covered ? 'rgba(255,255,255,0.75)' : c.quiet,
                  },
                ]}
              />
            );
          })}
        {width > 0 && (
          <Animated.View pointerEvents="none" style={[styles.thumb, { transform: [{ translateX }] }]} />
        )}
      </View>
    </View>
  );
}

const DOT = 6;
const TRACK = 34;

const styles = StyleSheet.create({
  wrap: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 24, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 18, gap: 14 },
  label: { fontSize: 15, textAlign: 'center' },
  labelActive: { fontSize: 18, fontWeight: '700' },
  touch: { height: THUMB + 8, justifyContent: 'center' },
  track: { height: TRACK, borderRadius: TRACK / 2, overflow: 'hidden' },
  fill: { height: TRACK, borderRadius: TRACK / 2 },
  dot: { position: 'absolute', top: (THUMB + 8 - DOT) / 2, width: DOT, height: DOT, borderRadius: DOT / 2 },
  thumb: {
    position: 'absolute',
    left: 0,
    top: 4,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
});
