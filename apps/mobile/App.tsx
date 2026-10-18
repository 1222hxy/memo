import { SQLiteProvider } from 'expo-sqlite';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { migrate } from './src/db/schema';
import { ReviewScreen } from './src/ReviewScreen';
import { SyncProvider } from './src/sync/SyncProvider';

export default function App() {
  return (
    <SafeAreaProvider>
      <SQLiteProvider databaseName="memo.db" onInit={migrate}>
        <SyncProvider>
          <ReviewScreen />
        </SyncProvider>
      </SQLiteProvider>
    </SafeAreaProvider>
  );
}
