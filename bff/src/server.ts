import express from 'express';
import { getK8sBaseUrl } from './utils/k8sClient';
import { authMiddleware } from './middleware/auth';
import supersetDeployRouter from './routes/supersetDeploy';
import supersetStatusRouter from './routes/supersetStatus';
import supersetConfigRouter from './routes/supersetConfig';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/superset/deploy', authMiddleware, supersetDeployRouter);
app.use('/api/superset/status', authMiddleware, supersetStatusRouter);
app.use('/api/superset/config', authMiddleware, supersetConfigRouter);

app.listen(PORT, () => {
  try {
    const baseUrl = getK8sBaseUrl();
    console.log(`BFF listening on port ${PORT}`);
    console.log(`K8s API target: ${baseUrl}`);
  } catch {
    console.error(`BFF listening on port ${PORT}`);
    console.error('WARNING: K8s API is not configured. Set K8S_API_BASE or run in-cluster.');
    console.error('  Example: K8S_API_BASE=$(oc whoami --show-server) npm run start:dev');
    console.error('  All API requests will fail with 502 until this is set.');
  }
});

export default app;
