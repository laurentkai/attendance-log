async function recordStudentActivity(client, studentId, occurredAt = null) {
  const result = await client.query(
    `UPDATE students
     SET last_activity_at = GREATEST(
       COALESCE(last_activity_at, COALESCE($2::timestamptz, CURRENT_TIMESTAMP)),
       COALESCE($2::timestamptz, CURRENT_TIMESTAMP)
     )
     WHERE id = $1
     RETURNING last_activity_at`,
    [studentId, occurredAt],
  );
  return result.rows[0]?.last_activity_at || null;
}

module.exports = { recordStudentActivity };
