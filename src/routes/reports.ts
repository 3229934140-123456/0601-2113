import { Router, Request, Response } from 'express';
import { Storage } from '../storage';
import { TemperatureReport, Alert, TemperatureRecord, TemperatureZone, DoorEvent } from '../types';
import { success, notFound } from '../utils/response';

const router = Router();
const storage = Storage.getInstance();

function isRecordNormal(r: TemperatureRecord, zone: TemperatureZone): boolean {
  return r.temperature >= zone.minTemp && r.temperature <= zone.maxTemp;
}

function calcZoneExceptionDurationFromAlerts(
  alerts: Alert[],
  zoneId: string,
): { totalDurationSec: number; totalAlerts: number } {
  let totalDurationSec = 0;
  let totalAlerts = 0;
  for (const a of alerts) {
    if (a.zoneId !== zoneId && a.zoneId !== 'default') continue;
    if (a.alertType !== 'over_temp_high' && a.alertType !== 'over_temp_low') continue;
    if (a.result?.includes('未达到持续阈值')) continue;
    totalAlerts++;
    if (typeof a.durationSeconds === 'number') {
      totalDurationSec += a.durationSeconds;
    } else if (a.startTime && a.endTime) {
      totalDurationSec += Math.floor((a.endTime - a.startTime) / 1000);
    }
  }
  return { totalDurationSec, totalAlerts };
}

function generateReport(waybillId: string): TemperatureReport | null {
  const waybill = storage.getWaybillById(waybillId);
  if (!waybill) return null;

  const allRecords = storage.getTemperatureRecords(waybillId);
  const allAlerts = storage.getAlerts(waybillId);
  const publicAlerts = allAlerts.filter(a => !a.result?.includes('未达到持续阈值'));
  const alertsForCustomer = allAlerts.filter(
    a => a.status !== 'observing' && !a.result?.includes('未达到持续阈值')
  );
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

    const { totalDurationSec: exceptionDuration, totalAlerts: exceptionCount } = calcZoneExceptionDurationFromAlerts(
      publicAlerts,
      zone.zoneId
    );

    let maxDeviation = 0;
    const seriesWithNormality = zoneRecords.map(r => {
      const isNormal = isRecordNormal(r, zone);
      if (!isNormal) {
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

    const sampleInterval = Math.max(1, Math.ceil(seriesWithNormality.length / 200));
    const sampledSeries = seriesWithNormality.filter((_, i) => i % sampleInterval === 0);

    let inComplianceRate = 100;
    if (seriesWithNormality.length > 0) {
      const normalCount = seriesWithNormality.filter(r => r.isNormal).length;
      inComplianceRate = parseFloat(((normalCount / seriesWithNormality.length) * 100).toFixed(2));
    }

    const abnormalTimeline = alertsForCustomer
      .filter(a => (a.zoneId === zone.zoneId || a.zoneId === 'default') &&
        (a.alertType === 'over_temp_high' || a.alertType === 'over_temp_low'))
      .sort((a, b) => a.startTime - b.startTime)
      .map(a => ({
        alertId: a.id,
        alertType: a.alertType,
        alertLevel: a.alertLevel,
        description: a.description,
        startTime: a.startTime,
        endTime: a.endTime,
        durationSeconds: a.durationSeconds,
        status: a.status,
        temperature: a.temperature,
        thresholdMin: a.thresholdMin,
        thresholdMax: a.thresholdMax,
        handlerName: a.handlerName,
        handleMethod: a.handleMethod,
        handleTime: a.handleTime,
        result: a.result,
      }));

    return {
      zoneName: zone.zoneName,
      thresholdMin: zone.minTemp,
      thresholdMax: zone.maxTemp,
      minTemp: parseFloat(minTemp.toFixed(2)),
      maxTemp: parseFloat(maxTemp.toFixed(2)),
      avgTemp: parseFloat(avgTemp.toFixed(2)),
      exceptionCount,
      exceptionDuration,
      maxDeviation: parseFloat(maxDeviation.toFixed(2)),
      inComplianceRate,
      abnormalTimeline,
      temperatureSeries: sampledSeries,
    };
  });

  const reportAlerts = alertsForCustomer
    .sort((a, b) => a.startTime - b.startTime)
    .map(a => ({
      id: a.id,
      alertType: a.alertType,
      alertLevel: a.alertLevel,
      description: a.description,
      zoneId: a.zoneId,
      zoneName: waybill.temperatureZones.find(z => z.zoneId === a.zoneId)?.zoneName,
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

  const handlingRecords = alertsForCustomer
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

  const reportDoorEvents = doorEvents
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(e => ({
      id: e.id,
      eventType: e.eventType,
      timestamp: e.timestamp,
      durationSeconds: e.durationSeconds,
      location: e.location?.address,
      operator: e.operator,
      remark: e.remark,
    }));

  const doorTimeline: Array<{
    type: 'door_open' | 'door_close';
    timestamp: number;
    durationSeconds?: number;
    location?: string;
  }> = [];
  for (const e of reportDoorEvents) {
    doorTimeline.push({
      type: e.eventType === 'open' ? 'door_open' : 'door_close',
      timestamp: e.timestamp,
      durationSeconds: e.durationSeconds,
      location: e.location,
    });
  }

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
    doorTimeline,
    handlingRecords,
    exceptionSummary: {
      totalAlerts: alertsForCustomer.length,
      highLevelCount: alertsForCustomer.filter(a => a.alertLevel === 'high' || a.alertLevel === 'critical').length,
      resolvedCount: alertsForCustomer.filter(a => a.status === 'resolved').length,
      pendingCount: alertsForCustomer.filter(a => a.status === 'pending' || a.status === 'processing').length,
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

router.get('/:waybillId/download', (req: Request, res: Response) => {
  const report = generateReport(req.params.waybillId);
  if (!report) {
    return notFound(res, '运单不存在');
  }
  const filename = `cold-chain-report-${report.waybillNo}-${Date.now()}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.json(report);
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
      thresholdMin: z.thresholdMin,
      thresholdMax: z.thresholdMax,
      minTemp: z.minTemp,
      maxTemp: z.maxTemp,
      avgTemp: z.avgTemp,
      inComplianceRate: z.inComplianceRate,
      exceptionCount: z.exceptionCount,
      exceptionDuration: z.exceptionDuration,
    })),
    exceptionSummary: report.exceptionSummary,
    handlingCount: report.handlingRecords.length,
    doorEventCount: report.doorEvents.length,
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

router.get('/customer/:waybillNo/download', (req: Request, res: Response) => {
  const waybill = storage.getWaybillByNo(req.params.waybillNo);
  if (!waybill) {
    return notFound(res, '运单不存在');
  }
  const report = generateReport(waybill.id);
  if (!report) {
    return notFound(res, '生成报告失败');
  }
  const filename = `cold-chain-report-${report.waybillNo}-${Date.now()}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.json(report);
});

export default router;
