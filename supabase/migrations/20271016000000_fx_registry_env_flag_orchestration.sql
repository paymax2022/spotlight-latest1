-- AUD-OPS-001 follow-up: platform_modules.fx advertised FEATURE_FX_ENABLED, but
-- that flag gates the LEGACY /api/finance/fx mount (finance_routes.go). The
-- module surface the registry row represents — /api/v1/fx/*, what the BFF
-- proxies and the mobile FX feature calls — is the orchestration router mounted
-- under FEATURE_FX_ORCHESTRATION_ENABLED (config.go FeatureFXOrchestrationEnabled,
-- finance_routes.go). With the old value, disabling only the orchestration flag
-- left the registry/BFF advertising a module whose routes all 404, and disabling
-- only FEATURE_FX_ENABLED hid a module that was still mounted. Point the row at
-- the flag that actually mounts the surface.
UPDATE public.platform_modules
SET env_flag = 'FEATURE_FX_ORCHESTRATION_ENABLED'
WHERE key = 'fx';
