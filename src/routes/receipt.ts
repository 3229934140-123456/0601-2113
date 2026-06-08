import { Router, Request, Response } from 'express';
import { Storage } from '../storage';
import { success, notFound, badRequest } from '../utils/response';

const router = Router();
const storage = Storage.getInstance();

router.get('/:waybillId', (req: Request, res: Response) => {
  const waybill = storage.getWaybillById(req.params.waybillId);
  if (!waybill) {
    return notFound(res, '运单不存在');
  }
  const alerts = storage.getAlerts(req.params.waybillId);
  const stats = {
    totalAlerts: alerts.length,
    highLevelCount: alerts.filter(a => a.alertLevel === 'high' || a.alertLevel === 'critical').length,
    resolvedCount: alerts.filter(a => a.status === 'resolved').length,
    pendingCount: alerts.filter(a => a.status === 'pending' || a.status === 'processing').length,
  };
  success(res, {
    waybillNo: waybill.waybillNo,
    signStatus: waybill.signStatus,
    signTime: waybill.signTime,
    signerName: waybill.signerName,
    signRemark: waybill.signRemark,
    stats,
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

  const status = signStatus || (
    waybill.signStatus === 'signed_exception' ? 'signed_exception' : 'signed_normal'
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
  }, '签收成功');
});

router.get('/:waybillId/stats', (req: Request, res: Response) => {
  const waybill = storage.getWaybillById(req.params.waybillId);
  if (!waybill) {
    return notFound(res, '运单不存在');
  }
  const alerts = storage.getAlerts(req.params.waybillId);
  const records = storage.getTemperatureRecords(req.params.waybillId);
  const doorEvents = storage.getDoorEvents(req.params.waybillId);

  const typeStats: Record<string, number> = {};
  for (const a of alerts) {
    typeStats[a.alertType] = (typeStats[a.alertType] || 0) + 1;
  }

  success(res, {
    waybillNo: waybill.waybillNo,
    totalRecords: records.length,
    totalAlerts: alerts.length,
    totalDoorEvents: doorEvents.length,
    alertsByType: typeStats,
    alertsByStatus: {
      pending: alerts.filter(a => a.status === 'pending').length,
      processing: alerts.filter(a => a.status === 'processing').length,
      resolved: alerts.filter(a => a.status === 'resolved').length,
      ignored: alerts.filter(a => a.status === 'ignored').length,
    },
    highLevelCount: alerts.filter(a => a.alertLevel === 'high' || a.alertLevel === 'critical').length,
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
  }, '异常签收成功');
});

export default router;
