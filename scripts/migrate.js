#!/usr/bin/env node
/**
 * Database Migration Script
 * Applies SQL migrations to Supabase using MCP
 * Usage: node scripts/migrate.js <migration-file>
 */

const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
// Resolved from the environment so the concrete project ref never lands in git.
const SUPABASE_PROJECT_ID = process.env.SUPABASE_PROJECT_ID || 'your-project-ref';

async function applyMigration(migrationFile) {
  console.log(`📦 Applying migration: ${migrationFile}`);

  const migrationPath = path.join(MIGRATIONS_DIR, migrationFile);

  if (!fs.existsSync(migrationPath)) {
    console.error(`❌ Migration file not found: ${migrationPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(migrationPath, 'utf-8');
  const migrationName = path.basename(migrationFile, '.sql');

  console.log(`\n🔄 Ejecutando migración: ${migrationName}`);
  console.log(`📝 Archivo: ${migrationPath}`);
  console.log(`\n⚠️  IMPORTANTE: Esta migración necesita aplicarse vía Supabase MCP.`);
  console.log(`\n📋 Instrucciones:`);
  console.log(`1. Abre tu AI Assistant con MCP de Supabase`);
  console.log(`2. Ejecuta el siguiente comando:\n`);
  console.log(`   mcp_supabase-mcp-server_apply_migration(`);
  console.log(`     project_id: "${SUPABASE_PROJECT_ID}",`);
  console.log(`     name: "${migrationName}",`);
  console.log(`     query: <contenido del archivo ${migrationFile}>`);
  console.log(`   )\n`);
  console.log(`3. O pídele al AI: "Aplica la migración ${migrationFile} a Supabase"\n`);

  return true;
}

// Main
const args = process.argv.slice(2);
const migrationFile = args[0];

if (!migrationFile) {
  console.log('📚 Migraciones disponibles:');
  if (fs.existsSync(MIGRATIONS_DIR)) {
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    files.forEach((file) => {
      console.log(`  - ${file}`);
    });
  } else {
    console.log('  No hay migraciones disponibles');
  }

  console.log('\n💡 Uso: node scripts/migrate.js <archivo-migracion.sql>');
  process.exit(0);
}

applyMigration(migrationFile);
