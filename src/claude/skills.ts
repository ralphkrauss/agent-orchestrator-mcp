import { constants, type Dirent } from 'node:fs';
import { access, copyFile, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

export interface ResolvedClaudeSkills {
  ephemeralRoot: string;
  orchestrationSkillNames: string[];
  sourceSkillRoot: string;
}

export async function curateOrchestrateSkills(input: {
  sourceSkillRoot: string;
  ephemeralSkillRoot: string;
}): Promise<ResolvedClaudeSkills> {
  await rm(input.ephemeralSkillRoot, { recursive: true, force: true });
  await mkdir(input.ephemeralSkillRoot, { recursive: true, mode: 0o700 });
  const orchestrationSkillNames = await listOrchestrationSkills(input.sourceSkillRoot);
  for (const name of orchestrationSkillNames) {
    const sourceFile = join(input.sourceSkillRoot, name, 'SKILL.md');
    const targetDir = join(input.ephemeralSkillRoot, name);
    const targetFile = join(targetDir, 'SKILL.md');
    await mkdir(targetDir, { recursive: true, mode: 0o700 });
    await copyFile(sourceFile, targetFile);
  }
  return {
    ephemeralRoot: input.ephemeralSkillRoot,
    orchestrationSkillNames,
    sourceSkillRoot: input.sourceSkillRoot,
  };
}

export async function listOrchestrationSkills(sourceSkillRoot: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = (await readdir(sourceSkillRoot, { withFileTypes: true })) as unknown as Dirent[];
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
    if (code === 'ENOENT') return [];
    throw error;
  }
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith('orchestrate-')) continue;
    const skillFile = join(sourceSkillRoot, entry.name, 'SKILL.md');
    try {
      // lstat (not stat) so symlinked SKILL.md never copies host content into
      // the curated envelope; only real regular files are accepted.
      const info = await lstat(skillFile);
      if (!info.isFile() || info.isSymbolicLink()) continue;
      await access(skillFile, constants.R_OK);
      names.push(entry.name);
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      if (code !== 'ENOENT') throw error;
    }
  }
  return names.sort();
}
