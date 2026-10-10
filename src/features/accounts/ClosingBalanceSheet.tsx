import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { setClosingBalance } from '../../app/data/actions';
import { useAccounts, useDailyClose, useToday } from '../../app/data/hooks';
import { showToast } from '../../app/stores/toast';
import { useClosingSheetStore } from '../../app/stores/ui';
import { formatINR, parseAmountToPaise } from '../../core/money';
import { formatDayLong } from '../../ui/format';
import { BottomSheet, Button, Chip, Text } from '../../ui/primitives';
import { useTheme } from '../../ui/theme';
import { fontFamilyFor } from '../../ui/theme/typography';
import { accountListName, accountShortName, isTracked } from '../shared/accountPresenter';

/** Mounted once at the app root; opens from Today, Accounts and an account's day groups. */
export function ClosingBalanceSheetHost() {
  const target = useClosingSheetStore(s => s.target);
  const close = useClosingSheetStore(s => s.close);
  return (
    <BottomSheet visible={!!target} onClose={close} testID="closing-sheet">
      {target ? (
        <ClosingBody
          key={`${target.day}|${target.accountId ?? ''}`}
          day={target.day}
          accountId={target.accountId}
          onDone={close}
        />
      ) : null}
    </BottomSheet>
  );
}

/**
 * A day's closing balance, read in the bank's app. For accounts whose SMS miss money (a credit
 * that was never alerted): that day closes at the figure and later days roll forward from it.
 */
function ClosingBody({ day, accountId, onDone }: { day: string; accountId?: string; onDone: () => void }) {
  const { c } = useTheme();
  const today = useToday();
  const accounts = useAccounts();
  const choices = useMemo(() => accounts.filter(a => isTracked(a) && a.type !== 'credit_card'), [accounts]);
  const [selected, setSelected] = useState(accountId ?? (choices.length === 1 ? choices[0].id : undefined));
  useEffect(() => {
    if (!selected && choices.length === 1) {
      setSelected(choices[0].id);
    }
  }, [choices, selected]);
  const account = choices.find(a => a.id === selected);
  const appClose = useDailyClose(day, selected ?? 'all');
  const [text, setText] = useState('');
  const paise = parseAmountToPaise(text);

  const save = async () => {
    if (!account || paise === undefined) {
      return;
    }
    await setClosingBalance(account.id, day, paise);
    showToast(`${accountListName(account)} closed ${formatINR(paise)} on ${formatDayLong(day)}`);
    onDone();
  };

  return (
    <View style={s.body}>
      <Text variant="sheetTitle">
        {day === today ? "Today's closing balance" : `Closing balance · ${formatDayLong(day)}`}
      </Text>
      <Text variant="bodySmall" color="ink2">
        For money your bank never sent an SMS about. Enter the balance your bank app shows for the end of this day; the
        days after it carry on from there.
      </Text>
      {accountId ? null : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {choices.map(a => (
            <Chip
              key={a.id}
              label={accountShortName(a)}
              active={a.id === selected}
              onPress={() => setSelected(a.id)}
              testID={`closing-account-${a.id}`}
            />
          ))}
        </ScrollView>
      )}
      {account ? (
        <Text variant="meta" color={appClose.closing < 0 ? 'warn' : 'ink3'} tnum>
          The app calculates {formatINR(appClose.closing)} for {accountListName(account)} from its SMS.
        </Text>
      ) : (
        <Text variant="meta" color="ink3">
          Pick the account.
        </Text>
      )}
      <View style={[s.field, { backgroundColor: c.surface2 }]}>
        <Text variant="title" color="ink3">
          ₹
        </Text>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="0"
          placeholderTextColor={c.ink3}
          keyboardType="decimal-pad"
          style={[s.input, { color: c.ink, fontFamily: fontFamilyFor(600) }]}
          testID="closing-input"
        />
      </View>
      <Button
        label="Save closing balance"
        tone="accent"
        height={52}
        onPress={save}
        disabled={!account || paise === undefined}
        testID="save-closing"
      />
    </View>
  );
}

const s = StyleSheet.create({
  body: { gap: 14 },
  chips: { gap: 6 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 64, borderRadius: 18, paddingHorizontal: 18 },
  input: { flex: 1, fontSize: 26, paddingVertical: 0 },
});
