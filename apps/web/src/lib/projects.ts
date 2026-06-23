import type { Project, ProjectRole } from '@cpwork/shared';

export interface ProjectListItem extends Project {
  myRole: ProjectRole | null;
  hasEnvironment: boolean;
  environmentVerified: boolean;
}
