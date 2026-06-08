import * as fs from 'fs';
import * as path from 'path';
import {
  Vehicle,
  Waybill,
  TemperatureRecord,
  DoorEvent,
  Alert,
  TrackPoint,
} from '../types';

interface DataStore {
  vehicles: Vehicle[];
  waybills: Waybill[];
  temperatureRecords: TemperatureRecord[];
  doorEvents: DoorEvent[];
  alerts: Alert[];
  trackPoints: TrackPoint[];
}

const DATA_DIR = path.resolve(__dirname, '../../data');
const DATA_FILE = path.join(DATA_DIR, 'storage.json');

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadData(): DataStore {
  ensureDataDir();
  if (fs.existsSync(DATA_FILE)) {
    try {
      const content = fs.readFileSync(DATA_FILE, 'utf-8');
      return JSON.parse(content);
    } catch {
      return createEmptyStore();
    }
  }
  return createEmptyStore();
}

function createEmptyStore(): DataStore {
  return {
    vehicles: [],
    waybills: [],
    temperatureRecords: [],
    doorEvents: [],
    alerts: [],
    trackPoints: [],
  };
}

export class Storage {
  private static instance: Storage;
  private data: DataStore;

  private constructor() {
    this.data = loadData();
  }

  static getInstance(): Storage {
    if (!Storage.instance) {
      Storage.instance = new Storage();
    }
    return Storage.instance;
  }

  private persist(): void {
    ensureDataDir();
    fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  reset(): void {
    this.data = createEmptyStore();
    this.persist();
  }

  getVehicles(): Vehicle[] {
    return [...this.data.vehicles];
  }

  getVehicleById(id: string): Vehicle | undefined {
    return this.data.vehicles.find(v => v.id === id);
  }

  getVehicleByPlate(plateNumber: string): Vehicle | undefined {
    return this.data.vehicles.find(v => v.plateNumber === plateNumber);
  }

  getVehicleByDeviceId(deviceId: string): Vehicle | undefined {
    return this.data.vehicles.find(v => v.deviceId === deviceId);
  }

  addVehicle(vehicle: Vehicle): Vehicle {
    this.data.vehicles.push(vehicle);
    this.persist();
    return vehicle;
  }

  updateVehicle(id: string, updates: Partial<Vehicle>): Vehicle | undefined {
    const idx = this.data.vehicles.findIndex(v => v.id === id);
    if (idx === -1) return undefined;
    this.data.vehicles[idx] = { ...this.data.vehicles[idx], ...updates, updatedAt: Date.now() };
    this.persist();
    return this.data.vehicles[idx];
  }

  deleteVehicle(id: string): boolean {
    const len = this.data.vehicles.length;
    this.data.vehicles = this.data.vehicles.filter(v => v.id !== id);
    if (this.data.vehicles.length !== len) {
      this.persist();
      return true;
    }
    return false;
  }

  getWaybills(): Waybill[] {
    return [...this.data.waybills];
  }

  getWaybillById(id: string): Waybill | undefined {
    return this.data.waybills.find(w => w.id === id);
  }

  getWaybillByNo(waybillNo: string): Waybill | undefined {
    return this.data.waybills.find(w => w.waybillNo === waybillNo);
  }

  getWaybillsByVehicle(vehicleId: string): Waybill[] {
    return this.data.waybills.filter(w => w.vehicleId === vehicleId);
  }

  getActiveWaybillByVehicle(vehicleId: string): Waybill | undefined {
    return this.data.waybills.find(
      w => w.vehicleId === vehicleId && (w.status === 'in_transit' || w.status === 'pending')
    );
  }

  addWaybill(waybill: Waybill): Waybill {
    this.data.waybills.push(waybill);
    this.persist();
    return waybill;
  }

  updateWaybill(id: string, updates: Partial<Waybill>): Waybill | undefined {
    const idx = this.data.waybills.findIndex(w => w.id === id);
    if (idx === -1) return undefined;
    this.data.waybills[idx] = { ...this.data.waybills[idx], ...updates, updatedAt: Date.now() };
    this.persist();
    return this.data.waybills[idx];
  }

  addTemperatureRecord(record: TemperatureRecord): TemperatureRecord {
    this.data.temperatureRecords.push(record);
    this.persist();
    return record;
  }

  getTemperatureRecords(waybillId?: string, vehicleId?: string, zoneId?: string): TemperatureRecord[] {
    return this.data.temperatureRecords.filter(r =>
      (!waybillId || r.waybillId === waybillId) &&
      (!vehicleId || r.vehicleId === vehicleId) &&
      (!zoneId || r.zoneId === zoneId)
    ).sort((a, b) => a.timestamp - b.timestamp);
  }

  getLatestTemperatureRecords(waybillId: string, limit: number = 100): TemperatureRecord[] {
    return this.data.temperatureRecords
      .filter(r => r.waybillId === waybillId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
      .reverse();
  }

  addDoorEvent(event: DoorEvent): DoorEvent {
    this.data.doorEvents.push(event);
    this.persist();
    return event;
  }

  getDoorEvents(waybillId?: string, vehicleId?: string): DoorEvent[] {
    return this.data.doorEvents
      .filter(e =>
        (!waybillId || e.waybillId === waybillId) &&
        (!vehicleId || e.vehicleId === vehicleId)
      )
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  addAlert(alert: Alert): Alert {
    this.data.alerts.push(alert);
    this.persist();
    return alert;
  }

  getAlerts(waybillId?: string, vehicleId?: string, status?: string): Alert[] {
    return this.data.alerts
      .filter(a =>
        (!waybillId || a.waybillId === waybillId) &&
        (!vehicleId || a.vehicleId === vehicleId) &&
        (!status || a.status === status)
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getAlertById(id: string): Alert | undefined {
    return this.data.alerts.find(a => a.id === id);
  }

  getActiveAlerts(waybillId: string, zoneId?: string): Alert[] {
    return this.data.alerts.filter(a =>
      a.waybillId === waybillId &&
      (!zoneId || a.zoneId === zoneId) &&
      a.status === 'pending'
    );
  }

  updateAlert(id: string, updates: Partial<Alert>): Alert | undefined {
    const idx = this.data.alerts.findIndex(a => a.id === id);
    if (idx === -1) return undefined;
    this.data.alerts[idx] = { ...this.data.alerts[idx], ...updates };
    this.persist();
    return this.data.alerts[idx];
  }

  addTrackPoint(point: TrackPoint): TrackPoint {
    this.data.trackPoints.push(point);
    this.persist();
    return point;
  }

  getTrackPoints(waybillId: string, limit?: number): TrackPoint[] {
    let points = this.data.trackPoints
      .filter(p => p.waybillId === waybillId)
      .sort((a, b) => a.timestamp - b.timestamp);
    if (limit && points.length > limit) {
      points = points.slice(points.length - limit);
    }
    return points;
  }

  getLatestTrackPoint(vehicleId: string, waybillId?: string): TrackPoint | undefined {
    const points = this.data.trackPoints
      .filter(p => p.vehicleId === vehicleId && (!waybillId || p.waybillId === waybillId))
      .sort((a, b) => b.timestamp - a.timestamp);
    return points[0];
  }
}
