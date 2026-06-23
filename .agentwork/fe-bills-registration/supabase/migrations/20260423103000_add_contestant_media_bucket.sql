-- Create storage bucket for contestant/profile media uploads
INSERT INTO storage.buckets (id, name, public)
VALUES ('contestant-media', 'contestant-media', true)
ON CONFLICT (id) DO NOTHING;

-- Public read access for media files
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'contestant_media_public_read'
  ) THEN
    CREATE POLICY contestant_media_public_read
      ON storage.objects
      FOR SELECT
      USING (bucket_id = 'contestant-media');
  END IF;
END
$$;

-- Public insert access for upload endpoints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'contestant_media_public_insert'
  ) THEN
    CREATE POLICY contestant_media_public_insert
      ON storage.objects
      FOR INSERT
      TO public
      WITH CHECK (bucket_id = 'contestant-media');
  END IF;
END
$$;
