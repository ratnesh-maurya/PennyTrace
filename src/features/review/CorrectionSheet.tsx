import React, { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { addCustomCategory, resolveCategory } from '../../app/data/actions';
import { useTransaction } from '../../app/data/hooks';
import { showToast } from '../../app/stores/toast';
import { useCorrectionStore } from '../../app/stores/ui';
import { allCategories, CATEGORY_BY_ID, customCategoryId, type CategoryDef } from '../../core/categories';
import { formatINR } from '../../core/money';
import type { CategoryId, Transaction } from '../../core/types';
import { formatTime } from '../../ui/format';
import { Icon, toIconName, type IconName } from '../../ui/icons';
import { BottomSheet, Button, Segment, Text } from '../../ui/primitives';
import { useTheme, useThemedStyles, type Theme } from '../../ui/theme';
import { fontFamilyFor } from '../../ui/theme/typography';
import { TxnTile } from '../shared/TxnTile';
import { txnAccountLabel, txnTitle } from '../shared/txnPresenter';

/** Moves that are corrected elsewhere (card bills, ATM, refunds are detected, not picked). */
const NOT_PICKABLE: ReadonlySet<CategoryId> = new Set(['card_payment', 'cash', 'refund']);

interface Section {
  title: string;
  options: readonly CategoryDef[];
}

/** Every category that fits the transaction's direction, built-in first, then the user's own. */
function sectionsFor(txn: Transaction): Section[] {
  const all = allCategories().filter(c => !NOT_PICKABLE.has(c.id));
  const moves = all.filter(c => c.group === 'movement');
  if (txn.direction === 'credit') {
    return [
      { title: 'Money in', options: all.filter(c => c.group === 'income') },
      { title: 'Not income', options: moves },
    ];
  }
  return [
    { title: 'Spending', options: all.filter(c => c.group === 'expense') },
    { title: 'Not spending', options: moves },
  ];
}

/** Icons and colours offered for a new category. */
const NEW_ICONS: readonly IconName[] = [
  'restaurant',
  'local_cafe',
  'local_taxi',
  'shopping_bag',
  'local_grocery_store',
  'home',
  'family_home',
  'school',
  'medical_services',
  'spa',
  'redeem',
  'movie',
  'bolt',
  'smartphone',
  'savings',
  'trending_up',
];
const NEW_COLORS = ['#FF6B2C', '#F08C00', '#12B886', '#00A6FB', '#3B6BFF', '#7C3AED', '#FF3D81', '#8790A5'];

/** Mounted once at the app root; opens for the transaction in the correction store. */
export function CorrectionSheetHost() {
  const txnId = useCorrectionStore(s => s.txnId);
  const close = useCorrectionStore(s => s.close);
  return (
    <BottomSheet visible={!!txnId} onClose={close} testID="correction-sheet">
      {txnId ? <CorrectionBody key={txnId} txnId={txnId} onDone={close} /> : null}
    </BottomSheet>
  );
}

const CorrectionBody = memo(function CorrectionBody({ txnId, onDone }: { txnId: string; onDone: () => void }) {
  const s = useThemedStyles(makeStyles);
  const { c } = useTheme();
  const item = useTransaction(txnId);
  const [pick, setPick] = useState<CategoryId | undefined>(item?.txn.categoryId);
  const [remember, setRemember] = useState(true);
  const [creating, setCreating] = useState(false);
  // Adding a category reloads the ledger, so `item` changes and the list picks it up.
  const sections = useMemo(() => (item ? sectionsFor(item.txn) : []), [item]);

  const save = useCallback(async () => {
    if (!item || !pick) {
      return;
    }
    await resolveCategory(item.txn.id, pick, remember);
    const name = CATEGORY_BY_ID[pick]?.name ?? pick;
    showToast(
      remember && item.txn.counterparty
        ? `Rule saved on-device: ${item.txn.counterparty} → ${name}`
        : 'Category updated',
    );
    onDone();
  }, [item, pick, remember, onDone]);

  if (!item) {
    return null;
  }
  const { txn } = item;
  const who = (txn.counterparty ?? txnTitle(item)).toUpperCase();

  return (
    <View style={s.body}>
      <View style={s.head}>
        <TxnTile txn={txn} size={44} radius={13} initialsSize={14} iconSize={22} />
        <View style={s.headText}>
          <Text variant="sheetTitle">What was this?</Text>
          <Text variant="meta" color="ink3" numberOfLines={1}>
            {who} · {txn.direction === 'credit' ? '+' : '−'}
            {formatINR(txn.amount)} · {txnAccountLabel(item)} · {formatTime(txn.occurredAt)}
          </Text>
        </View>
      </View>

      {creating ? (
        <NewCategoryForm
          credit={txn.direction === 'credit'}
          onCancel={() => setCreating(false)}
          onCreated={id => {
            setPick(id);
            setCreating(false);
          }}
        />
      ) : (
        <ScrollView style={s.list} contentContainerStyle={s.listContent} nestedScrollEnabled testID="category-list">
          {sections.map(sec => (
            <View key={sec.title} style={s.section}>
              <Text variant="eyebrow" color="ink3">
                {sec.title}
              </Text>
              <View style={s.grid}>
                {sec.options.map(o => {
                  const active = o.id === pick;
                  return (
                    <Pressable
                      key={o.id}
                      onPress={() => setPick(o.id)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      style={[s.option, active && { backgroundColor: c.accentSoft, borderColor: c.accent }]}
                      testID={`option-${o.id}`}
                    >
                      <Icon name={toIconName(o.icon)} size={20} color={active ? c.accent : o.color} fill={active} />
                      <Text variant="chip" color={active ? 'ink' : 'ink2'} numberOfLines={1} style={s.optionLabel}>
                        {o.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
          <Pressable
            onPress={() => setCreating(true)}
            accessibilityRole="button"
            style={[s.option, s.newOption, { borderColor: c.line2 }]}
            testID="new-category"
          >
            <Icon name="edit" size={20} color={c.accent} />
            <Text variant="chip" color="accent">
              New category
            </Text>
          </Pressable>
        </ScrollView>
      )}

      {txn.counterparty && !creating ? (
        <Pressable
          onPress={() => setRemember(r => !r)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: remember }}
          style={s.remember}
          testID="remember-row"
        >
          <View style={[s.check, remember && { backgroundColor: c.accent, borderColor: c.accent }]}>
            {remember ? <Icon name="check" size={16} color={c.accentInk} /> : null}
          </View>
          <View style={s.headText}>
            <Text variant="labelStrong">Always use this for {who}</Text>
            <Text variant="meta" color="ink3">
              Saved as an on-device rule
            </Text>
          </View>
        </Pressable>
      ) : null}

      {creating ? null : (
        <Button label="Save" tone="accent" height={52} onPress={save} disabled={!pick} testID="save-correction" />
      )}
    </View>
  );
});

/** Name, icon, colour and whether it counts as spending. */
function NewCategoryForm({
  credit,
  onCancel,
  onCreated,
}: {
  credit: boolean;
  onCancel: () => void;
  onCreated: (id: CategoryId) => void;
}) {
  const s = useThemedStyles(makeStyles);
  const { c } = useTheme();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<IconName>(NEW_ICONS[0]);
  const [color, setColor] = useState(NEW_COLORS[0]);
  const [counts, setCounts] = useState<'yes' | 'no'>('yes');
  const trimmed = name.trim();

  const create = async () => {
    if (!trimmed) {
      return;
    }
    const id = customCategoryId(
      trimmed,
      allCategories().map(x => x.id),
    );
    const group: CategoryDef['group'] = counts === 'no' ? 'movement' : credit ? 'income' : 'expense';
    await addCustomCategory({ id, name: trimmed, icon, color, group });
    showToast(`Category "${trimmed}" added`);
    onCreated(id);
  };

  return (
    <View style={s.form} testID="new-category-form">
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Category name, e.g. Pets"
        placeholderTextColor={c.ink3}
        autoFocus
        maxLength={28}
        style={[s.nameInput, { backgroundColor: c.surface2, color: c.ink, fontFamily: fontFamilyFor(500) }]}
        testID="new-category-name"
      />
      <View style={s.iconGrid}>
        {NEW_ICONS.map(i => (
          <Pressable
            key={i}
            onPress={() => setIcon(i)}
            accessibilityRole="radio"
            accessibilityState={{ selected: i === icon }}
            style={[s.iconCell, i === icon && { backgroundColor: c.accentSoft, borderColor: c.accent }]}
          >
            <Icon name={i} size={20} color={i === icon ? c.accent : c.ink2} />
          </Pressable>
        ))}
      </View>
      <View style={s.colors}>
        {NEW_COLORS.map(col => (
          <Pressable
            key={col}
            onPress={() => setColor(col)}
            accessibilityRole="radio"
            accessibilityState={{ selected: col === color }}
            style={[s.swatch, { backgroundColor: col }, col === color && { borderColor: c.ink, borderWidth: 2 }]}
          />
        ))}
      </View>
      <Segment
        options={[
          { key: 'yes', label: credit ? 'Counts as income' : 'Counts as spending' },
          { key: 'no', label: credit ? 'Not income' : 'Not spending' },
        ]}
        value={counts}
        onChange={setCounts}
      />
      <View style={s.formActions}>
        <Button label="Cancel" tone="outline" height={48} flex onPress={onCancel} />
        <Button
          label="Add category"
          tone="accent"
          height={48}
          flex
          onPress={create}
          disabled={!trimmed}
          testID="add-category"
        />
      </View>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    body: { gap: 14 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    headText: { flex: 1, gap: 2 },
    list: { maxHeight: 360 },
    listContent: { gap: 14, paddingBottom: 4 },
    section: { gap: 8 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    option: {
      width: '48.5%',
      height: 48,
      borderRadius: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      backgroundColor: t.c.surface2,
      borderWidth: 1.5,
      borderColor: 'transparent',
    },
    optionLabel: { flexShrink: 1 },
    newOption: { backgroundColor: 'transparent', borderStyle: 'dashed' },
    remember: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 12,
      borderRadius: 16,
      backgroundColor: t.c.surface2,
    },
    check: {
      width: 22,
      height: 22,
      borderRadius: 7,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: t.c.line2,
    },
    form: { gap: 12 },
    nameInput: { height: 52, borderRadius: 16, paddingHorizontal: 16, fontSize: 16 },
    iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    iconCell: {
      width: 44,
      height: 44,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.c.surface2,
      borderWidth: 1.5,
      borderColor: 'transparent',
    },
    colors: { flexDirection: 'row', gap: 10 },
    swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: 'transparent' },
    formActions: { flexDirection: 'row', gap: 8 },
  });
