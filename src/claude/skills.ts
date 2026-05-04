import { constants, type Dirent } from 'node:fs';
import { access, copyFile, lstat, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

export interface ResolvedClaudeSkills {
  ephemeralRoot: string;
  orchestrationSkillNames: string[];
  orchestrationSkills: ResolvedClaudeSkill[];
  sourceSkillRoot: string;
}

export interface MirroredClaudeSkills {
  sourceSkillRoot: string;
  targetSkillRoot: string;
  skillNames: string[];
}

export interface ResolvedClaudeSkill {
  name: string;
  content: string;
}

export async function curateOrchestrateSkills(input: {
  sourceSkillRoot: string;
  ephemeralSkillRoot: string;
}): Promise<ResolvedClaudeSkills> {
  await rm(input.ephemeralSkillRoot, { recursive: true, force: true });
  await mkdir(input.ephemeralSkillRoot, { recursive: true, mode: 0o700 });
  const orchestrationSkillNames = await listOrchestrationSkills(input.sourceSkillRoot);
  const orchestrationSkills: ResolvedClaudeSkill[] = [];
  for (const name of orchestrationSkillNames) {
    const sourceFile = join(input.sourceSkillRoot, name, 'SKILL.md');
    const targetDir = join(input.ephemeralSkillRoot, name);
    const targetFile = join(targetDir, 'SKILL.md');
    await mkdir(targetDir, { recursive: true, mode: 0o700 });
    await copyFile(sourceFile, targetFile);
    orchestrationSkills.push({ name, content: await readFile(sourceFile, 'utf8') });
  }
  return {
    ephemeralRoot: input.ephemeralSkillRoot,
    orchestrationSkillNames,
    orchestrationSkills,
    sourceSkillRoot: input.sourceSkillRoot,
  };
}

export async function listOrchestrationSkills(sourceSkillRoot: string): Promise<string[]> {
  const names = await listClaudeSkills(sourceSkillRoot);
  return names.filter((name) => name.startsWith('orchestrate-'));
}

export async function mirrorClaudeProjectSkills(input: {
  sourceSkillRoot: string;
  targetSkillRoot: string;
}): Promise<MirroredClaudeSkills> {
  await rm(input.targetSkillRoot, { recursive: true, force: true });
  await mkdir(input.targetSkillRoot, { recursive: true, mode: 0o700 });
  const skillNames = await listClaudeSkills(input.sourceSkillRoot);
  for (const name of skillNames) {
    await copyDirectoryWithoutSymlinks(
      join(input.sourceSkillRoot, name),
      join(input.targetSkillRoot, name),
    );
  }
  return {
    sourceSkillRoot: input.sourceSkillRoot,
    targetSkillRoot: input.targetSkillRoot,
    skillNames,
  };
}

async function listClaudeSkills(sourceSkillRoot: string): Promise<string[]> {
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
    const skillFile = join(sourceSkillRoot, entry.name, 'SKILL.md');
    try {
      // lstat (not stat) so symlinked SKILL.md never copies host content into
      // the curated envelope or runtime skill mirror; only real regular files
      // are accepted.
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

async function copyDirectoryWithoutSymlinks(sourceDir: string, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true, mode: 0o700 });
  const entries = (await readdir(sourceDir, { withFileTypes: true })) as unknown as Dirent[];
  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    const info = await lstat(sourcePath);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) {
      await copyDirectoryWithoutSymlinks(sourcePath, targetPath);
    } else if (info.isFile()) {
      await copyFile(sourcePath, targetPath);
    }
  }
}
