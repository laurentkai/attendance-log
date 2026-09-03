const roles = Object.freeze({
  administrator: 'administrator',
  manager: 'manager',
  attendanceOperator: 'attendance_operator',
});

const permissions = Object.freeze({
  viewSessions: 'sessions.view',
  manageSessions: 'sessions.manage',
  manageAttendance: 'attendance.manage',
  manageStudents: 'students.manage',
  manageClasses: 'classes.manage',
  viewReporting: 'reporting.view',
  manageSettings: 'settings.manage',
  manageUsers: 'users.manage',
});

const rolePermissions = Object.freeze({
  [roles.administrator]: new Set(Object.values(permissions)),
  [roles.manager]: new Set([
    permissions.viewSessions,
    permissions.manageSessions,
    permissions.manageAttendance,
    permissions.manageStudents,
    permissions.manageClasses,
    permissions.viewReporting,
  ]),
  [roles.attendanceOperator]: new Set([
    permissions.viewSessions,
    permissions.manageAttendance,
  ]),
});

function hasPermission(user, permission) {
  return Boolean(user && rolePermissions[user.role]?.has(permission));
}

module.exports = { hasPermission, permissions, roles };
