import { Router, Request, Response } from 'express';
import { Storage } from '../storage';
import { TemperatureReport } from '../types';
import { success, notFound } from '../utils/response';

const router = Router();
const storage = Storage.getInstance();

function generateReport(waybillId: string): TemperatureReport | null {
  const waybill = storage.getWaybillById(waybillId);
  if (!waybill) return null;

  const allRecords = storage.getTemperatureRecords(waybillId);
  const alerts = storage.getAlerts(waybillId);
  const doorEvents = storage.getDoorEvents(waybillId);

  const departureTime = waybill.actualDepartureTime || waybill.planDepartureTime || (allRecords[0]?.timestamp);
  const arrivalTime = waybill.actualArrivalTime || waybill.planArrivalTime || (allRecords.length > 0 ? allRecords[allRecords.length - 1].timestamp : undefined);
  const totalDuration = departureTime && arrivalTime
    ? Math.floor((arrivalTime - departureTime) / 1000)
    : 0;

  const zonesData = waybill.temperatureZones.map(zone => {
    const zoneRecords = allRecords.filter(r => r.zoneId === zone.zoneId || r.zoneId === 'default');
    const temps = zoneRecords.map(r => r.temperature);

    const minTemp = temps.length > 0 ? Math.min(...temps) : 0;
    const maxTemp = temps.length > 0 ? Math.max(...temps) : 0;
    const avgTemp = temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : 0;

    let exceptionCount = 0;
    let exceptionDuration = 0;
    let maxDeviation = 0;
    const abnormalRecords = zoneRecords.map(r => {
      const isNormal = r.temperature >= zone.minTemp && r.temperature <= zone.maxTemp;
      if (!isNormal) {
        exceptionCount++;
        const deviation = r.temperature > zone.maxTemp
          ? r.temperature - zone.maxTemp
          : zone.minTemp - r.temperature;
        if (deviation > maxDeviation) maxDeviation = deviation;
      }
      return {
        timestamp: r.timestamp,
        temperature: r.temperature,
        isNormal,
      };
    });

    const sampleInterval = Math.max(1, Math.ceil(abnormalRecords.length / 200));
    const sampledSeries = abnormalRecords.filter((_, i) => i % sampleInterval === 0);

    let inComplianceRate = 100;
    if (abnormalRecords.length > 0) {
      const normalCount = abnormalRecords.filter(r => r.isNormal).length;
      inComplianceRate = parseFloat(((normalCount / abnormalRecords.length) * 100).toFixed(2));
    }

    return {
      zoneName: zone.zoneName,
      minTemp: parseFloat(minTemp.toFixed(2)),
      maxTemp: parseFloat(maxTemp.toFixed(2)),
      avgTemp: parseFloat(avgTemp.toFixed(2)),
      thresholdMin: zone.minTemp,
      thresholdMax: zone.maxTemp,
      exceptionCount,
      exceptionDuration,
      maxDeviation: parseFloat(maxDeviation.toFixed(2)),
      inComplianceRate,
      temperatureSeries: sampledSeries,
    };
  });

  const reportAlerts = alerts.map(a => ({
    id: a.id,
    alertType: a.alertType,
    alertLevel: a.alertLevel,
    description: a.description,
    startTime: a.startTime,
    endTime: a.endTime,
    durationSeconds: a.durationSeconds,
    status: a.status,
    handleMethod: a.handleMethod,
    result: a.result,
  }));

  const reportDoorEvents = doorEvents.map(e => ({
    id: e.id,
    eventType: e.eventType,
    timestamp: e.timestamp,
    durationSeconds: e.durationSeconds,
    location: e.location?.address,
  }));

  return {
    waybillId: waybill.id,
    waybillNo: waybill.waybillNo,
    customerName: waybill.customerName,
    goodsName: waybill.goodsName,
    origin: waybill.origin,
    destination: waybill.destination,
    departureTime,
    arrivalTime,
    totalDuration,
    zones: zonesData,
    alerts: reportAlerts,
    doorEvents: reportDoorEvents,
    exceptionSummary: {
      totalAlerts: alerts.length,
      highLevelCount: alerts.filter(a => a.alertLevel === 'high' || a.alertLevel === 'critical').length,
      resolvedCount: alerts.filter(a => a.status === 'resolved').length,
      pendingCount: alerts.filter(a => a.status === 'pending' || a.status === 'processing').length,
    },
    signStatus: waybill.signStatus,
    generatedAt: Date.now(),
  };
}

router.get('/:waybillId', (req: Request, res: Response) => {
  const report = generateReport(req.params.waybillId);
  if (!report) {
    return notFound(res, '运单不存在');
  }
  success(res, report);
});

router.get('/:waybillId/summary', (req: Request, res: Response) => {
  const report = generateReport(req.params.waybillId);
  if (!report) {
    return notFound(res, '运单不存在');
  }
  success(res, {
    waybillNo: report.waybillNo,
    customerName: report.customerName,
    goodsName: report.goodsName,
    origin: report.origin,
    destination: report.destination,
    departureTime: report.departureTime,
    arrivalTime: report.arrivalTime,
    zones: report.zones.map(z => ({
      zoneName: z.zoneName,
      avgTemp: z.avgTemp,
      thresholdMin: z.thresholdMin,
      thresholdMax: z.thresholdMax,
      inComplianceRate: z.inComplianceRate,
      exceptionCount: z.exceptionCount,
    })),
    exceptionSummary: report.exceptionSummary,
    signStatus: report.signStatus,
    generatedAt: report.generatedAt,
  });
});

router.get('/customer/:waybillNo', (req: Request, res: Response) => {
  const waybill = storage.getWaybillByNo(req.params.waybillNo);
  if (!waybill) {
    return notFound(res, '运单不存在');
  }
  const report = generateReport(waybill.id);
  if (!report) {
    return notFound(res, '生成报告失败');
  }
  success(res, report);
});

export default router;
