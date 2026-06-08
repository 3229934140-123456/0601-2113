import { Router, Request, Response } from 'express';
import { Storage } from '../storage';
import { success, notFound, badRequest } from '../utils/response';

const router = Router();
const storage = Storage.getInstance();

function calcDurationAndStats(waybillId: string) {
  const allAlerts = storage.getAlerts(waybillId);
  const alerts = allAlerts.filter(a => a.status !== 'observing');
  const records = storage.getTemperatureRecords(waybillId);
  const doorEvents = storage.getDoorEvents(waybillId);

  const typeStats: Record<string, number> = {};
  let totalExceptionDurationSec = 0;
  for (const a of alerts) {
    typeStats[a.alertType] = (typeStats[a.alertType] || 0) + 1;
    if (a.alertType === 'over_temp_high' || a.alertType === 'over_temp_low') {
      totalExceptionDurationSec += typeof a.durationSeconds === 'number' ? a.durationSeconds : 0;
    }
  }

  const handlingRecords = alerts
    .filter(a => a.status === 'processing' || a.status === 'resolved' || a.status === 'ignored')
    .sort((a, b) => (a.handleTime || 0) - (b.handleTime || 0))
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

  const pendingList = alerts.filter(a => a.status === 'pending');
  const processingList = alerts.filter(a => a.status === 'processing');
  const resolvedList = alerts.filter(a => a.status === 'resolved');
  const ignoredList = alerts.filter(a => a.status === 'ignored');

  return {
    alerts,
    records,
    doorEvents,
    typeStats,
    handlingRecords,
    pendingList,
    processingList,
    resolvedList,
    ignoredList,
    totalExceptionDurationSec,
  };
}

router.get('/:waybillId', (req: Request, res: Response) => {
  const waybill = storage.getWaybillById(req.params.waybillId);
  if (!waybill) {
    return notFound(res, '运单不存在');
  }
  const r = calcDurationAndStats(req.params.waybillId);
  const stats = {
    totalAlerts: r.alerts.length,
    pending: r.pendingList.length,
    processing: r.processingList.length,
    resolved: r.resolvedList.length,
    ignored: r.ignoredList.length,
    highLevelCount: r.alerts.filter(a => a.alertLevel === 'high' || a.alertLevel === 'critical').length,
    totalExceptionDurationSec: r.totalExceptionDurationSec,
  };
  success(res, {
    waybillNo: waybill.waybillNo,
    vehicleId: waybill.vehicleId,
    customerName: waybill.customerName,
    goodsName: waybill.goodsName,
    origin: waybill.origin,
    destination: waybill.destination,
    signStatus: waybill.signStatus,
    signTime: waybill.signTime,
    signerName: waybill.signerName,
    signRemark: waybill.signRemark,
    stats,
    handlingRecords: r.handlingRecords,
  });
});

router.post('/:waybillId/sign', (req: Request, res: Response) => {
  const { signerName, signRemark, signStatus, receiptPhotos } = req.body;
  if (!signerName) {
    return badRequest(res, '签收人姓名不能为空');
  }
  const waybill = storage.getWaybillById(req.params.waybillId);
  if (!waybill) {
    return notFound(res, '运单不存在');
  }

  const r = calcDurationAndStats(req.params.waybillId);
  const status = signStatus || (
    (r.pendingList.length > 0 || r.processingList.length > 0) ? 'signed_exception' : 'signed_normal'
  );

  const updated = storage.updateWaybill(req.params.waybillId, {
    status: 'signed',
    signStatus: status as any,
    signTime: Date.now(),
    signerName,
    signRemark,
  });

  success(res, {
    waybill: updated,
    receiptPhotos: receiptPhotos || [],
    stats: {
      totalAlerts: r.alerts.length,
      pending: r.pendingList.length,
      processing: r.processingList.length,
      resolved: r.resolvedList.length,
      totalExceptionDurationSec: r.totalExceptionDurationSec,
    },
  }, '签收成功');
});

router.get('/:waybillId/stats', (req: Request, res: Response) => {
  const waybill = storage.getWaybillById(req.params.waybillId);
  if (!waybill) {
    return notFound(res, '运单不存在');
  }
  const r = calcDurationAndStats(req.params.waybillId);

  success(res, {
    waybillNo: waybill.waybillNo,
    totalRecords: r.records.length,
    totalAlerts: r.alerts.length,
    totalDoorEvents: r.doorEvents.length,
    totalExceptionDurationSec: r.totalExceptionDurationSec,
    alertsByType: r.typeStats,
    alertsByStatus: {
      pending: r.pendingList.length,
      processing: r.processingList.length,
      resolved: r.resolvedList.length,
      ignored: r.ignoredList.length,
    },
    highLevelCount: r.alerts.filter(a => a.alertLevel === 'high' || a.alertLevel === 'critical').length,
    handledCount: r.handlingRecords.length,
    signStatus: waybill.signStatus,
  });
});

router.post('/:waybillId/exception-sign', (req: Request, res: Response) => {
  const { signerName, signRemark, exceptionPhotos, exceptionDescription } = req.body;
  if (!signerName) {
    return badRequest(res, '签收人姓名不能为空');
  }
  const waybill = storage.getWaybillById(req.params.waybillId);
  if (!waybill) {
    return notFound(res, '运单不存在');
  }
  const r = calcDurationAndStats(req.params.waybillId);
  const updated = storage.updateWaybill(req.params.waybillId, {
    status: 'signed',
    signStatus: 'signed_exception',
    signTime: Date.now(),
    signerName,
    signRemark: signRemark || exceptionDescription || '异常签收',
  });
  success(res, {
    waybill: updated,
    exceptionPhotos: exceptionPhotos || [],
    exceptionDescription,
    stats: {
      totalAlerts: r.alerts.length,
      pending: r.pendingList.length,
      processing: r.processingList.length,
      totalExceptionDurationSec: r.totalExceptionDurationSec,
    },
  }, '异常签收成功');
});

export default router;
