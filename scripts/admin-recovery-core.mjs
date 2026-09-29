export function validateRecoveryInput(input) {
  const username = String(input.username ?? "").trim().toLowerCase();
  const displayName = String(input.displayName ?? "").trim();
  const email = String(input.email ?? "").trim().toLowerCase();
  const password = String(input.password ?? "");
  const resetTwoFactor = input.resetTwoFactor !== false;

  if (!/^[a-z0-9._-]{3,100}$/.test(username)) throw new Error("Invalid administrator username");
  if (displayName.length < 2 || displayName.length > 150) throw new Error("Invalid administrator display name");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("Invalid administrator email");
  if (password.length < 14 || password.length > 256) throw new Error("Administrator password must contain 14 to 256 characters");
  return { username, displayName, email, password, resetTwoFactor };
}

export async function applyAdministratorRecovery(client, { ownerId, input, passwordHash, now }) {
  await client.query("BEGIN");
  try {
    const existing = await client.query(
      "SELECT id FROM pms_staff_users WHERE owner_id=$1 AND lower(username)=$2 FOR UPDATE",
      [ownerId, input.username],
    );
    let staffId;
    if (existing.rowCount) {
      staffId = existing.rows[0].id;
      await client.query(
        `UPDATE pms_staff_users
            SET display_name=$1,email=$2,password_hash=$3,role='owner',active=1,
                totp_secret=CASE WHEN $4 THEN '' ELSE totp_secret END,
                totp_confirmed_at=CASE WHEN $4 THEN NULL ELSE totp_confirmed_at END,
                recovery_codes_json=CASE WHEN $4 THEN '[]' ELSE recovery_codes_json END,
                updated_at=$5
          WHERE owner_id=$6 AND id=$7`,
        [input.displayName, input.email, passwordHash, input.resetTwoFactor, now, ownerId, staffId],
      );
    } else {
      const inserted = await client.query(
        `INSERT INTO pms_staff_users
           (owner_id,username,display_name,email,password_hash,totp_secret,totp_confirmed_at,recovery_codes_json,permissions_json,role,active,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,'',NULL,'[]','{}','owner',1,$6,$6) RETURNING id`,
        [ownerId, input.username, input.displayName, input.email, passwordHash, now],
      );
      staffId = inserted.rows[0].id;
    }
    await client.query("UPDATE pms_staff_users SET active=0,updated_at=$1 WHERE owner_id=$2 AND role='owner' AND id<>$3", [now, ownerId, staffId]);
    await client.query("UPDATE pms_sessions SET revoked_at=$1 WHERE owner_id=$2 AND revoked_at IS NULL", [now, ownerId]);
    await client.query("DELETE FROM pms_login_attempts");
    await client.query("COMMIT");
    return staffId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
