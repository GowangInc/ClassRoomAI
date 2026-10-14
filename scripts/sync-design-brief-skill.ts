import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

// Project source stays portable; fleet agents share the installed copy.
const source = join(import.meta.dir, '..', 'skills', 'classroomai-design-brief', 'SKILL.md');
const directory = join(homedir(), 'Sync', 'shared', 'skills', 'classroomai-design-brief');
const destination = join(directory, 'SKILL.md');
await mkdir(directory, { recursive: true });
await copyFile(source, destination);
assert.deepEqual(await readFile(destination), await readFile(source), 'Installed skill must match the project source');
console.log(`Installed ${destination}`);
