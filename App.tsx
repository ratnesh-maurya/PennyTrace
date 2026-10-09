
import { StatusBar, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <View
        style={[
          styles.container,
          { backgroundColor: isDarkMode ? '#111827' : '#FFFFFF' },
        ]}
      >
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <Text
          style={[
            styles.title,
            { color: isDarkMode ? '#FFFFFF' : '#111827' },
          ]}
        >
          PennyTrace
        </Text>
        <Text
          style={[
            styles.subtitle,
            { color: isDarkMode ? '#9CA3AF' : '#6B7280' },
          ]}
        >
          Your finances, traced.
        </Text>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
  },
  subtitle: {
    marginTop: 8,
    fontSize: 16,
  },
});

export default App;
