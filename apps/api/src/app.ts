import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { errorHandler } from './middleware/errorHandler.js';
import authRoutes from './modules/auth/auth.routes.js';
import adminUsersRoutes from './modules/admin/users.routes.js';
import adminProjectsRoutes from './modules/admin/projects.routes.js';
import adminActivitiesRoutes from './modules/admin/activities.routes.js';
import adminAiProvidersRoutes from './modules/admin/aiProviders.routes.js';
import projectsRoutes from './modules/projects/projects.routes.js';
import jiraRoutes from './modules/jira/jira.routes.js';
import aiRoutes from './modules/ai/ai.routes.js';
import runsRoutes from './modules/runs/runs.routes.js';

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: config.webOrigin,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'cpwork-api', env: config.env });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/admin/users', adminUsersRoutes);
  app.use('/api/admin/projects', adminProjectsRoutes);
  app.use('/api/admin/activities', adminActivitiesRoutes);
  app.use('/api/admin/ai-providers', adminAiProvidersRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/projects/:projectId/jira', jiraRoutes);
  app.use('/api/projects', projectsRoutes);
  app.use('/api/runs', runsRoutes);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found', code: 'not_found' });
  });

  app.use(errorHandler);
  return app;
}
