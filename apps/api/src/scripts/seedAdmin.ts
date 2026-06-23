import { GlobalRole } from '@cpwork/shared';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { usersRepo } from '../db/repositories/users.js';
import { hashPassword } from '../lib/password.js';

async function main() {
  getDb(); // ensures db file + migrations

  const { username, password, displayName } = config.seedAdmin;

  const existing = usersRepo.findByUsername(username);
  if (existing) {
    console.log(`[seed] User "${username}" already exists (id=${existing.id}). Nothing to do.`);
    return;
  }

  const passwordHash = await hashPassword(password);
  const user = usersRepo.create({
    username,
    displayName,
    passwordHash,
    globalRole: GlobalRole.SuperAdmin,
    status: 'active',
    mustChangePassword: true,
  });

  console.log('[seed] Created super admin:');
  console.log(`       username: ${user.username}`);
  console.log(`       id:       ${user.id}`);
  console.log('       NOTE: change this password on first login.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed] Failed:', err);
    process.exit(1);
  });
