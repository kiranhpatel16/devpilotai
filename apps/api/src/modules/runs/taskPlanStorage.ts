import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';

const TASK_PLANS_DIR = path.join(config.repoRoot, 'data', 'task-plans');

function sanitizeSegment(value: string): string {
  const cleaned = value.trim().replace(/[^\w.\-]+/g, '-');
  return cleaned || 'unknown';
}

function uniquePlanFileName(taskKey: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${taskKey}-${stamp}.md`;
}

export function saveTaskPlan(opts: {
  projectSlug: string;
  projectName: string;
  taskKey: string;
  planText: string;
}): string {
  const key = sanitizeSegment(opts.taskKey);
  const projectDir = sanitizeSegment(opts.projectSlug || opts.projectName);
  const folder = path.join(TASK_PLANS_DIR, projectDir, key);
  fs.mkdirSync(folder, { recursive: true });
  const filePath = path.join(folder, uniquePlanFileName(key));
  fs.writeFileSync(filePath, `${opts.planText.trim()}\n`, 'utf8');
  return filePath;
}
