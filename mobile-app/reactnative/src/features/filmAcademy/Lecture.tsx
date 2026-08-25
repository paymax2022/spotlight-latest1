// ── Lecture renderer ─────────────────────────────────────────────────────────
// A deliberately small markdown renderer covering exactly what the curriculum
// uses: headings, bold, bullet and numbered lists, tables, block quotes and
// paragraphs. Adding a markdown dependency for this subset would be a large
// amount of surface area — and shipping the lecture as raw asterisks would be
// worse than either.

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

/** Splits a line into runs, marking the **bold** ones. */
function inline(text: string): Array<{ text: string; bold: boolean }> {
  const parts: Array<{ text: string; bold: boolean }> = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), bold: false });
    parts.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), bold: false });
  return parts.length ? parts : [{ text, bold: false }];
}

function Rich({ text, style }: { text: string; style?: object }) {
  return (
    <Text style={style}>
      {inline(text).map((p, i) => (
        <Text key={i} style={p.bold ? styles.bold : undefined}>{p.text}</Text>
      ))}
    </Text>
  );
}

type Block =
  | { kind: 'h1' | 'h2' | 'h3' | 'p' | 'quote'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'table'; rows: string[][] };

function parse(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];

  const flush = () => {
    if (para.length) {
      blocks.push({ kind: 'p', text: para.join(' ').trim() });
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();

    if (!t) { flush(); continue; }

    if (t.startsWith('### ')) { flush(); blocks.push({ kind: 'h3', text: t.slice(4) }); continue; }
    if (t.startsWith('## '))  { flush(); blocks.push({ kind: 'h2', text: t.slice(3) }); continue; }
    if (t.startsWith('# '))   { flush(); blocks.push({ kind: 'h1', text: t.slice(2) }); continue; }
    if (t.startsWith('> '))   { flush(); blocks.push({ kind: 'quote', text: t.slice(2) }); continue; }

    // Table: a run of lines starting and ending with a pipe. The separator row
    // (---) carries no content and is dropped.
    if (t.startsWith('|') && t.endsWith('|')) {
      flush();
      const rows: string[][] = [];
      while (i < lines.length) {
        const r = lines[i].trim();
        if (!r.startsWith('|') || !r.endsWith('|')) break;
        const cells = r.slice(1, -1).split('|').map((c) => c.trim());
        if (!cells.every((c) => /^-{2,}$/.test(c))) rows.push(cells);
        i++;
      }
      i--;
      if (rows.length) blocks.push({ kind: 'table', rows });
      continue;
    }

    if (/^[-*] /.test(t)) {
      flush();
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i].trim())) {
        items.push(lines[i].trim().slice(2));
        i++;
      }
      i--;
      blocks.push({ kind: 'ul', items });
      continue;
    }

    if (/^\d+\. /.test(t)) {
      flush();
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s*/, ''));
        i++;
      }
      i--;
      blocks.push({ kind: 'ol', items });
      continue;
    }

    para.push(t);
  }
  flush();
  return blocks;
}

export function Lecture({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => parse(markdown), [markdown]);

  return (
    <View style={styles.wrap}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'h1': return <Rich key={i} text={b.text} style={styles.h1} />;
          case 'h2': return <Rich key={i} text={b.text} style={styles.h2} />;
          case 'h3': return <Rich key={i} text={b.text} style={styles.h3} />;
          case 'quote':
            return (
              <View key={i} style={styles.quote}>
                <Rich text={b.text} style={styles.quoteText} />
              </View>
            );
          case 'ul':
            return (
              <View key={i} style={styles.list}>
                {b.items.map((it, j) => (
                  <View key={j} style={styles.li}>
                    <Text style={styles.bullet}>•</Text>
                    <Rich text={it} style={styles.liText} />
                  </View>
                ))}
              </View>
            );
          case 'ol':
            return (
              <View key={i} style={styles.list}>
                {b.items.map((it, j) => (
                  <View key={j} style={styles.li}>
                    <Text style={styles.bullet}>{j + 1}.</Text>
                    <Rich text={it} style={styles.liText} />
                  </View>
                ))}
              </View>
            );
          case 'table':
            return (
              <View key={i} style={styles.table}>
                {b.rows.map((row, r) => (
                  <View key={r} style={[styles.tr, r === 0 && styles.trHead]}>
                    {row.map((cell, c) => (
                      <Rich key={c} text={cell} style={[styles.td, r === 0 && styles.th] as never} />
                    ))}
                  </View>
                ))}
              </View>
            );
          default:
            return <Rich key={i} text={b.text} style={styles.p} />;
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:  { gap: Spacing.sm },
  h1:    { ...Typography.headlineMd, color: Colors.onSurface, marginTop: Spacing.sm },
  h2:    { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  h3:    { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.xs },
  p:     { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22 },
  bold:  { color: Colors.onSurface, fontWeight: '700' },
  list:  { gap: 4, paddingLeft: Spacing.xs },
  li:    { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  bullet:{ ...Typography.bodyMd, color: Colors.gold, minWidth: 16 },
  liText:{ ...Typography.bodyMd, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 22 },
  quote: { borderLeftWidth: 3, borderLeftColor: Colors.gold, paddingLeft: Spacing.sm,
           paddingVertical: 4 },
  quoteText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, fontStyle: 'italic' },
  table: { borderWidth: 1, borderColor: Colors.surfaceVariant, borderRadius: Radius.sm,
           overflow: 'hidden' },
  tr:    { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.surfaceVariant },
  trHead:{ backgroundColor: Colors.surfaceVariant },
  td:    { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1, padding: Spacing.sm },
  th:    { ...Typography.labelSm, color: Colors.onSurface },
});
