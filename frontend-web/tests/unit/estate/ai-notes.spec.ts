/**
 * AI meeting-notes summariser (Block 39 / 47b) — pure-function tests.
 * The summariser is deterministic and dependency-free, so no mocks are needed.
 */
import { describe, it, expect } from 'vitest';
import { summariseMinutes } from '@/src/server/estate/ai-notes';

describe('summariseMinutes', () => {
  it('returns a graceful placeholder for empty minutes', () => {
    const { summary, actionItems } = summariseMinutes('', []);
    expect(summary).toMatch(/no minutes/i);
    expect(actionItems).toEqual([]);
  });

  it('limits the summary to at most N sentences', () => {
    const text = 'The estate budget was reviewed. The generator needs replacement. Security was discussed. Waste collection improved. The pool will be cleaned.';
    const { summary } = summariseMinutes(text, [], 2);
    // At most 2 sentences → at most 2 terminal punctuation marks.
    expect((summary.match(/[.!?]/g) ?? []).length).toBeLessThanOrEqual(2);
    expect(summary.length).toBeGreaterThan(0);
  });

  it('lifts action items from the decisions array (strings and {text} objects)', () => {
    const { actionItems } = summariseMinutes('Minutes body.', ['Hire two guards', { text: 'Order new AVR' }]);
    expect(actionItems).toContain('Hire two guards');
    expect(actionItems).toContain('Order new AVR');
  });

  it('extracts imperative "Action:" / "To-do:" lines from the body', () => {
    const body = 'General discussion happened.\nAction: Collect three quotes\nTo-do: Email the landlord';
    const { actionItems } = summariseMinutes(body, []);
    expect(actionItems).toContain('Collect three quotes');
    expect(actionItems).toContain('Email the landlord');
  });

  it('de-duplicates action items case-insensitively and caps at 8', () => {
    const decisions = ['Do X', 'do x', 'Item 2', 'Item 3', 'Item 4', 'Item 5', 'Item 6', 'Item 7', 'Item 8', 'Item 9'];
    const { actionItems } = summariseMinutes('Body.', decisions);
    expect(actionItems.length).toBeLessThanOrEqual(8);
    // 'Do X' and 'do x' collapse to one.
    expect(actionItems.filter((a) => a.toLowerCase() === 'do x')).toHaveLength(1);
  });

  it('is deterministic for identical input', () => {
    const text = 'Budget reviewed. Generator replaced. Security increased.';
    expect(summariseMinutes(text, ['A'])).toEqual(summariseMinutes(text, ['A']));
  });
});
