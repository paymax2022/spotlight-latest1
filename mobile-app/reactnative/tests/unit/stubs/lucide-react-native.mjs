// Minimal lucide-react-native stub for `node --test` unit runs.
// Nav-tab lists (src/constants/moduleTabs.ts) hold an icon component per tab, so
// checking their hrefs against the route files pulls lucide in — and lucide
// require()s react-native through the CJS loader, which the ESM resolve hook
// can't intercept, so node dies on react-native's Flow types. The suites never
// render; they only need the named icons to exist.
//
// Node checks named imports statically, so an icon missing here fails the suite
// with "does not provide an export named '<Icon>'" — add it, don't work around.
const icon = () => null;

export const ArrowLeftRight = icon;
export const BarChart3 = icon;
export const BookOpen = icon;
export const Bookmark = icon;
export const CalendarDays = icon;
export const ClipboardList = icon;
export const Compass = icon;
export const FileText = icon;
export const GraduationCap = icon;
export const HandCoins = icon;
export const Heart = icon;
export const LifeBuoy = icon;
export const Receipt = icon;
export const ReceiptText = icon;
export const Settings = icon;
export const Smartphone = icon;
export const TrendingUp = icon;
export const Trophy = icon;
export const Tv = icon;
export const Users = icon;
export const Vote = icon;
export const Wallet = icon;
export const Wifi = icon;
export const Zap = icon;

export default {};
