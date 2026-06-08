import { v4 as uuidv4 } from 'uuid';
import { Storage } from '../storage';
import { Alert, AlertLevel, AlertType, TemperatureRecord, Waybill, TemperatureZone } from '../types';

const OVER_TEMP_SUGGESTIONS = [
  '立即检查制冷设备运行状态',
  '检查冷藏车厢门是否完全关闭',
  '检查温度传感器是否正常',
  '如设备异常请联系调度中心',
  '必要时停靠就近冷库中转',
];

const DOOR_OPEN_SUGGESTIONS = [
  '立即关闭车厢门',
  '检查是否未完全关闭',
  '确认锁闭后等待温度恢复',
];

function getAlertLevel(type: AlertType, deviation?: number): AlertLevel {
  if (type === 'device_offline' || type === 'power_abnormal') return 'high';
  if (type === 'door_open_timeout') return 'medium';
  if (deviation !== undefined) {
    if (Math.abs(deviation) >= 8) return 'critical';
    if (Math.abs(deviation) >= 5) return 'high';
    return 'medium';
  }
  return 'medium';
}

export class AlertService {
  private storage: Storage;

  constructor() {
    this.storage = Storage.getInstance();
  }

  private getZoneConfig(waybill: Waybill, zoneId: string): TemperatureZone | undefined {
    return waybill.temperatureZones.find(z => z.zoneId === zoneId) || waybill.temperatureZones[0];
  }

  checkTemperatureAndCreateAlert(record: TemperatureRecord): Alert | null {
    const waybill = this.storage.getWaybillById(record.waybillId);
    if (!waybill) return null;
    const zone = this.getZoneConfig(waybill, record.zoneId);
    if (!zone) return null;

    let alertType: AlertType | null = null;
    let description = '';
    let deviation = 0;

    if (record.temperature > zone.maxTemp) {
      alertType = 'over_temp_high';
      deviation = record.temperature - zone.maxTemp;
      description = `温度过高：当前${record.temperature}°C，上限${zone.maxTemp}°C，超出${deviation.toFixed(1)}°C`;
    } else if (record.temperature < zone.minTemp) {
      alertType = 'over_temp_low';
      deviation = record.temperature - zone.minTemp;
      description = `温度过低：当前${record.temperature}°C，下限${zone.minTemp}°C，低于${Math.abs(deviation).toFixed(1)}°C`;
    }

    if (!alertType) return null;

    const recentRecords = this.storage.getTemperatureRecords(record.waybillId, record.vehicleId, record.zoneId)
      .filter(r => r.timestamp >= record.timestamp - zone.durationThreshold * 1000);

    const abnormalCount = recentRecords.filter(r => {
      if (alertType === 'over_temp_high') return r.temperature > zone.maxTemp;
      if (alertType === 'over_temp_low') return r.temperature < zone.minTemp;
      return false;
    }).length;

    const activeAlerts = this.storage.getActiveAlerts(record.waybillId, record.zoneId)
      .filter(a => a.alertType === alertType);

    if (activeAlerts.length > 0) {
      const existing = activeAlerts[0];
      const duration = record.timestamp - existing.startTime;
      if (duration >= zone.durationThreshold * 1000 && abnormalCount >= Math.ceil(zone.durationThreshold / 60)) {
        const level = getAlertLevel(alertType, deviation);
        this.storage.updateAlert(existing.id, {
          alertLevel: level,
          description,
          temperature: record.temperature,
          durationSeconds: Math.floor(duration / 1000),
        });
        return existing;
      }
      return null;
    }

    const level = getAlertLevel(alertType, deviation);
    const alert: Alert = {
      id: uuidv4(),
      waybillId: record.waybillId,
      vehicleId: record.vehicleId,
      zoneId: record.zoneId,
      alertType: alertType as AlertType,
      alertLevel: level,
      description,
      temperature: record.temperature,
      thresholdMin: zone.minTemp,
      thresholdMax: zone.maxTemp,
      startTime: record.timestamp,
      status: 'pending',
      suggestions: [...OVER_TEMP_SUGGESTIONS],
      createdAt: Date.now(),
    };
    return this.storage.addAlert(alert);
  }

  checkDoorOpenAlert(waybillId: string, vehicleId: string, zoneId: string, timestamp: number): Alert | null {
    const waybill = this.storage.getWaybillById(waybillId);
    if (!waybill) return null;
    const zone = this.getZoneConfig(waybill, zoneId);
    if (!zone) return null;

    const alerts = this.storage.getActiveAlerts(waybillId, zoneId)
      .filter(a => a.alertType === 'door_open_timeout');

    if (alerts.length > 0) return null;

    const alert: Alert = {
      id: uuidv4(),
      waybillId,
      vehicleId,
      zoneId,
      alertType: 'door_open_timeout',
      alertLevel: 'medium',
      description: '车厢门打开时间过长',
      startTime: timestamp,
      status: 'pending',
      suggestions: [...DOOR_OPEN_SUGGESTIONS],
      createdAt: Date.now(),
    };
    return this.storage.addAlert(alert);
  }

  resolveAlert(alertId: string, updates: {
    handlerId?: string;
    handlerName?: string;
    handleMethod?: string;
    handleRemark?: string;
    handlePhotos?: string[];
    result?: string;
  }): Alert | null {
    const alert = this.storage.getAlertById(alertId);
    if (!alert) return null;
    const now = Date.now();
    const duration = Math.floor((now - alert.startTime) / 1000);
    const updated = this.storage.updateAlert(alertId, {
      status: 'resolved',
      endTime: now,
      durationSeconds: duration,
      handlerId: updates.handlerId,
      handlerName: updates.handlerName,
      handleTime: now,
      handleMethod: updates.handleMethod,
      handleRemark: updates.handleRemark,
      handlePhotos: updates.handlePhotos,
      result: updates.result || '异常已处理',
    });
    return updated || null;
  }
}
