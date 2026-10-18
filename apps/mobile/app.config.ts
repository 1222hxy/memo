import type { ExpoConfig } from 'expo/config';

// Bundle ID 必须和你的描述文件一致。本地开发可以不设；GitHub Actions 里从仓库变量 MEMO_BUNDLE_ID 读取。
const bundleIdentifier = process.env.MEMO_BUNDLE_ID ?? 'com.example.memo';

const config: ExpoConfig = {
  name: 'Memo',
  slug: 'memo',
  version: '0.1.0',
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    supportsTablet: true,
    bundleIdentifier,
  },
  android: {
    package: bundleIdentifier,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
  },
  web: {
    favicon: './assets/favicon.png',
  },
};

export default config;
