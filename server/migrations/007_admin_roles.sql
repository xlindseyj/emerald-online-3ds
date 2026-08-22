ALTER TABLE identity_roles
  DROP CONSTRAINT identity_roles_role_check;

ALTER TABLE identity_roles
  ADD CONSTRAINT identity_roles_role_check
  CHECK (role IN ('moderator', 'admin'));

-- Project owner account. Roles are bound to the stable public fingerprint,
-- never to a mutable trainer/display name.
INSERT INTO identity_roles (identity_id, role)
SELECT id, 'admin'
FROM identities
WHERE fingerprint = '36D69602C7'
ON CONFLICT (identity_id, role) DO NOTHING;
