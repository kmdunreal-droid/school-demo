const { neon } = require("@neondatabase/serverless");
const sql = neon("postgresql://neondb_owner:npg_uHRTvXQ2f4zJ@ep-misty-sky-aybucjjd-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require");
async function main() {
  try {
    const r = await sql`SELECT COUNT(*) as c FROM fee_data`;
    console.log("fee_data rows:", r[0].c);
    const r2 = await sql`SELECT COUNT(*) as c FROM fees`;
    console.log("fees rows:", r2[0].c);
    console.log("NEON ACTIVE");
  } catch(e) {
    console.error("NEON ERROR:", e.message);
  }
}
main();
