import { Router } from 'express';
import * as ctrl from './internal.controller';

const router = Router();

router.post('/photo-cleanup', ctrl.photoCleanup);

export default router;
