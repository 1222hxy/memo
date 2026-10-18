/**
 * 设置：自评方式（每台设备各自的）和复习模式。
 */
import { MODES, type ReviewMode, type SliderMode } from '@memo/core';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Colors } from './theme';

export interface Preferences {
  sliderMode: SliderMode;
  reviewMode: ReviewMode;
}

interface Props {
  prefs: Preferences;
  c: Colors;
  onChange: (next: Partial<Preferences>) => void;
  onClose: () => void;
}

interface Option<T> {
  value: T;
  label: string;
  note: string;
}

const SLIDER_OPTIONS: Option<SliderMode>[] = [
  { value: 'detent', label: '四个档位', note: '滑块停在四个位置之一' },
  { value: 'continuous', label: '连续滑动', note: '可以停在任何位置，更细地表达把握程度' },
];

const MODE_OPTIONS: Option<ReviewMode>[] = (['relaxed', 'steady', 'sprint'] as const).map((m) => ({
  value: m,
  label: MODES[m].label,
  note: `目标记住约 ${Math.round(MODES[m].targetRetention * 100)}%`,
}));

export function SettingsSheet({ prefs, c, onChange, onClose }: Props) {
  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <View style={[styles.bar, { borderColor: c.line }]}>
        <View style={styles.side} />
        <Text style={[styles.title, { color: c.ink }]}>设置</Text>
        <Pressable style={styles.side} hitSlop={12} onPress={onClose}>
          <Text style={[styles.done, { color: c.ink }]}>完成</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        <Group
          title="自评方式"
          footer="只影响这台设备。"
          options={SLIDER_OPTIONS}
          selected={prefs.sliderMode}
          c={c}
          onSelect={(sliderMode) => onChange({ sliderMode })}
        />
        <Group
          title="复习模式"
          footer="目标越高，复习越频繁。随时可以换，立刻生效。"
          options={MODE_OPTIONS}
          selected={prefs.reviewMode}
          c={c}
          onSelect={(reviewMode) => onChange({ reviewMode })}
        />
      </View>
    </View>
  );
}

function Group<T extends string>(props: {
  title: string;
  footer: string;
  options: Option<T>[];
  selected: T;
  c: Colors;
  onSelect: (v: T) => void;
}) {
  const { c } = props;
  return (
    <View style={styles.group}>
      <Text style={[styles.groupTitle, { color: c.quiet }]}>{props.title}</Text>
      <View style={[styles.box, { borderColor: c.line }]}>
        {props.options.map((o, i) => (
          <Pressable
            key={o.value}
            onPress={() => props.onSelect(o.value)}
            style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.line }]}
          >
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, { color: c.ink }]}>{o.label}</Text>
              <Text style={[styles.rowNote, { color: c.quiet }]}>{o.note}</Text>
            </View>
            <Text style={[styles.check, { color: c.ink }]}>{o.value === props.selected ? '✓' : ''}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[styles.footer, { color: c.quiet }]}>{props.footer}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  side: { width: 48, alignItems: 'flex-end' },
  title: { fontSize: 16, fontWeight: '600' },
  done: { fontSize: 16, fontWeight: '600' },
  body: { padding: 20, gap: 28 },
  group: { gap: 8 },
  groupTitle: { fontSize: 13 },
  box: { borderWidth: 1, borderRadius: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 16 },
  rowNote: { fontSize: 13 },
  check: { fontSize: 17, width: 24, textAlign: 'right' },
  footer: { fontSize: 13 },
});
