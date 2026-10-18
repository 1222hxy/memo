import type { DeviceKind } from '@memo/core';
import { Platform } from 'react-native';

export const DEVICE: DeviceKind = Platform.OS === 'ios' && Platform.isPad ? 'ipad' : 'iphone';

export const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
