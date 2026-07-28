import { Redirect } from 'expo-router';

// FX moved to its own super-app module (app/fx/). Keep this legacy route as a
// redirect so any existing deep links / module entries land on the new home.
export default function FxRedirect() {
  return <Redirect href="/fx" />;
}
