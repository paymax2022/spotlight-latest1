export function mapPrizeRow(row: any) {
  return {
    id: row.id,
    connectContestId: row.connect_contest_id,
    position: row.position,
    prizeDescription: row.prize_description,
    prizeValueKobo: row.prize_value_kobo != null ? Number(row.prize_value_kobo) : null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Postgres unique_violation. Used to map the DB's UNIQUE(connect_contest_id, position)
// constraint into a clean 409 instead of a raw 500.
export const UNIQUE_VIOLATION = '23505';
