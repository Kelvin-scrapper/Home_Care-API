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
    pool.query(
      `SELECT COUNT(*)::int AS count FROM visits
       WHERE ${scopeClause}
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

module.exports = { getDashboard };
