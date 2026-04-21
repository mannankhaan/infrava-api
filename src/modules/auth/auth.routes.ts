import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { validate } from '../../shared/middleware/validate.middleware';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { loginSchema, forgotPasswordSchema, resetPasswordSchema, signupSchema, verifyEmailSchema } from './auth.schemas';
import * as authController from './auth.controller';

const router = Router();

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// Rate limit: 10 attempts/15min/IP on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Too many attempts, try again in 15 minutes' },
});

router.post('/signup', authLimiter, validate(signupSchema), authController.signup);
router.post('/verify-email', authLimiter, validate(verifyEmailSchema), authController.verifyEmail);
router.post('/login', authLimiter, validate(loginSchema), authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.post('/logout-all', authMiddleware, authController.logoutAll);
router.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', authLimiter, validate(resetPasswordSchema), authController.resetPassword);
router.post('/avatar', authMiddleware, avatarUpload.single('avatar'), authController.uploadAvatar);

export default router;
