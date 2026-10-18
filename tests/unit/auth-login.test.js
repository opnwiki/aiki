import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export async function run({ assert }) {
  const login = await readFile(path.join(root, 'server/api/auth/login.post.js'), 'utf8')
  assert.match(login, /VALUES \(\$1::uuid, 'signed_in', 'actor', \$2::text\)/, 'audit actor UUID and text target need independent PostgreSQL parameter types')
  assert.match(login, /\[actor\.id, actor\.id\]/, 'use the actor UUID for actor_id and its text form for target_id')
}
