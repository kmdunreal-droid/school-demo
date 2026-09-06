const { neon } = require("@neondatabase/serverless");
const sql = neon("postgresql://neondb_owner:npg_uHRTvXQ2f4zJ@ep-misty-sky-aybucjjd-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require");
async function main() {
  try {
    // Create fee_data table
    await sql`
      CREATE TABLE IF NOT EXISTS fee_data (
        id TEXT PRIMARY KEY,
        name TEXT,
        class TEXT,
        monthly_fee INTEGER DEFAULT 0,
        enrollment_month TEXT,
        payments JSONB DEFAULT \'[]\'::jsonb,
        other_funds JSONB DEFAULT \'[]\'::jsonb,
        dues JSONB DEFAULT \'[]\'::jsonb,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;
    console.log("fee_data table created");

    // Create fees table
    await sql`
      CREATE TABLE IF NOT EXISTS fees (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        due_date TEXT,
        status TEXT DEFAULT \'pending\',
        paid_date TEXT,
        month TEXT,
        payment_method TEXT,
        fee_type TEXT,
        description TEXT,
        due_id TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    console.log("fees table created");

    // Create sync_meta table
    await sql`
      CREATE TABLE IF NOT EXISTS sync_meta (
        id TEXT PRIMARY KEY DEFAULT \'device_sync\',
        last_sync_at TIMESTAMP DEFAULT NOW(),
        device_id TEXT,        data_hash TEXT
      )
    `;
    console.log("sync_meta table created");

    console.log("ALL TABLES READY");
  } catch(e) {
    console.error("ERROR:", e.message);
  }
}
main();
