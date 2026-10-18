import { SQLiteProvider } from 'expo-sqlite';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { migrate } from './src/db/schema';
import { ReviewScreen } from './src/ReviewScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <SQLiteProvider databaseName="memo.db" onInit={migrate}>
        <ReviewScreen />
      </SQLiteProvider>
    </SafeAreaProvider>
  );
}
