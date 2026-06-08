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

interface AbnormalInfo {
  isAbnormal: boolean;
  alertType: AlertType | null;
  deviation: number;
  description: string;
}

export class AlertService {
  private storage: Storage;

  constructor() {
    this.storage = Storage.getInstance();
  }

  private getZoneConfig(waybill: Waybill, zoneId: string): TemperatureZone | undefined {
    return waybill.temperatureZones.find(z => z.zoneId === zoneId) || waybill.temperatureZones[0];
  }

  private evaluateTemperature(temp: number, zone: TemperatureZone): AbnormalInfo {
    if (temp > zone.maxTemp) {
      const deviation = temp - zone.maxTemp;
      return {
        isAbnormal: true,
        alertType: 'over_temp_high',
        deviation,
        description: `温度过高：当前${temp}°C，上限${zone.maxTemp}°C，超出${deviation.toFixed(1)}°C`,
      };
    }
    if (temp < zone.minTemp) {
      const deviation = temp - zone.minTemp;
      return {
        isAbnormal: true,
        alertType: 'over_temp_low',
        deviation,
        description: `温度过低：当前${temp}°C，下限${zone.minTemp}°C，低于${Math.abs(deviation).toFixed(1)}°C`,
      };
    }
    return { isAbnormal: false, alertType: null, deviation: 0, description: '' };
  }

  private findOngoingAlert(waybillId: string, zoneId: string, alertType: AlertType): Alert | undefined {
    return this.storage
      .getAlerts(waybillId)
      .find(
        a =>
          a.zoneId === zoneId &&
          a.alertType === alertType &&
          !a.endTime &&
          (a.status === 'observing' || a.status === 'pending' || a.status === 'processing')
      );
  }

  checkTemperatureAndCreateAlert(record: TemperatureRecord): Alert | null {
    const waybill = this.storage.getWaybillById(record.waybillId);
    if (!waybill) return null;
    const zone = this.getZoneConfig(waybill, record.zoneId);
    if (!zone) return null;

    const info = this.evaluateTemperature(record.temperature, zone);

    if (!info.isAbnormal) {
      const observingAlert = this.storage
        .getAlerts(record.waybillId)
        .find(
          a =>
            a.zoneId === record.zoneId &&
            (a.alertType === 'over_temp_high' || a.alertType === 'over_temp_low') &&
            a.status === 'observing' &&
            !a.endTime
        );
      if (observingAlert) {
        const duration = Math.floor((record.timestamp - observingAlert.startTime) / 1000);
        this.storage.updateAlert(observingAlert.id, {
          status: 'resolved',
          endTime: record.timestamp,
          durationSeconds: duration,
          result: '温度自动恢复正常，未达到持续阈值',
        });
      }

      const activeAlert = this.storage
        .getAlerts(record.waybillId)
        .find(
          a =>
            a.zoneId === record.zoneId &&
            (a.alertType === 'over_temp_high' || a.alertType === 'over_temp_low') &&
            (a.status === 'pending' || a.status === 'processing') &&
            !a.endTime
        );
      if (activeAlert) {
        const duration = Math.floor((record.timestamp - activeAlert.startTime) / 1000);
        this.storage.updateAlert(activeAlert.id, {
          endTime: record.timestamp,
          durationSeconds: duration,
        });
      }
      return null;
    }

    const existingAlert = this.findOngoingAlert(
      record.waybillId,
      record.zoneId,
      info.alertType as AlertType
    );

    if (existingAlert) {
      const duration = record.timestamp - existingAlert.startTime;
      const durationSec = Math.floor(duration / 1000);

      if (existingAlert.status === 'observing') {
        if (durationSec >= zone.durationThreshold) {
          const level = getAlertLevel(info.alertType as AlertType, info.deviation);
          const promoted = this.storage.updateAlert(existingAlert.id, {
            status: 'pending',
            alertLevel: level,
            description: info.description,
            temperature: record.temperature,
            thresholdMin: zone.minTemp,
            thresholdMax: zone.maxTemp,
            durationSeconds: durationSec,
            suggestions: [...OVER_TEMP_SUGGESTIONS],
          });
          return promoted || null;
        } else {
          this.storage.updateAlert(existingAlert.id, {
            description: info.description,
            temperature: record.temperature,
            thresholdMin: zone.minTemp,
            thresholdMax: zone.maxTemp,
            durationSeconds: durationSec,
          });
          return null;
        }
      }

      this.storage.updateAlert(existingAlert.id, {
        description: info.description,
        temperature: record.temperature,
        durationSeconds: durationSec,
      });
      if (existingAlert.status === 'pending' || existingAlert.status === 'processing') {
        return { ...existingAlert, durationSeconds: durationSec };
      }
      return null;
    }

    const level = getAlertLevel(info.alertType as AlertType, info.deviation);
    const alert: Alert = {
      id: uuidv4(),
      waybillId: record.waybillId,
      vehicleId: record.vehicleId,
      zoneId: record.zoneId,
      alertType: info.alertType as AlertType,
      alertLevel: level,
      description: info.description,
      temperature: record.temperature,
      thresholdMin: zone.minTemp,
      thresholdMax: zone.maxTemp,
      startTime: record.timestamp,
      status: 'observing',
      suggestions: [...OVER_TEMP_SUGGESTIONS],
      durationSeconds: 0,
      createdAt: Date.now(),
    };
    return this.storage.addAlert(alert);
  }

  checkDoorOpenAlert(waybillId: string, vehicleId: string, zoneId: string, timestamp: number, durationSeconds: number): Alert | null {
    const waybill = this.storage.getWaybillById(waybillId);
    if (!waybill) return null;
    const zone = this.getZoneConfig(waybill, zoneId);
    if (!zone) return null;

    if (durationSeconds < zone.durationThreshold) return null;

    const alerts = this.storage
      .getAlerts(waybillId)
      .filter(a => a.zoneId === zoneId && a.alertType === 'door_open_timeout' && !a.endTime);

    if (alerts.length > 0) return null;

    const alert: Alert = {
      id: uuidv4(),
      waybillId,
      vehicleId,
      zoneId,
      alertType: 'door_open_timeout',
      alertLevel: 'medium',
      description: `车厢门打开${durationSeconds}秒，超过阈值${zone.durationThreshold}秒`,
      startTime: timestamp,
      endTime: timestamp + durationSeconds * 1000,
      durationSeconds,
      status: 'pending',
      suggestions: [...DOOR_OPEN_SUGGESTIONS],
      createdAt: Date.now(),
    };
    return this.storage.addAlert(alert);
  }

  acknowledgeAlert(alertId: string, updates: {
    handlerId?: string;
    handlerName?: string;
  }): Alert | null {
    const alert = this.storage.getAlertById(alertId);
    if (!alert) return null;
    if (alert.status === 'resolved' || alert.status === 'ignored') return null;
    const updated = this.storage.updateAlert(alertId, {
      status: 'processing',
      handlerId: updates.handlerId,
      handlerName: updates.handlerName,
      handleTime: Date.now(),
    });
    return updated || null;
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
    const endTime = alert.endTime || now;
    const durationSeconds = Math.max(0, Math.floor((endTime - alert.startTime) / 1000));
    const updated = this.storage.updateAlert(alertId, {
      status: 'resolved',
      endTime,
      durationSeconds,
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
