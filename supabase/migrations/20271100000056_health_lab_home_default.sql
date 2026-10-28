-- Health Lab: a lab that has a profile row but never chose home collection should
-- not silently refuse home orders. New profile rows default to "offers home
-- collection"; a lab that does not offer it must say so explicitly. Additive:
-- changes only the default for future rows, and leaves every existing choice as is.
ALTER TABLE public.lab_profiles
  ALTER COLUMN supports_home_collection SET DEFAULT true;
