import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Storage } from '../storage';
import { TemperatureRecord, DoorEvent } from '../types';
import { AlertService } from '../services/alertService';
import { success, notFound, badRequest } from '../utils/response';

const router = Router();
const storage = Storage.getInstance();
const alertService = new AlertService();

router.post('/report', (req: Request, res: Response) => {
  const {
    deviceId, vehicleId, waybillId, zoneId, temperature, humidity,
    timestamp, location, isDoorOpen, deviceStatus,
  } = req.body;

  let targetVehicleId: string | undefined = vehicleId;
  if (!targetVehicleId && deviceId) {
    const v = storage.getVehicleByDeviceId(deviceId);
    if (v) targetVehicleId = v.id;
  }
  if (targetVehicleId && !storage.getVehicleById(targetVehicleId)) {
    targetVehicleId = undefined;
  }
  if (!targetVehicleId) {
    return badRequest(res, '无法识别车辆，请提供 vehicleId 或 deviceId');
  }

  let targetWaybillId: string | undefined = waybillId;
  if (!targetWaybillId) {
    const w = storage.getActiveWaybillByVehicle(targetVehicleId);
    if (w) targetWaybillId = w.id;
  }
  if (targetWaybillId && !storage.getWaybillById(targetWaybillId)) {
    targetWaybillId = undefined;
  }
  if (!targetWaybillId) {
    return badRequest(res, '未找到关联运单，请提供 waybillId');
  }

  if (typeof temperature !== 'number') {
    return badRequest(res, '温度值不能为空');
  }

  const waybill = storage.getWaybillById(targetWaybillId);
  const targetZoneId = zoneId || (waybill?.temperatureZones[0]?.zoneId || 'default');

  const record: TemperatureRecord = {
    id: uuidv4(),
    waybillId: targetWaybillId,
    vehicleId: targetVehicleId,
    zoneId: targetZoneId,
    temperature,
    humidity,
    timestamp: timestamp || Date.now(),
    location,
    isDoorOpen,
    deviceStatus: deviceStatus || 'normal',
  };
  storage.addTemperatureRecord(record);

  const alert = alertService.checkTemperatureAndCreateAlert(record);
  const isFormalAlert = alert && (alert.status === 'pending' || alert.status === 'processing');

  if (location) {
    storage.addTrackPoint({
      id: uuidv4(),
      waybillId: targetWaybillId,
      vehicleId: targetVehicleId,
      latitude: location.latitude,
      longitude: location.longitude,
      address: location.address,
      timestamp: record.timestamp,
    });
  }

  success(res, {
    record,
    alertTriggered: !!isFormalAlert,
    alert: isFormalAlert ? alert : undefined,
  }, '温度上报成功');
});

router.post('/batch', (req: Request, res: Response) => {
  const { records } = req.body;
  if (!Array.isArray(records)) {
    return badRequest(res, 'records 必须是数组');
  }
  const successResults: any[] = [];
  const failedResults: any[] = [];

  for (let idx = 0; idx < records.length; idx++) {
    const item = records[idx];
    let targetVehicleId: string | undefined = item.vehicleId;
    if (!targetVehicleId && item.deviceId) {
      const v = storage.getVehicleByDeviceId(item.deviceId);
      if (v) targetVehicleId = v.id;
    }
    if (targetVehicleId && !storage.getVehicleById(targetVehicleId)) {
      targetVehicleId = undefined;
    }
    let targetWaybillId: string | undefined = item.waybillId;
    if (!targetWaybillId && targetVehicleId) {
      const w = storage.getActiveWaybillByVehicle(targetVehicleId);
      if (w) targetWaybillId = w.id;
    }
    if (targetWaybillId && !storage.getWaybillById(targetWaybillId)) {
      targetWaybillId = undefined;
    }

    const errors: string[] = [];
    if (!targetVehicleId) errors.push('无法识别车辆');
    if (!targetWaybillId) errors.push('未找到关联运单');
    if (typeof item.temperature !== 'number') errors.push('缺少有效 temperature 字段');

    if (errors.length > 0) {
      failedResults.push({
        index: idx,
        record: item,
        errors,
      });
      continue;
    }

    const waybill = storage.getWaybillById(targetWaybillId!);
    const targetZoneId = item.zoneId || (waybill?.temperatureZones[0]?.zoneId || 'default');

    const record: TemperatureRecord = {
      id: uuidv4(),
      waybillId: targetWaybillId!,
      vehicleId: targetVehicleId!,
      zoneId: targetZoneId,
      temperature: item.temperature,
      humidity: item.humidity,
      timestamp: item.timestamp || Date.now(),
      location: item.location,
      isDoorOpen: item.isDoorOpen,
      deviceStatus: item.deviceStatus || 'normal',
    };
    storage.addTemperatureRecord(record);
    const alert = alertService.checkTemperatureAndCreateAlert(record);
    const isFormalAlert = alert && (alert.status === 'pending' || alert.status === 'processing');
    successResults.push({ record, alertTriggered: !!isFormalAlert, alert: isFormalAlert ? alert : undefined });

    if (item.location) {
      storage.addTrackPoint({
        id: uuidv4(),
        waybillId: targetWaybillId!,
        vehicleId: targetVehicleId!,
        latitude: item.location.latitude,
        longitude: item.location.longitude,
        address: item.location.address,
        timestamp: record.timestamp,
      });
    }
  }
  success(res, {
    total: records.length,
    successCount: successResults.length,
    failedCount: failedResults.length,
    successResults,
    failedResults,
  }, failedResults.length === 0 ? '批量上报成功' : '批量上报完成，部分记录失败');
});

router.get('/waybill/:waybillId', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 500;
  const records = storage.getLatestTemperatureRecords(req.params.waybillId, limit);
  success(res, { records, total: records.length });
});

router.post('/door-event', (req: Request, res: Response) => {
  const {
    vehicleId, waybillId, zoneId, eventType, timestamp, location, operator, remark,
  } = req.body;
  if (!vehicleId || !eventType) {
    return badRequest(res, '车辆ID和事件类型不能为空');
  }
  let targetWaybillId = waybillId;
  if (!targetWaybillId) {
    const w = storage.getActiveWaybillByVehicle(vehicleId);
    if (w) targetWaybillId = w.id;
  }
  if (!targetWaybillId) {
    return badRequest(res, '未找到关联运单');
  }

  const waybill = storage.getWaybillById(targetWaybillId);
  const targetZoneId = zoneId || (waybill?.temperatureZones[0]?.zoneId || 'default');

  let durationSeconds: number | undefined;
  if (eventType === 'close') {
    const events = storage.getDoorEvents(targetWaybillId, vehicleId);
    const lastOpen = [...events].reverse().find(e => e.eventType === 'open');
    if (lastOpen) {
      durationSeconds = Math.floor(((timestamp || Date.now()) - lastOpen.timestamp) / 1000);
      if (durationSeconds > 0) {
        alertService.checkDoorOpenAlert(targetWaybillId, vehicleId, targetZoneId, lastOpen.timestamp, durationSeconds);
      }
    }
  }

  const event: DoorEvent = {
    id: uuidv4(),
    waybillId: targetWaybillId,
    vehicleId,
    zoneId: targetZoneId,
    eventType: eventType as 'open' | 'close',
    timestamp: timestamp || Date.now(),
    location,
    durationSeconds,
    operator,
    remark,
  };
  storage.addDoorEvent(event);
  success(res, event, '开门事件记录成功');
});

router.get('/door-events/:waybillId', (req: Request, res: Response) => {
  const events = storage.getDoorEvents(req.params.waybillId);
  success(res, { events, total: events.length });
});

export default router;
