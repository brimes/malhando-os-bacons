package db

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// migrationLockKey guards the whole migration run. During a rolling update two
// pods start at once, and concurrent DDL on the same tables deadlocks.
const migrationLockKey int64 = 8_276_411_930_524_001

// Migrate applies pending .sql files from dir, in filename order, exactly once
// each. Outside docker-compose nothing else runs them: the compose setup relies
// on docker-entrypoint-initdb.d, which only fires on an empty volume, so a
// deployed environment would otherwise come up with no schema at all.
//
// A database that already has tables but no schema_migrations is adopted rather
// than rebuilt: every known migration is recorded as applied. Re-running them
// would duplicate the food_items seed in 001, which has no ON CONFLICT.
func Migrate(ctx context.Context, database *DB, dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read migrations dir: %w", err)
	}
	versions := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			versions = append(versions, entry.Name())
		}
	}
	sort.Strings(versions)
	if len(versions) == 0 {
		return fmt.Errorf("no migrations found in %s", dir)
	}

	conn, err := database.Pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire connection: %w", err)
	}
	defer conn.Release()

	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, migrationLockKey); err != nil {
		return fmt.Errorf("acquire migration lock: %w", err)
	}
	defer func() {
		if _, err := conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, migrationLockKey); err != nil {
			slog.Error("failed to release migration lock", "error", err)
		}
	}()

	if _, err := conn.Exec(ctx,
		`CREATE TABLE IF NOT EXISTS schema_migrations (
		   version    TEXT PRIMARY KEY,
		   applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		 )`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	applied := map[string]bool{}
	rows, err := conn.Query(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return fmt.Errorf("read schema_migrations: %w", err)
	}
	for rows.Next() {
		var version string
		if err := rows.Scan(&version); err != nil {
			rows.Close()
			return fmt.Errorf("scan schema_migrations: %w", err)
		}
		applied[version] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read schema_migrations: %w", err)
	}

	if len(applied) == 0 {
		var adopted bool
		if err := conn.QueryRow(ctx, `SELECT to_regclass('public.users') IS NOT NULL`).Scan(&adopted); err != nil {
			return fmt.Errorf("detect existing schema: %w", err)
		}
		if adopted {
			for _, version := range versions {
				if _, err := conn.Exec(ctx,
					`INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING`, version); err != nil {
					return fmt.Errorf("baseline %s: %w", version, err)
				}
			}
			slog.Warn("existing schema adopted without running migrations",
				"count", len(versions), "reason", "database already had tables but no schema_migrations")
			return nil
		}
	}

	for _, version := range versions {
		if applied[version] {
			continue
		}
		statements, err := os.ReadFile(filepath.Join(dir, version))
		if err != nil {
			return fmt.Errorf("read %s: %w", version, err)
		}
		tx, err := conn.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin %s: %w", version, err)
		}
		if _, err := tx.Exec(ctx, string(statements)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("apply %s: %w", version, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, version); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("record %s: %w", version, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit %s: %w", version, err)
		}
		slog.Info("migration applied", "version", version)
	}
	return nil
}
