'use client';

import { useState } from 'react';
import { Page, PageHeader, Card, Button, Input, Badge, colors } from '@/components/ui/vuexy';

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    minParticipants: 10,
    maxParticipants: 10000,
    autoPublishResults: true,
    prizeDistributionDays: 7,
    enableVotingModeration: true,
    minAgeRequirement: 18,
  });

  return (
    <Page>
      <PageHeader
        title="Contest Settings"
        subtitle="Configure global rules, prize templates, and notification preferences."
        actions={<Button variant="primary">Save Changes</Button>}
      />

      {/* Global Rules */}
      <Card title="Global Rules & Limits" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gap: 16, marginTop: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: colors.text, marginBottom: 6 }}>
              Minimum Participants per Contest
            </label>
            <Input
              type="number"
              value={settings.minParticipants}
              onChange={(e) => setSettings({ ...settings, minParticipants: parseInt(e.target.value) })}
            />
            <p style={{ fontSize: '0.75rem', color: colors.muted, marginTop: 4 }}>Contests must have at least this many participants</p>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: colors.text, marginBottom: 6 }}>
              Maximum Participants per Contest
            </label>
            <Input
              type="number"
              value={settings.maxParticipants}
              onChange={(e) => setSettings({ ...settings, maxParticipants: parseInt(e.target.value) })}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: colors.text, marginBottom: 6 }}>
              Minimum Age Requirement
            </label>
            <Input
              type="number"
              value={settings.minAgeRequirement}
              onChange={(e) => setSettings({ ...settings, minAgeRequirement: parseInt(e.target.value) })}
            />
          </div>
        </div>
      </Card>

      {/* Prize & Distribution */}
      <Card title="Prize Distribution" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gap: 16, marginTop: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: colors.text, marginBottom: 6 }}>
              Days to Distribute Prizes After Contest Ends
            </label>
            <Input
              type="number"
              value={settings.prizeDistributionDays}
              onChange={(e) => setSettings({ ...settings, prizeDistributionDays: parseInt(e.target.value) })}
            />
            <p style={{ fontSize: '0.75rem', color: colors.muted, marginTop: 4 }}>Winners will receive prizes within this timeframe</p>
          </div>

          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.autoPublishResults}
                onChange={(e) => setSettings({ ...settings, autoPublishResults: e.target.checked })}
              />
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: colors.text }}>
                Auto-publish results when contest ends
              </span>
            </label>
            <p style={{ fontSize: '0.75rem', color: colors.muted, marginTop: 4, marginLeft: 28 }}>Results will be visible to participants immediately</p>
          </div>
        </div>
      </Card>

      {/* Moderation & Safety */}
      <Card title="Moderation & Safety" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gap: 16, marginTop: 12 }}>
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.enableVotingModeration}
                onChange={(e) => setSettings({ ...settings, enableVotingModeration: e.target.checked })}
              />
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: colors.text }}>
                Enable Voting Moderation
              </span>
            </label>
            <p style={{ fontSize: '0.75rem', color: colors.muted, marginTop: 4, marginLeft: 28 }}>Admin must approve votes before they're counted</p>
          </div>
        </div>
      </Card>

      {/* Prize Templates */}
      <Card title="Prize Pool Templates" style={{ marginBottom: 20 }}>
        <div style={{ marginTop: 12, fontSize: '0.85rem', color: colors.text }}>
          <p style={{ marginBottom: 12 }}>Pre-defined prize distributions for quick setup:</p>
          <div style={{ display: 'grid', gap: 12 }}>
            {[
              { name: 'Small (₦100K)', distribution: '50% 1st, 30% 2nd, 20% 3rd' },
              { name: 'Medium (₦500K)', distribution: '50% 1st, 30% 2nd, 20% 3rd' },
              { name: 'Large (₦1M+)', distribution: '50% 1st, 30% 2nd, 15% 3rd, 5% 4th-10th' },
            ].map((template) => (
              <div key={template.name} style={{ border: `1px solid ${colors.border}`, padding: 12, borderRadius: '0.375rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, color: colors.text }}>{template.name}</div>
                  <div style={{ fontSize: '0.75rem', color: colors.muted, marginTop: 4 }}>{template.distribution}</div>
                </div>
                <Button variant="outline" sm>Use Template</Button>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Notifications */}
      <Card title="Notification Preferences">
        <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
          {[
            { label: 'Send reminder when contest is about to start', key: 'startReminder' },
            { label: 'Notify winners when results are published', key: 'winnerNotification' },
            { label: 'Alert admin of voting anomalies', key: 'votingAlert' },
            { label: 'Weekly contest summary email', key: 'weeklySummary' },
          ].map((item) => (
            <label key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.875rem' }}>
              <input type="checkbox" defaultChecked />
              <span style={{ color: colors.text, fontWeight: 500 }}>{item.label}</span>
            </label>
          ))}
        </div>
      </Card>
    </Page>
  );
}
