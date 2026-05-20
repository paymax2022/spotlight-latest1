package config

import "os"

type Config struct {
	Port                   string
	SupabaseURL            string
	SupabaseServiceRoleKey string
	AdminAPIKey            string
	CORSAllowOrigins       string
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func Load() Config {
	return Config{
		Port:                   getEnv("APP_PORT", "8080"),
		SupabaseURL:            getEnv("SUPABASE_URL", getEnv("NEXT_PUBLIC_SUPABASE_URL", "")),
		SupabaseServiceRoleKey: getEnv("SUPABASE_SERVICE_ROLE_KEY", ""),
		AdminAPIKey:            getEnv("ADMIN_API_KEY", ""),
		CORSAllowOrigins:       getEnv("CORS_ALLOW_ORIGINS", "http://localhost:3000,http://localhost:4030"),
	}
}
