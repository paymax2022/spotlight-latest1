// Minimal react-native stub for `node --test` unit runs.
// Pure-logic suites transitively import constants that pull Platform/StyleSheet
// from react-native, which node cannot parse (Flow types). The suites under
// test never render — they only need the API surface to exist.

export const Platform = {
  OS: 'ios',
  isPad: false,
  isTV: false,
  isVision: false,
  select: (spec) => spec?.ios ?? spec?.default ?? spec?.native,
  Version: 18,
};

export const StyleSheet = {
  create: (styles) => styles,
  flatten: (styles) => styles,
  hairlineWidth: 1,
  absoluteFill: {},
  absoluteFillObject: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
};

export const Dimensions = {
  get: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  addEventListener: () => ({ remove: () => {} }),
};

export const PixelRatio = {
  get: () => 3,
  getFontScale: () => 1,
  roundToNearestPixel: (n) => n,
};

export const Alert = { alert: () => {}, prompt: () => {} };
export const Linking = { openURL: async () => {}, canOpenURL: async () => true, addEventListener: () => ({ remove: () => {} }) };
export const AppState = { currentState: 'active', addEventListener: () => ({ remove: () => {} }) };
export const NativeModules = {};
export const TurboModuleRegistry = { get: () => null, getEnforcing: () => ({}) };
export const AccessibilityInfo = { addEventListener: () => ({ remove: () => {} }) };
export const Keyboard = { addListener: () => ({ remove: () => {} }), dismiss: () => {} };
export const Appearance = { getColorScheme: () => 'light', addChangeListener: () => ({ remove: () => {} }) };
export const I18nManager = { isRTL: false };
export const Easing = { linear: (t) => t, inOut: (t) => t };
export const UIManager = {};
export const DeviceEventEmitter = { addListener: () => ({ remove: () => {} }) };
export const Vibration = { vibrate: () => {}, cancel: () => {} };
export const Share = { share: async () => ({ action: 'sharedAction' }) };
export const Clipboard = { setString: () => {}, getString: async () => '' };
export const LogBox = { ignoreLogs: () => {}, ignoreAllLogs: () => {} };
export const useColorScheme = () => 'light';
export const useWindowDimensions = () => ({ width: 390, height: 844, scale: 3, fontScale: 1 });

export const View = 'View';
export const Text = 'Text';
export const Pressable = 'Pressable';
export const ScrollView = 'ScrollView';
export const TextInput = 'TextInput';
export const Image = 'Image';
export const FlatList = 'FlatList';
export const ActivityIndicator = 'ActivityIndicator';
export const Modal = 'Modal';
export const SafeAreaView = 'SafeAreaView';
export const TouchableOpacity = 'TouchableOpacity';
export const Animated = { View: 'Animated.View', Text: 'Animated.Text', Value: class {}, timing: () => ({ start: () => {} }), loop: () => ({ start: () => {} }) };

export default {};
