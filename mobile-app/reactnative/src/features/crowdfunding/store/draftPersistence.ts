// Persistence rules for the campaign-creation draft, kept free of any
// react-native imports so they can be unit-tested directly under plain node
// (the store itself pulls in AsyncStorage, which will not resolve there).

/**
 * A picked-media URI is only worth persisting if it will still resolve after a
 * reload. `blob:` (web ImagePicker) is scoped to the document that created it
 * and is dead on the next load; `data:` URIs would bloat storage. Both are
 * dropped at write time so a restored draft never points at a broken image.
 */
export const persistableUri = (uri: string | null | undefined): string | null =>
  uri && !/^(blob|data):/i.test(uri) ? uri : null;

/** Strip the media URIs that cannot survive a reload. */
export function persistableMedia<T extends {
  coverImageUri: string | null;
  videoUri: string | null;
  galleryUris: string[];
}>(draft: T): T {
  return {
    ...draft,
    coverImageUri: persistableUri(draft.coverImageUri),
    videoUri: persistableUri(draft.videoUri),
    galleryUris: draft.galleryUris.filter((u) => persistableUri(u) !== null),
  };
}
