import argon2 from "argon2";
import { pool } from "../config/db";

async function fixPassords() {
  console.log("--- GENERATING VALID ARGON2ID HASHES FOR SEED USERS ---\n");

  const defaultPassword = "Password123!";

  // Generate mathematically valid Argon2id hash using local system parameters
  const validHash = await argon2.hash(defaultPassword, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  console.log(`Generated Valid Hash:\n${validHash}\n`);

  // Update all users in the database
  const result = await pool.query(
    `UPDATE users
    SET password_hash = $1
    RETURNING email, role;`,
    [validHash],
  );

  console.log("✅ Successfully updated passwords for:");
  result.rows.forEach((u) => {
    console.log(`   - [${u.role}] ${u.email}`);
  });

  console.log(
    `\nAll users can now log in with password: "${defaultPassword}"\n`,
  );
  await pool.end();
}

fixPassords().catch((err) => {
  console.error("Failed to update passwords: ", err);
  process.exit(1);
});
