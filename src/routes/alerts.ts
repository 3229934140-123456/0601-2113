import { Router, Request, Response } from 'express';
import { Storage } from '../storage';
import { AlertService } from '../services/alertService';
import { success, notFound, badRequest } from '../utils/response';

const router = Router();
const storage = Storage.getInstance();
const alertService = new AlertService();

router.get('/', (req: Request, res: Response) => {
  const { waybillId, vehicleId, status, includeObserving } = req.query;
  let alerts = storage.getAlerts(
    waybillId as string | undefined,
    vehicleId as string | undefined,
    status as string | undefined
  );
  if (includeObserving !== 'true') {
    alerts = alerts.filter(a => a.status !== 'observing');
  }
  success(res, { alerts, total: alerts.length });
});

router.get('/:id', (req: Request, res: Response) => {
  const alert = storage.getAlertById(req.params.id);
  if (!alert) {
    return notFound(res, '告警不存在');
  }
  success(res, {
    ...alert,
    handlingInfo: alert.status !== 'observing' ? {
      handlerId: alert.handlerId,
      handlerName: alert.handlerName,
      handleTime: alert.handleTime,
      handleMethod: alert.handleMethod,
      handleRemark: alert.handleRemark,
      handlePhotos: alert.handlePhotos,
      result: alert.result,
    } : undefined,
  });
});

router.get('/waybill/:waybillId', (req: Request, res: Response) => {
  const allAlerts = storage.getAlerts(req.params.waybillId);
  const alerts = allAlerts.filter(a => a.status !== 'observing');
  const pendingList = alerts.filter(a => a.status === 'pending');
  const processingList = alerts.filter(a => a.status === 'processing');
  const resolvedList = alerts.filter(a => a.status === 'resolved');
  const ignoredList = alerts.filter(a => a.status === 'ignored');

  const handlingRecords = alerts
    .filter(a => a.status === 'processing' || a.status === 'resolved' || a.status === 'ignored')
    .map(a => ({
      alertId: a.id,
      alertType: a.alertType,
      alertLevel: a.alertLevel,
      description: a.description,
      startTime: a.startTime,
      endTime: a.endTime,
      durationSeconds: a.durationSeconds,
      status: a.status,
      handlerId: a.handlerId,
      handlerName: a.handlerName,
      handleTime: a.handleTime,
      handleMethod: a.handleMethod,
      handleRemark: a.handleRemark,
      handlePhotos: a.handlePhotos,
      result: a.result,
    }));

  const stats = {
    total: alerts.length,
    pending: pendingList.length,
    processing: processingList.length,
    resolved: resolvedList.length,
    ignored: ignoredList.length,
    highLevel: alerts.filter(a => a.alertLevel === 'high' || a.alertLevel === 'critical').length,
    totalHandled: processingList.length + resolvedList.length + ignoredList.length,
  };
  success(res, { alerts, stats, handlingRecords });
});

router.post('/:id/acknowledge', (req: Request, res: Response) => {
  const { handlerId, handlerName } = req.body;
  if (!handlerName) {
    return badRequest(res, '处理人姓名不能为空');
  }
  const alert = alertService.acknowledgeAlert(req.params.id, { handlerId, handlerName });
  if (!alert) {
    return notFound(res, '告警不存在或已完成处理');
  }
  success(res, alert, '告警已确认，等待处置');
});

router.post('/:id/handle', (req: Request, res: Response) => {
  const {
    handlerId, handlerName, handleMethod, handleRemark, handlePhotos, result,
  } = req.body;
  if (!handlerName) {
    return badRequest(res, '处理人姓名不能为空');
  }
  if (!handleMethod) {
    return badRequest(res, '处置方式不能为空');
  }
  if (handlePhotos && !Array.isArray(handlePhotos)) {
    return badRequest(res, 'handlePhotos 必须是字符串数组');
  }
  const alert = alertService.resolveAlert(req.params.id, {
    handlerId,
    handlerName,
    handleMethod,
    handleRemark,
    handlePhotos: handlePhotos || [],
    result,
  });
  if (!alert) {
    return notFound(res, '告警不存在');
  }
  success(res, alert, '告警处置完成');
});

router.post('/:id/ignore', (req: Request, res: Response) => {
  const { handlerId, handlerName, handleRemark } = req.body;
  if (!handlerName) {
    return badRequest(res, '处理人姓名不能为空');
  }
  const now = Date.now();
  const current = storage.getAlertById(req.params.id);
  if (!current) {
    return notFound(res, '告警不存在');
  }
  const endTime = current.endTime || now;
  const durationSeconds = Math.max(0, Math.floor((endTime - current.startTime) / 1000));
  const alert = storage.updateAlert(req.params.id, {
    status: 'ignored',
    endTime,
    durationSeconds,
    handlerId,
    handlerName,
    handleTime: now,
    handleRemark: handleRemark || '',
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
    return success(res, { alerts: [], processing: [], total: 0 });
  }
  const allAlerts = storage.getAlerts(waybill.id);
  const pending = allAlerts.filter(a => a.status === 'pending');
  const processing = allAlerts.filter(a => a.status === 'processing');
  success(res, {
    waybillId: waybill.id,
    waybillNo: waybill.waybillNo,
    pending,
    processing,
    total: pending.length + processing.length,
  });
});

export default router;
