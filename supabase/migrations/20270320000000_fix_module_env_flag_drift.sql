-- AUD-OPS-001: platform_modules.env_flag must name the env var that actually
-- gates the module's API surface. Six seeded values named flags no code reads,
-- so the registry's os.Getenv(env_flag) kill switch and the real mount gates
-- disagreed (association: FEATURE_ASSOCIATION_ENABLED vs FEATURE_ASSOCIATIONS_ENABLED
-- → "visible" module that 503s). Correcting each row to the flag the code
-- actually reads; fintechAdmin has no env kill switch at all (RBAC-gated admin
-- surface, per modulegate docs) → cleared.
--
-- Additive data fix: UPDATE only, no schema change.
UPDATE public.platform_modules SET env_flag='FEATURE_KYC_VERIFY_ENABLED'        WHERE key='kyc';
UPDATE public.platform_modules SET env_flag='FEATURE_VOTE_BRIDGE_ENABLED'       WHERE key='votesBridge';
UPDATE public.platform_modules SET env_flag='FEATURE_UTILITY_BILLS_ENABLED'     WHERE key='utilityPayments';
UPDATE public.platform_modules SET env_flag='FEATURE_BANK_TRANSFERS_ENABLED'    WHERE key='beneficiaries';
UPDATE public.platform_modules SET env_flag='FEATURE_ASSOCIATIONS_ENABLED'      WHERE key='association';
UPDATE public.platform_modules SET env_flag=''                                WHERE key='fintechAdmin';
