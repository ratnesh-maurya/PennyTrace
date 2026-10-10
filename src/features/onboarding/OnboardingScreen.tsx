import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { enterDemoMode, openAppSettings, requestSmsPermission, startInitialScan } from '../../app/data/actions';
import { useScanStatus } from '../../app/data/hooks';
import type { RootScreenProps } from '../../app/navigation/types';
import { Icon, type IconName } from '../../ui/icons';
import { Button, Card, ProgressBar, ScreenScroll, Segment, Text, Tile } from '../../ui/primitives';
import { useTheme } from '../../ui/theme';

const DEPTHS = [
  { key: '3', label: '3 months' },
  { key: '6', label: '6 months' },
  { key: '12', label: '1 year' },
] as const;

const POINTS: readonly { icon: IconName; text: string }[] = [
  {
    icon: 'sms',
    text: 'To build your ledger, PennyTrace reads the SMS in your inbox on this phone, and each new SMS as it arrives, to find bank and UPI transaction alerts.',
  },
  {
    icon: 'block',
    text: "Other messages (OTPs, promotions, chats) are skipped: only the sender is noted, never the text. Alerts it can't read yet are kept, encrypted, so a later update can read them.",
  },
  { icon: 'lock', text: 'Your messages never leave this phone. PennyTrace never sends, deletes or changes them.' },
];

/** SMS permission rationale, scan depth and the first inbox scan. */
export function OnboardingScreen({ navigation }: RootScreenProps<'Onboarding'>) {
  const { c } = useTheme();
  const scan = useScanStatus();
  const [depth, setDepth] = useState<(typeof DEPTHS)[number]['key']>('6');
  const [denied, setDenied] = useState(false);

  const start = async () => {
    const result = await requestSmsPermission();
    if (result !== 'granted') {
      setDenied(true);
      return;
    }
    await startInitialScan(Number(depth));
  };

  return (
    <ScreenScroll testID="onboarding-screen">
      <Tile size={56} radius={18} bg={c.accent} ink={c.accentInk} icon="receipt_long" iconSize={28} />
      <Text variant="title">A ledger that keeps itself</Text>
      <Text variant="bodySmall" color="ink2">
        PennyTrace builds your expenses from the SMS alerts your bank already sends. No typing, no account, no cloud.
      </Text>
      <Card style={s.card}>
        {POINTS.map(p => (
          <View key={p.icon} style={s.row}>
            <Icon name={p.icon} size={20} color={c.accent} />
            <Text variant="bodySmall" style={s.flex}>
              {p.text}
            </Text>
          </View>
        ))}
      </Card>

      {scan.state === 'idle' ? (
        <>
          <Text variant="labelStrong">How far back should we read?</Text>
          <Segment options={DEPTHS} value={depth} onChange={setDepth} />
          {denied ? (
            <Card style={s.card} testID="sms-denied-help">
              <Text variant="labelStrong" color="warn">
                Android blocked SMS access
              </Text>
              <Text variant="bodySmall" color="ink2">
                An app installed from a file (not the Play Store) is "restricted" by Android until you allow it:
              </Text>
              <Text variant="bodySmall" color="ink2">
                1. Open app settings below.{'\n'}2. Tap ⋮ (top right) → Allow restricted settings.{'\n'}3. Permissions →
                SMS → Allow, then come back and tap Allow SMS access again.
              </Text>
              <Button
                label="Open app settings"
                tone="outline"
                height={44}
                onPress={openAppSettings}
                testID="open-settings"
              />
            </Card>
          ) : null}
          <Button label="Agree and allow SMS access" tone="accent" height={52} onPress={start} testID="allow-sms" />
          <Button
            label="Explore with demo data"
            tone="outline"
            height={48}
            // Restarts the data layer; the app reopens on the tabs with the demo ledger.
            onPress={enterDemoMode}
            testID="demo-mode"
          />
        </>
      ) : (
        <Card style={s.card}>
          <Text variant="labelStrong">
            {scan.state === 'done' ? 'Your ledger is ready' : 'Reading your bank alerts…'}
          </Text>
          <ProgressBar value={scan.total ? (scan.scanned / scan.total) * 100 : 0} color={c.accent} />
          <Text variant="meta" color="ink3" tnum>
            {scan.scanned.toLocaleString('en-IN')} of {scan.total.toLocaleString('en-IN')} messages
          </Text>
          {scan.state === 'done' ? (
            <Button label="Open my ledger" tone="accent" height={48} onPress={() => navigation.replace('Tabs')} />
          ) : null}
        </Card>
      )}
    </ScreenScroll>
  );
}

const s = StyleSheet.create({
  card: { padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
});
