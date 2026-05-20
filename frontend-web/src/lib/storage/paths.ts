import { getOptionalEnv } from '@/lib/config/env';

type ContestantMediaType = 'image' | 'video' | 'audio';
type AcademyUploadType = 'passport' | 'portfolio' | 'document';

function normalizeFolderPath(path: string): string {
  return path
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/');
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function buildPath(folder: string, ...segments: string[]): string {
  const normalizedFolder = normalizeFolderPath(folder);
  const normalizedSegments = segments
    .map((segment) => sanitizePathSegment(segment))
    .filter(Boolean);

  return [normalizedFolder, ...normalizedSegments].filter(Boolean).join('/');
}

function getStorageFolder(name: string, fallback: string): string {
  return normalizeFolderPath(getOptionalEnv(name, fallback) || fallback);
}

export function getContestantMediaFolder(mediaType: ContestantMediaType): string {
  const folderMap: Record<ContestantMediaType, string> = {
    image: getStorageFolder('STORAGE_CONTESTANT_IMAGE_FOLDER', 'contestants/images'),
    video: getStorageFolder('STORAGE_CONTESTANT_VIDEO_FOLDER', 'contestants/videos'),
    audio: getStorageFolder('STORAGE_CONTESTANT_AUDIO_FOLDER', 'contestants/audio'),
  };

  return folderMap[mediaType];
}

export function getAcademyUploadFolder(fileType: AcademyUploadType): string {
  const folderMap: Record<AcademyUploadType, string> = {
    passport: getStorageFolder('STORAGE_ACADEMY_PASSPORT_FOLDER', 'academy/passports'),
    portfolio: getStorageFolder('STORAGE_ACADEMY_PORTFOLIO_FOLDER', 'academy/portfolios'),
    document: getStorageFolder('STORAGE_ACADEMY_DOCUMENT_FOLDER', 'academy/documents'),
  };

  return folderMap[fileType];
}

export function getTemplateSourceFolder(): string {
  return getStorageFolder('STORAGE_TEMPLATE_SOURCE_FOLDER', 'templates/source');
}

export function getTemplateRenderFolder(): string {
  return getStorageFolder('STORAGE_TEMPLATE_RENDER_FOLDER', 'templates/renders');
}

export function getAcademyResourceFolder(): string {
  return getStorageFolder('STORAGE_ACADEMY_RESOURCE_FOLDER', 'academy/resources');
}

export function buildContestantMediaPath(
  mediaType: ContestantMediaType,
  contestantId: string,
  fileName: string
): string {
  return buildPath(getContestantMediaFolder(mediaType), contestantId, fileName);
}

export function buildAcademyUploadPath(
  fileType: AcademyUploadType,
  ownerSegment: string,
  fileName: string
): string {
  return buildPath(getAcademyUploadFolder(fileType), ownerSegment, fileName);
}

export function buildTemplateSourcePath(fileName: string): string {
  return buildPath(getTemplateSourceFolder(), fileName);
}

export function buildTemplateRenderPath(fileName: string): string {
  return buildPath(getTemplateRenderFolder(), fileName);
}

export function buildAcademyResourcePath(fileName: string): string {
  return buildPath(getAcademyResourceFolder(), fileName);
}
