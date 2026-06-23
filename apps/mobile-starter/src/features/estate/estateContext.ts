import AsyncStorage from '@react-native-async-storage/async-storage';

export type ActiveEstateContext = {
  estateId?: string;
  estateName?: string;
  propertyId?: string;
  propertyLabel?: string;
};

const ACTIVE_ESTATE_CONTEXT_KEY = 'paymax.activeEstateContext';

export async function getActiveEstateContext(): Promise<ActiveEstateContext> {
  const raw = await AsyncStorage.getItem(ACTIVE_ESTATE_CONTEXT_KEY);
  if (!raw) return {};

  try {
    return JSON.parse(raw) as ActiveEstateContext;
  } catch {
    await AsyncStorage.removeItem(ACTIVE_ESTATE_CONTEXT_KEY);
    return {};
  }
}

export async function setActiveEstateContext(next: ActiveEstateContext) {
  const current = await getActiveEstateContext();
  const merged: ActiveEstateContext = {
    ...current,
    ...next,
  };

  if (next.estateId && next.estateId !== current.estateId) {
    delete merged.propertyId;
    delete merged.propertyLabel;
  }

  await AsyncStorage.setItem(ACTIVE_ESTATE_CONTEXT_KEY, JSON.stringify(merged));
  return merged;
}

export async function setActiveEstate(estateId: string, estateName?: string) {
  return setActiveEstateContext({ estateId, estateName });
}

export async function setActiveProperty(propertyId: string, propertyLabel?: string) {
  return setActiveEstateContext({ propertyId, propertyLabel });
}

export async function clearActiveEstateContext() {
  await AsyncStorage.removeItem(ACTIVE_ESTATE_CONTEXT_KEY);
}
