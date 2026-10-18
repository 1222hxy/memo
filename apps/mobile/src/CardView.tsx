/**
 * 显示一张卡的内容块。被当前记忆遮住的块，在揭示前不显示。
 * 目前只渲染文字；公式、图片、手写等以后由 packages/render 接管。
 */
import type { Block, MaskTarget } from '@memo/core';
import { StyleSheet, Text, View } from 'react-native';

import type { Colors } from './theme';

interface Props {
  blocks: Block[];
  masks: MaskTarget[];
  revealed: boolean;
  c: Colors;
}

export function CardView({ blocks, masks, revealed, c }: Props) {
  const masked = new Set(masks.map((m) => m.blockId));
  return (
    <View style={styles.wrap}>
      {blocks.map((b, i) => {
        const hidden = masked.has(b.id);
        if (hidden && !revealed) return null;
        return (
          <Text key={b.id} style={[i === 0 ? styles.first : styles.rest, { color: c.ink }]}>
            {b.content}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 24 },
  first: { fontSize: 26, fontWeight: '600', lineHeight: 36 },
  rest: { fontSize: 20, lineHeight: 30 },
});
