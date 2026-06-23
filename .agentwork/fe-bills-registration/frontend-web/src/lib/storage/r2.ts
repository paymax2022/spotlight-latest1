import { HeadObjectCommand, PutObjectCommand, S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const DEFAULT_UPLOAD_TTL_SECONDS = 10 * 60;
const DEFAULT_DOWNLOAD_TTL_SECONDS = 10 * 60;

type R2Config = {
  bucket: string;
  publicBaseUrl?: string;
  client: S3Client;
};

function getR2Endpoint() {
  if (process.env.R2_ENDPOINT) return process.env.R2_ENDPOINT;
  if (process.env.R2_ACCOUNT_ID) {
    return `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  }
  return '';
}

export function hasR2Config() {
  return Boolean(
      getR2Endpoint() &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      (process.env.R2_BUCKET || process.env.R2_BUCKET_NAME)
  );
}

function getR2Config(): R2Config {
  const endpoint = getR2Endpoint();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET || process.env.R2_BUCKET_NAME;

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error('R2 storage is not configured.');
  }

  return {
    bucket,
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL,
    client: new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

export function sanitizeObjectFileName(fileName: string) {
  const fallback = `submission-${Date.now()}.mp3`;
  const base = fileName.split(/[\\/]/).pop() || fallback;
  return base
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || fallback;
}

export async function createR2UploadUrl(input: {
  key: string;
  contentType: string;
  expiresIn?: number;
}) {
  const { bucket, client } = getR2Config();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: input.key,
    ContentType: input.contentType,
  });
  return getSignedUrl(client, command, {
    expiresIn: input.expiresIn || DEFAULT_UPLOAD_TTL_SECONDS,
  });
}

export async function assertR2ObjectExists(key: string) {
  const { bucket, client } = getR2Config();
  await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
}

export async function createR2DownloadUrl(input: {
  key: string;
  fileName?: string;
  disposition?: 'inline' | 'attachment';
  expiresIn?: number;
}) {
  const { bucket, client } = getR2Config();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: input.key,
    ResponseContentDisposition: `${input.disposition || 'inline'}; filename="${sanitizeObjectFileName(
      input.fileName || input.key.split('/').pop() || 'song.mp3'
    )}"`,
  });
  return getSignedUrl(client, command, {
    expiresIn: input.expiresIn || DEFAULT_DOWNLOAD_TTL_SECONDS,
  });
}

export function getR2PublicUrl(key: string) {
  const { publicBaseUrl } = getR2Config();
  if (!publicBaseUrl) return undefined;
  return `${publicBaseUrl.replace(/\/$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
}
