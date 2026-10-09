/**
 * @format
 */
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { registerSyncTasks } from './src/services/headless';

// Headless SMS scan task + foreground triggers (new SMS event, app resume).
registerSyncTasks();

AppRegistry.registerComponent(appName, () => App);
