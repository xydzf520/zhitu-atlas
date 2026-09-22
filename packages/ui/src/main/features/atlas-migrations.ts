import { compactAnalysisData } from './atlas-analysis-storage'
// Migrations are append-only. Each version and its journal entry commit together.
const migrations = [
  `CREATE TABLE IF NOT EXISTS documents(key TEXT PRIMARY KEY, value TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS profile_versions(id TEXT PRIMARY KEY, version INTEGER NOT NULL UNIQUE, value TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, kind TEXT NOT NULL, entity_id TEXT NOT NULL, value TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS events_entity ON events(entity_id, created_at);
   CREATE TABLE IF NOT EXISTS send_attempts(id TEXT PRIMARY KEY, platform TEXT NOT NULL, account_id TEXT NOT NULL, recipient_id TEXT NOT NULL, kind TEXT NOT NULL, automatic INTEGER NOT NULL, status TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS sends_time ON send_attempts(created_at);
   CREATE TABLE IF NOT EXISTS leases(key TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL);`,
  `CREATE TABLE IF NOT EXISTS opportunities(id TEXT PRIMARY KEY, body TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
   CREATE TABLE IF NOT EXISTS related(id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL REFERENCES opportunities(id), kind TEXT NOT NULL, body TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
   CREATE INDEX IF NOT EXISTS related_opportunity ON related(opportunity_id,kind);
   CREATE TABLE IF NOT EXISTS entities(id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS opportunity_links(opportunity_id TEXT NOT NULL REFERENCES opportunities(id), entity_id TEXT NOT NULL REFERENCES entities(id), role TEXT NOT NULL, PRIMARY KEY(opportunity_id,entity_id,role));
   CREATE INDEX IF NOT EXISTS sends_conversation ON send_attempts(platform,account_id,recipient_id,created_at);`,
  `CREATE TABLE platform_jobs(platform TEXT NOT NULL,account_id TEXT NOT NULL,source_id TEXT NOT NULL,body TEXT NOT NULL,observed_at TEXT NOT NULL,detail_at TEXT NOT NULL DEFAULT '',PRIMARY KEY(platform,account_id,source_id));
   CREATE TABLE platform_conversations(platform TEXT NOT NULL,account_id TEXT NOT NULL,source_id TEXT NOT NULL,body TEXT NOT NULL,observed_at TEXT NOT NULL,message_observed_at TEXT NOT NULL DEFAULT '',PRIMARY KEY(platform,account_id,source_id));
   CREATE TABLE platform_messages(platform TEXT NOT NULL,account_id TEXT NOT NULL,conversation_id TEXT NOT NULL,source_id TEXT NOT NULL,body TEXT NOT NULL,sent_at TEXT NOT NULL,observed_at TEXT NOT NULL,PRIMARY KEY(platform,account_id,conversation_id,source_id));
   CREATE INDEX platform_messages_timeline ON platform_messages(platform,account_id,conversation_id,sent_at DESC,source_id DESC);
   CREATE INDEX platform_messages_account ON platform_messages(platform,account_id,sent_at);
   CREATE TABLE platform_job_history(id TEXT PRIMARY KEY,platform TEXT NOT NULL,account_id TEXT NOT NULL,source_id TEXT NOT NULL,body TEXT NOT NULL,observed_at TEXT NOT NULL);
   CREATE INDEX platform_jobs_history ON platform_job_history(platform,account_id,source_id,observed_at DESC);`,
  `CREATE TABLE task_runs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,account_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,state TEXT NOT NULL,step TEXT NOT NULL,input TEXT NOT NULL,result TEXT,error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,heartbeat_at TEXT NOT NULL);
   CREATE INDEX task_runs_list ON task_runs(account_id,state,updated_at DESC);
   CREATE UNIQUE INDEX task_runs_active ON task_runs(idempotency_key) WHERE state IN ('queued','running');
   CREATE TABLE legacy_records(source_table TEXT NOT NULL,source_id TEXT NOT NULL,account_id TEXT NOT NULL,body TEXT NOT NULL,imported_at TEXT NOT NULL,PRIMARY KEY(source_table,source_id,account_id));
   CREATE INDEX legacy_records_account ON legacy_records(account_id,source_table,source_id);
   CREATE TABLE ai_calls(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,kind TEXT NOT NULL,day TEXT NOT NULL,automatic INTEGER NOT NULL,model TEXT NOT NULL,status TEXT NOT NULL,usage TEXT,elapsed_ms INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
   CREATE INDEX ai_calls_budget ON ai_calls(day,kind,automatic,account_id);`,
  `ALTER TABLE send_attempts ADD COLUMN context TEXT NOT NULL DEFAULT '{}';
   ALTER TABLE send_attempts ADD COLUMN proof TEXT NOT NULL DEFAULT '{}';
   CREATE TABLE contact_runs(id TEXT PRIMARY KEY,platform TEXT NOT NULL,account_id TEXT NOT NULL,job_id TEXT NOT NULL,recruiter_id TEXT NOT NULL,state TEXT NOT NULL,body TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(platform,account_id,job_id),UNIQUE(platform,account_id,recruiter_id));
   CREATE INDEX contact_runs_queue ON contact_runs(account_id,state,updated_at);
   CREATE TABLE contact_reservations(task_id TEXT PRIMARY KEY,day TEXT NOT NULL,account_id TEXT NOT NULL,slots INTEGER NOT NULL,first_contact INTEGER NOT NULL);
   CREATE TABLE job_observations(id TEXT PRIMARY KEY,platform TEXT NOT NULL,account_id TEXT NOT NULL,job_id TEXT NOT NULL,origin TEXT NOT NULL,run_id TEXT NOT NULL,change_kind TEXT NOT NULL,observed_at TEXT NOT NULL);
   CREATE INDEX job_observations_source ON job_observations(account_id,observed_at,origin);
   CREATE INDEX contact_messages ON send_attempts(platform,account_id,kind,status,created_at);`,
  (db: any) => {
    db.exec(`CREATE TABLE IF NOT EXISTS analysis_contents(id TEXT PRIMARY KEY,body TEXT NOT NULL,bytes INTEGER NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS documents_prefix ON documents(key COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS documents_family ON documents(substr(key,1,instr(key,'/')-1),updated_at DESC,key);
      CREATE INDEX IF NOT EXISTS task_runs_history ON task_runs(account_id,created_at DESC,id);
      CREATE INDEX IF NOT EXISTS task_runs_dispatch ON task_runs(account_id,state,COALESCE(json_extract(input,'$.automatic'),0),created_at);
      CREATE INDEX IF NOT EXISTS platform_jobs_observed ON platform_jobs(platform,account_id,observed_at DESC,source_id);
      CREATE INDEX IF NOT EXISTS opportunity_links_entity ON opportunity_links(entity_id,role,opportunity_id);`)
    compactAnalysisData(db)
    db.exec('CREATE TABLE IF NOT EXISTS storage_revisions(scope TEXT PRIMARY KEY,revision INTEGER NOT NULL)')
    for (const table of ['documents','platform_jobs','platform_conversations','opportunities','contact_runs']) for (const op of ['INSERT','UPDATE','DELETE']) {
      const alias = op === 'DELETE' ? 'OLD' : 'NEW'
      const scope = table === 'documents' ? `CASE WHEN instr(${alias}.key,'/')>0 THEN substr(${alias}.key,1,instr(${alias}.key,'/')-1) ELSE ${alias}.key END` : `'${table}'`
      db.exec(`CREATE TRIGGER IF NOT EXISTS storage_${table}_${op} AFTER ${op} ON ${table} BEGIN INSERT INTO storage_revisions VALUES(${scope},1) ON CONFLICT(scope) DO UPDATE SET revision=revision+1; END;`)
    }
  },
  `CREATE TABLE execution_runs(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,owner_kind TEXT NOT NULL,owner_id TEXT NOT NULL,title TEXT NOT NULL,object_kind TEXT NOT NULL DEFAULT '',object_id TEXT NOT NULL DEFAULT '',source TEXT NOT NULL,parent_id TEXT NOT NULL DEFAULT '',origin_ref TEXT NOT NULL DEFAULT '',state TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',paused INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
   CREATE INDEX execution_runs_list ON execution_runs(account_id,state,updated_at DESC,id);
   CREATE INDEX execution_runs_object ON execution_runs(account_id,object_kind,object_id,updated_at DESC);
   CREATE INDEX execution_runs_parent ON execution_runs(account_id,parent_id);
   CREATE TABLE execution_steps(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES execution_runs(id),parent_id TEXT NOT NULL DEFAULT '',actor TEXT NOT NULL,label TEXT NOT NULL,state TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',basis TEXT NOT NULL DEFAULT '{}',output TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,started_at TEXT NOT NULL DEFAULT '',finished_at TEXT NOT NULL DEFAULT '',heartbeat_at TEXT NOT NULL);
   CREATE INDEX execution_steps_run ON execution_steps(run_id,created_at,id);
   CREATE TABLE execution_links(kind TEXT NOT NULL,ref_id TEXT NOT NULL,run_id TEXT NOT NULL REFERENCES execution_runs(id),step_id TEXT NOT NULL DEFAULT '',PRIMARY KEY(kind,ref_id));
   CREATE INDEX execution_links_run ON execution_links(run_id);
   CREATE TABLE execution_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL REFERENCES execution_runs(id),step_id TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL,state TEXT NOT NULL DEFAULT '',summary TEXT NOT NULL,created_at TEXT NOT NULL);
   CREATE INDEX execution_events_run ON execution_events(run_id,sequence);
   CREATE TABLE execution_subjects(run_id TEXT NOT NULL REFERENCES execution_runs(id),kind TEXT NOT NULL,ref_id TEXT NOT NULL,PRIMARY KEY(run_id,kind,ref_id));
   CREATE INDEX execution_subjects_lookup ON execution_subjects(ref_id,kind,run_id);`
]
export const atlasSchemaVersion = migrations.length
export function migrateAtlasSchema(db: any) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(
      'CREATE TABLE IF NOT EXISTS atlas_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)'
    )
    const rows = db.prepare('SELECT version FROM atlas_migrations ORDER BY version').all()
    if (
      rows.some((row: any, i: number) => row.version !== i + 1) ||
      rows.length > atlasSchemaVersion
    )
      throw new Error('数据库版本较新或迁移记录不完整，请使用对应版本；原数据未改变')
    for (let i = rows.length; i < migrations.length; i++) {
      const migration = migrations[i]
      if (typeof migration === 'string') db.exec(migration)
      else migration(db)
      db.prepare('INSERT INTO atlas_migrations VALUES(?,?)').run(i + 1, new Date().toISOString())
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
