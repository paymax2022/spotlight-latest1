import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export async function GET(_request: Request, { params }: { params: { fileKey: string } }) {
  const safeKey = path.basename(params.fileKey);
  const filePath = path.join('/tmp', 'spotlight-registration-uploads', safeKey);

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType =
      ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.png'
          ? 'image/png'
          : ext === '.webp'
            ? 'image/webp'
            : ext === '.mp4'
              ? 'video/mp4'
              : ext === '.mov'
                ? 'video/quicktime'
                : ext === '.mp3'
                  ? 'audio/mpeg'
                  : ext === '.wav'
                    ? 'audio/wav'
                    : ext === '.m4a'
                      ? 'audio/mp4'
                      : ext === '.pdf'
                        ? 'application/pdf'
                        : 'application/octet-stream';

    return new NextResponse(content, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
