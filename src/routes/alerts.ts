import { Router, Request, Response } from 'express';
import { Storage } from '../storage';
import { AlertService } from '../services/alertService';
import { success, notFound, badRequest } from '../utils/response';

const router = Router();
const storage = Storage.getInstance();
const alertService = new AlertService();

router.get('/', (req: Request, res: Response) => {
  const { waybillId, vehicleId, status } = req.query;
  const alerts = storage.getAlerts(
    waybillId as string | undefined,
    vehicleId as string | undefined,
    status as string | undefined
  );
  success(res, { alerts, total: alerts.length });
});

router.get('/:id', (req: Request, res: Response) => {
  const alert = storage.getAlertById(req.params.id);
  if (!alert) {
    return notFound(res, '告警不存在');
  }
  success(res, alert);
});

router.get('/waybill/:waybillId', (req: Request, res: Response) => {
  const alerts = storage.getAlerts(req.params.waybillId);
  const stats = {
    total: alerts.length,
    pending: alerts.filter(a => a.status === 'pending').length,
    processing: alerts.filter(a => a.status === 'processing').length,
    resolved: alerts.filter(a => a.status === 'resolved').length,
    ignored: alerts.filter(a => a.status === 'ignored').length,
    highLevel: alerts.filter(a => a.alertLevel === 'high' || a.alertLevel === 'critical').length,
  };
  success(res, { alerts, stats });
});

router.post('/:id/handle', (req: Request, res: Response) => {
  const { handlerId, handlerName, handleMethod, handleRemark, handlePhotos, result } = req.body;
  if (!handlerName) {
    return badRequest(res, '处理人姓名不能为空');
  }
  const alert = alertService.resolveAlert(req.params.id, {
    handlerId,
    handlerName,
    handleMethod,
    handleRemark,
    handlePhotos,
    result,
  });
  if (!alert) {
    return notFound(res, '告警不存在');
  }
  success(res, alert, '告警处理完成');
});

router.post('/:id/acknowledge', (req: Request, res: Response) => {
  const { handlerId, handlerName } = req.body;
  const alert = storage.updateAlert(req.params.id, {
    status: 'processing',
    handlerId,
    handlerName,
    handleTime: Date.now(),
  });
  if (!alert) {
    return notFound(res, '告警不存在');
  }
  success(res, alert, '告警已确认');
});

router.post('/:id/ignore', (req: Request, res: Response) => {
  const { handlerId, handlerName, handleRemark } = req.body;
  const now = Date.now();
  const alert = storage.updateAlert(req.params.id, {
    status: 'ignored',
    endTime: now,
    handlerId,
    handlerName,
    handleTime: now,
    handleRemark,
    result: '已忽略',
  });
  if (!alert) {
    return notFound(res, '告警不存在');
  }
  success(res, alert, '告警已忽略');
});

router.get('/vehicle/:vehicleId/active', (req: Request, res: Response) => {
  const waybill = storage.getActiveWaybillByVehicle(req.params.vehicleId);
  if (!waybill) {
    return success(res, { alerts: [], total: 0 });
  }
  const alerts = storage.getAlerts(waybill.id).filter(a => a.status !== 'resolved' && a.status !== 'ignored');
  success(res, { alerts, total: alerts.length, waybillId: waybill.id });
});

export default router;
