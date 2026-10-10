import React, { useEffect } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useDataStatus, useSourcesStatus } from './src/app/data/hooks';
import { startData } from './src/app/data/store';
import { RootNavigator } from './src/app/navigation/RootNavigator';
import { useSettingsStore } from './src/app/stores/settings';
import { useToastStore } from './src/app/stores/toast';
import { ClosingBalanceSheetHost } from './src/features/accounts/ClosingBalanceSheet';
import { CorrectionSheetHost } from './src/features/review/CorrectionSheet';
import { EmptyState, Toast } from './src/ui/primitives';
import { ThemeProvider, useTheme } from './src/ui/theme';

function Shell() {
  const t = useTheme();
  const toast = useToastStore(s => s.message);
  const { status, error, backendKind } = useDataStatus();
  const sms = useSourcesStatus().sms;

  useEffect(() => {
    startData();
  }, []);

  // A device build opens onboarding until SMS access is granted and the first import has run.
  const needsOnboarding = backendKind === 'live' && (sms.permission !== 'granted' || sms.messagesRead === 0);

  return (
    <View style={[styles.root, { backgroundColor: t.c.bg }]}>
      <StatusBar barStyle={t.mode === 'dark' ? 'light-content' : 'dark-content'} />
      {status === 'ready' ? (
        <>
          <RootNavigator needsOnboarding={needsOnboarding} />
          <CorrectionSheetHost />
          <ClosingBalanceSheetHost />
        </>
      ) : status === 'error' ? (
        <View style={styles.center}>
          <EmptyState icon="error" message={`Couldn't open the ledger. ${error ?? ''}`} />
        </View>
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={t.c.accent} />
        </View>
      )}
      <Toast message={toast} />
    </View>
  );
}

function App() {
  const theme = useSettingsStore(s => s.theme);
  const accent = useSettingsStore(s => s.accent);
  return (
    <SafeAreaProvider>
      <ThemeProvider preference={theme} accent={accent}>
        <Shell />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});

export default App;
