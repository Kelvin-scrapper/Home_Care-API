const pool = require('../db');

// Single aggregate query set backing every role's dashboard. Each of the
// four dashboards (Volunteer/Coordinator/Director/Admin) reads only the
// fields it needs from this response. Deleted visits and deactivated users
// are left out of every figure.
async function getDashboard({ isOwnOnly, userId }) {
  const scopeClause = isOwnOnly ? 'deleted_at IS NULL AND created_by = $1' : 'deleted_at IS NULL';
  const scopeParams = isOwnOnly ? [userId] : [];

  const [
    myVisitsThisWeek,
    pendingFollowUps,
    recentSubmissions,
    activeVolunteers,
    teamVisitsToday,
    urgentEscalations,
    totalBeneficiaries,
    totalVisitsYtd,
    topVolunteers,
    totalSystemUsers,
  ] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS count FROM visits
       WHERE ${scopeClause} AND created_at >= date_trunc('week', now())`,
      scopeParams
    ),
    // Open follow-ups, and how many of them are due by the end of this week
    // (overdue included; those without a date count as due).
    pool.query(
      `SELECT COUNT(*)::int AS count,
              COUNT(*) FILTER (
                WHERE COALESCE(NULLIF(form_data->>'followUpDate', ''), '0000-00-00')
                      <= to_char(date_trunc('week', now()) + interval '6 days', 'YYYY-MM-DD')
              )::int AS due_this_week
       FROM visits
       WHERE ${scopeClause} AND follow_up_done_at IS NULL
         AND (urgency_level = 'Follow-up Needed' OR form_data->>'followUpRequired' = 'Yes')`,
      scopeParams
    ),
    pool.query(
      `SELECT id, beneficiary_name, location, urgency_level, volunteer_name, created_at
       FROM visits
       WHERE ${scopeClause}
       ORDER BY created_at DESC
       LIMIT 5`,
      scopeParams
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count FROM users
       WHERE role IN ('Volunteer/CHW', 'Coordinator/Field officer') AND deactivated_at IS NULL`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count FROM visits
       WHERE deleted_at IS NULL AND created_at >= date_trunc('day', now())`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count FROM visits
       WHERE deleted_at IS NULL AND urgency_level ILIKE 'Urgent%'`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count FROM beneficiaries b
       WHERE EXISTS (SELECT 1 FROM visits v WHERE v.beneficiary_id = b.id AND v.deleted_at IS NULL)`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count FROM visits
       WHERE deleted_at IS NULL AND created_at >= date_trunc('year', now())`
    ),
    pool.query(
      `SELECT volunteer_name AS name, COUNT(*)::int AS count
       FROM visits
       WHERE deleted_at IS NULL
       GROUP BY volunteer_name
       ORDER BY count DESC
       LIMIT 5`
    ),
    pool.query(`SELECT COUNT(*)::int AS count FROM users WHERE deactivated_at IS NULL`),
  ]);

  return {
    myVisitsThisWeek: myVisitsThisWeek.rows[0].count,
    pendingFollowUps: pendingFollowUps.rows[0].count,
    followUpsDueThisWeek: pendingFollowUps.rows[0].due_this_week,
    recentSubmissions: recentSubmissions.rows.map((r) => ({
      id: r.id,
      name: r.beneficiary_name,
      location: r.location,
      status: r.urgency_level || 'Routine',
      volunteerName: r.volunteer_name,
      createdAt: r.created_at,
    })),
    activeVolunteers: activeVolunteers.rows[0].count,
    teamVisitsToday: teamVisitsToday.rows[0].count,
    urgentEscalations: urgentEscalations.rows[0].count,
    totalBeneficiaries: totalBeneficiaries.rows[0].count,
    totalVisitsYtd: totalVisitsYtd.rows[0].count,
    activeFieldStaff: activeVolunteers.rows[0].count,
    criticalCases: urgentEscalations.rows[0].count,
    topVolunteers: topVolunteers.rows,
    totalSystemUsers: totalSystemUsers.rows[0].count,
  };
}

// Kitchen garden stages, in the order a garden moves through them.
const GARDEN_STAGES = ['Not started', 'Site identified', 'Garden Established', 'Crops Planted', 'Producing Food'];

// Counts of a multi-choice answer across all visits (e.g. support provided).
function answerCounts(field) {
  return pool.query(
    `SELECT answer AS label, COUNT(*)::int AS count
     FROM visits,
          jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(form_data->'${field}') = 'array' THEN form_data->'${field}' ELSE '[]'::jsonb END
          ) AS answer
     WHERE deleted_at IS NULL
     GROUP BY answer
     ORDER BY count DESC, answer`
  );
}

// The programme's reach, from what the form records: visits per month (the
// last 12, by visit date), visits per ward, the kinds of urgent concern, the
// support given, and where each household's kitchen garden stands (its most
// recent answer).
async function getImpact() {
  const [byMonth, byWard, concerns, support, gardens] = await Promise.all([
    pool.query(
      `SELECT to_char(m, 'YYYY-MM') AS month, COUNT(v.id)::int AS count
       FROM generate_series(
              date_trunc('month', now()) - interval '11 months',
              date_trunc('month', now()),
              interval '1 month'
            ) AS m
       LEFT JOIN visits v
         ON v.deleted_at IS NULL
        AND v.visit_date ~ '^[0-9]{4}-[0-9]{2}'
        AND substring(v.visit_date from 1 for 7) = to_char(m, 'YYYY-MM')
       GROUP BY m
       ORDER BY m`
    ),
    pool.query(
      `SELECT COALESCE(NULLIF(form_data->>'ward', ''), 'Not recorded') AS label, COUNT(*)::int AS count
       FROM visits WHERE deleted_at IS NULL
       GROUP BY 1 ORDER BY count DESC, label`
    ),
    answerCounts('urgentConcernTypes'),
    answerCounts('supportProvided'),
    pool.query(
      `SELECT status AS label, COUNT(*)::int AS count
       FROM (
         SELECT DISTINCT ON (beneficiary_id) form_data->>'gardenStatus' AS status
         FROM visits
         WHERE deleted_at IS NULL AND beneficiary_id IS NOT NULL
           AND COALESCE(form_data->>'gardenStatus', '') <> ''
         ORDER BY beneficiary_id, created_at DESC
       ) latest
       GROUP BY status`
    ),
  ]);

  const gardenCounts = new Map(gardens.rows.map((r) => [r.label, r.count]));
  return {
    visitsByMonth: byMonth.rows,
    visitsByWard: byWard.rows,
    urgentConcerns: concerns.rows,
    supportProvided: support.rows,
    gardenStages: GARDEN_STAGES.map((label) => ({ label, count: gardenCounts.get(label) || 0 })),
  };
}

module.exports = { getDashboard, getImpact };
