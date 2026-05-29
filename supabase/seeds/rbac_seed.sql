-- Idempotent RBAC seed.
-- Uses ON CONFLICT to avoid duplicates.

INSERT INTO public.roles(name, slug, description, role_type, is_system_role)
VALUES
('Super Admin', 'super-admin', 'System wide unrestricted control', 'system', true),
('System Admin', 'system-admin', 'Platform administration role', 'admin', true),
('Contest Manager', 'contest-manager', 'Manages assigned contests', 'program', true),
('State Coordinator', 'state-coordinator', 'State-level operations', 'program', true),
('Judge', 'judge', 'Contest scoring and judging', 'program', true),
('Contestant', 'contestant', 'Participant role', 'contestant', true),
('Sponsor Representative', 'sponsor-representative', 'Sponsor account role', 'partner', true),
('School Representative', 'school-representative', 'School account role', 'school', true),
('Registered User', 'registered-user', 'Default authenticated user role', 'public', true),
('Verified User', 'verified-user', 'Verified account role', 'public', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.permissions(name, slug, module, resource, action, description, is_system_permission)
VALUES
('View Users','users.view','users','account','view','Can view users',true),
('Edit Users','users.update','users','account','update','Can edit users',true),
('Suspend Users','users.suspend','users','account','suspend','Can suspend users',true),
('Assign Roles','users.roles.assign','users','roles','assign','Can assign roles',true),
('View Roles','roles.view','roles','role','view','Can view roles',true),
('Create Roles','roles.create','roles','role','create','Can create roles',true),
('Update Roles','roles.update','roles','role','update','Can update roles',true),
('Delete Roles','roles.delete','roles','role','delete','Can delete roles',true),
('Assign Permissions','permissions.assign','permissions','permission','assign','Can assign permissions',true),
('View Permissions','permissions.view','permissions','permission','view','Can view permissions',true),
('Delete Permissions','permissions.delete','permissions','permission','delete','Can delete custom permissions',true),
('Create Contest','contest.create','contest','contest','create','Can create contests',true),
('Update Contest','contest.update','contest','contest','update','Can update contests',true),
('Publish Contest','contest.publish','contest','contest','publish','Can publish contests',true),
('View Contestants','contestant.view','contestant','contestant','view','Can view contestants',true),
('Approve Contestants','contestant.approve','contestant','contestant','approve','Can approve contestants',true),
('Reject Contestants','contestant.reject','contestant','contestant','reject','Can reject contestants',true),
('Score Submissions','judge.score','judging','submission','score','Can score submissions',true),
('View Finance','finance.view','finance','ledger','view','Can view finance data',true),
('Process Refund','payments.refund','payments','refund','process','Can process refunds',true),
('View Audit Logs','audit.logs.view','audit','log','view','Can view audit logs',true),
('Export Audit Logs','audit.logs.export','audit','log','export','Can export audit logs',true),
('Override Voting Result','votes.override','votes','result','override','High risk voting override',true),
('View Own Profile','users.profile.view','users','profile','view','Can view own profile',true),
('Update Own Profile','users.profile.update','users','profile','update','Can update own profile',true)
ON CONFLICT (slug) DO NOTHING;
