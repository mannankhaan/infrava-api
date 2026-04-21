import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env';

// Route imports
import authRoutes from './modules/auth/auth.routes';
import adminRoutes from './modules/admin/admin.routes';
import operativeRoutes from './modules/operative/operative.routes';
import internalRoutes from './modules/internal/internal.routes';
import photosRoutes from './modules/photos/photos.routes';

// Middleware
import { auditMiddleware } from './shared/middleware/audit.middleware';

const app = express();

// Security
app.use(helmet({
  crossOriginResourcePolicy: false, // Allow loading images from different origins (R2)
}));
app.use(cors({
  origin: [
    env.APP_URL,
    'http://192.168.1.10:3000', // TODO: remove after deployment — local dev only
    'capacitor://localhost',   // iOS native app — keep in production
    'https://localhost',       // Android native app (androidScheme: 'https') — keep in production
  ],
  credentials: true,
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Audit logging for mutating requests
app.use(auditMiddleware);

// Health check
app.get('/api/v1/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/operative', operativeRoutes);
app.use('/api/v1/internal', internalRoutes);
app.use('/api/v1/photos', photosRoutes);

// 404
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

export default app;
