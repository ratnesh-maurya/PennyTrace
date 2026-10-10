import React, { memo, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { exportLedger, importStatement, setDiscardRaw, setSmsEnabled } from '../../app/data/actions';
import { useSourcesStatus } from '../../app/data/hooks';
import { PRIVACY_POLICY_URL, SOURCE_CODE_URL } from '../../app/links';
import { showToast } from '../../app/stores/toast';
import { Icon, type IconName } from '../../ui/icons';
import {
  Card,
  ScreenScroll,
  ScreenTitle,
  SectionHeading,
  Switch,
  Text,
  Tile,
  useRowDivider,
} from '../../ui/primitives';
import { useTheme } from '../../ui/theme';

/** What the app guarantees, stated plainly. Each row must stay true of the shipped APK. */
const GUARANTEES: readonly { icon: IconName; label: string; value: string }[] = [
  { icon: 'public_off', label: 'Internet permission', value: 'Not requested' },
  { icon: 'enhanced_encryption', label: 'Ledger database', value: 'Encrypted' },
  { icon: 'cloud_off', label: 'Cloud backup', value: 'Disabled' },
  { icon: 'monitoring', label: 'Analytics & crash SDKs', value: 'None' },
];

/** Sources, storage and permissions. */
export function PrivacyScreen() {
  const { c } = useTheme();
  const divider = useRowDivider();
  const sources = useSourcesStatus();
  const sms = sources.sms;

  const unavailable = async (run: () => Promise<boolean>, what: string) => {
    if (!(await run())) {
      showToast(`${what} is coming soon`);
    }
  };

  return (
    <ScreenScroll testID="privacy-screen">
      <ScreenTitle overline="Sources, storage & permissions" title="Privacy" />

      <View style={[s.hero, { backgroundColor: c.accentSoft }]} testID="privacy-hero">
        <View style={[s.ring, s.ringA, { borderColor: c.accent }]} />
        <View style={[s.ring, s.ringB, { borderColor: c.accent }]} />
        <Tile size={48} radius={16} bg={c.accent} ink={c.accentInk} icon="wifi_off" iconSize={24} />
        <Text variant="heroTitle">Nothing leaves this phone.</Text>
        <Text variant="bodySmall" color="ink2">
          This app doesn't request internet access, so it can't connect to a network: not to sync, not for analytics,
          not for AI.
        </Text>
      </View>

      <Card style={s.card}>
        {GUARANTEES.map((g, i) => (
          <View key={g.label} style={[s.row, i > 0 && divider]}>
            <Icon name={g.icon} size={20} color={c.ink2} />
            <Text variant="rowTitle" style={s.flex}>
              {g.label}
            </Text>
            <Text variant="metaStrong" color="ink2">
              {g.value}
            </Text>
            <Icon name="check_circle" size={16} color={c.accent} fill />
          </View>
        ))}
      </Card>

      <SectionHeading title="Sources" />
      <Card style={s.card}>
        <ToggleRow
          icon="sms"
          title="Bank & UPI SMS"
          subtitle={
            sms.permission === 'denied'
              ? 'Permission denied · tap to allow in Settings'
              : `${sms.messagesRead.toLocaleString('en-IN')} messages read · ${sms.banksRecognised} banks recognised`
          }
          value={sms.enabled}
          onChange={setSmsEnabled}
        />
        <ToggleRow
          icon="mark_email_unread"
          title="Email notifications"
          subtitle="Coming later"
          value={false}
          disabled
          divider={divider}
        />
        <ToggleRow
          icon="delete_sweep"
          title="Discard raw messages"
          subtitle="Keep only parsed fields after processing"
          value={sources.discardRaw}
          onChange={setDiscardRaw}
          divider={divider}
        />
      </Card>

      <SectionHeading title="About" />
      <Card style={s.card}>
        <LinkRow
          icon="policy"
          title="Privacy policy"
          subtitle="What PennyTrace reads, keeps and never sends"
          onPress={() => Linking.openURL(PRIVACY_POLICY_URL).catch(() => undefined)}
          trailing="open_in_new"
          testID="privacy-policy-link"
        />
        <LinkRow
          icon="memory"
          title="Open source"
          subtitle="AGPL-3.0 · read exactly what the app does"
          onPress={() => Linking.openURL(SOURCE_CODE_URL).catch(() => undefined)}
          trailing="open_in_new"
          divider={divider}
        />
      </Card>

      <View style={s.tiles}>
        <Tile3
          icon="upload_file"
          label="Import statement"
          onPress={() => unavailable(importStatement, 'Statement import')}
        />
        <Tile3 icon="download" label="Export ledger" onPress={() => unavailable(exportLedger, 'Export')} />
      </View>

      <Text variant="meta" color="ink3">
        Imports and exports use the system file picker. Ledger encrypted with SQLCipher · key held in Android Keystore.
      </Text>
    </ScreenScroll>
  );
}

const ToggleRow = memo(function ToggleRow(props: {
  icon: IconName;
  title: string;
  subtitle: string;
  value: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  divider?: object;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      style={[s.row, props.divider]}
      disabled={props.disabled}
      onPress={() => props.onChange?.(!props.value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: props.value, disabled: props.disabled }}
    >
      <Icon name={props.icon} size={20} color={props.disabled ? c.ink3 : c.ink2} />
      <View style={s.flex}>
        <Text variant="rowStrong" color={props.disabled ? 'ink3' : 'ink'}>
          {props.title}
        </Text>
        <Text variant="meta" color="ink3">
          {props.subtitle}
        </Text>
      </View>
      <Switch value={props.value} disabled={props.disabled} decorative />
    </Pressable>
  );
});

const LinkRow = memo(function LinkRow(props: {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
  divider?: object;
  /** Icon at the end of the row: `open_in_new` for links that leave the app. */
  trailing?: IconName;
  testID?: string;
}) {
  const { c } = useTheme();
  return (
    <Pressable style={[s.row, props.divider]} onPress={props.onPress} accessibilityRole="button" testID={props.testID}>
      <Icon name={props.icon} size={20} color={c.ink2} />
      <View style={s.flex}>
        <Text variant="rowStrong">{props.title}</Text>
        <Text variant="meta" color="ink3">
          {props.subtitle}
        </Text>
      </View>
      <Icon name={props.trailing ?? 'chevron_right'} size={20} color={c.ink3} />
    </Pressable>
  );
});

function Tile3({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }): ReactNode {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} style={s.flex} accessibilityRole="button">
      <Card radius={20} style={s.tile}>
        <Icon name={icon} size={22} color={c.accent} />
        <Text variant="labelStrong">{label}</Text>
      </Card>
    </Pressable>
  );
}

const s = StyleSheet.create({
  hero: { borderRadius: 26, padding: 18, gap: 10, overflow: 'hidden' },
  ring: { position: 'absolute', borderWidth: 1.5, borderRadius: 999 },
  ringA: { width: 180, height: 180, right: -60, top: -60, opacity: 0.18 },
  ringB: { width: 110, height: 110, right: -20, top: -20, opacity: 0.25 },
  card: { paddingHorizontal: 16, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  flex: { flex: 1 },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: { height: 76, padding: 14, justifyContent: 'space-between' },
});
