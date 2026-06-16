export const generateIdempotencyKey = () => {
  return `idem_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;
};
