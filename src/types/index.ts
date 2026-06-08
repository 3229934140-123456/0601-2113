export interface Vehicle {
  id: string;
  plateNumber: string;
  deviceId: string;
  driverId?: string;
  driverName?: string;
  driverPhone?: string;
  status: 'active' | 'inactive' | 'maintenance';
  createdAt: number;
  updatedAt: number;
}

export interface TemperatureZone {
  zoneId: string;
  zoneName: string;
  minTemp: number;
  maxTemp: number;
  durationThreshold: number;
}

export interface Waybill {
  id: string;
  waybillNo: string;
  vehicleId: string;
  customerId: string;
  customerName: string;
  goodsName: string;
  origin: string;
  destination: string;
  planDepartureTime?: number;
  planArrivalTime?: number;
  actualDepartureTime?: number;
  actualArrivalTime?: number;
  temperatureZones: TemperatureZone[];
  status: 'pending' | 'in_transit' | 'delivered' | 'signed' | 'exception';
  signStatus?: 'unsigned' | 'signed_normal' | 'signed_exception';
  signTime?: number;
  signerName?: string;
  signRemark?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TemperatureRecord {
  id: string;
  waybillId: string;
  vehicleId: string;
  zoneId: string;
  temperature: number;
  humidity?: number;
  timestamp: number;
  location?: {
    latitude: number;
    longitude: number;
    address?: string;
  };
  isDoorOpen?: boolean;
  deviceStatus?: 'normal' | 'abnormal' | 'offline';
}

export interface DoorEvent {
  id: string;
  waybillId: string;
  vehicleId: string;
  zoneId: string;
  eventType: 'open' | 'close';
  timestamp: number;
  location?: {
    latitude: number;
    longitude: number;
    address?: string;
  };
  durationSeconds?: number;
  operator?: string;
  remark?: string;
}

export type AlertType = 'over_temp_high' | 'over_temp_low' | 'door_open_timeout' | 'device_offline' | 'power_abnormal';
export type AlertStatus = 'observing' | 'pending' | 'processing' | 'resolved' | 'ignored';
export type AlertLevel = 'low' | 'medium' | 'high' | 'critical';

export interface Alert {
  id: string;
  waybillId: string;
  vehicleId: string;
  zoneId: string;
  alertType: AlertType;
  alertLevel: AlertLevel;
  description: string;
  temperature?: number;
  thresholdMin?: number;
  thresholdMax?: number;
  startTime: number;
  endTime?: number;
  durationSeconds?: number;
  status: AlertStatus;
  suggestions: string[];
  handlerId?: string;
  handlerName?: string;
  handleTime?: number;
  handleMethod?: string;
  handleRemark?: string;
  handlePhotos?: string[];
  result?: string;
  createdAt: number;
}

export interface TrackPoint {
  id: string;
  waybillId: string;
  vehicleId: string;
  latitude: number;
  longitude: number;
  address?: string;
  speed?: number;
  heading?: number;
  timestamp: number;
}

export interface TrackSummary {
  waybillId: string;
  totalDistance?: number;
  totalDuration: number;
  startPoint?: {
    latitude: number;
    longitude: number;
    address?: string;
    timestamp: number;
  };
  endPoint?: {
    latitude: number;
    longitude: number;
    address?: string;
    timestamp: number;
  };
  pointCount: number;
  stopCount: number;
}

export interface TemperatureReport {
  waybillId: string;
  waybillNo: string;
  customerName: string;
  goodsName: string;
  origin: string;
  destination: string;
  departureTime?: number;
  arrivalTime?: number;
  totalDuration: number;
  zones: Array<{
    zoneName: string;
    thresholdMin: number;
    thresholdMax: number;
    minTemp: number;
    maxTemp: number;
    avgTemp: number;
    exceptionCount: number;
    exceptionDuration: number;
    maxDeviation: number;
    inComplianceRate: number;
    abnormalTimeline: Array<{
      alertId: string;
      alertType: AlertType;
      alertLevel: AlertLevel;
      description: string;
      startTime: number;
      endTime?: number;
      durationSeconds?: number;
      status: AlertStatus;
      temperature?: number;
      thresholdMin?: number;
      thresholdMax?: number;
      handlerName?: string;
      handleMethod?: string;
      handleTime?: number;
      result?: string;
    }>;
    temperatureSeries: Array<{
      timestamp: number;
      temperature: number;
      isNormal: boolean;
    }>;
  }>;
  alerts: Array<{
    id: string;
    alertType: AlertType;
    alertLevel: AlertLevel;
    description: string;
    zoneId?: string;
    zoneName?: string;
    startTime: number;
    endTime?: number;
    durationSeconds?: number;
    status: AlertStatus;
    handlerId?: string;
    handlerName?: string;
    handleTime?: number;
    handleMethod?: string;
    handleRemark?: string;
    handlePhotos?: string[];
    result?: string;
  }>;
  doorEvents: Array<{
    id: string;
    eventType: 'open' | 'close';
    timestamp: number;
    durationSeconds?: number;
    location?: string;
    operator?: string;
    remark?: string;
  }>;
  doorTimeline: Array<{
    type: 'door_open' | 'door_close';
    timestamp: number;
    durationSeconds?: number;
    location?: string;
  }>;
  handlingRecords: Array<{
    alertId: string;
    alertType: AlertType;
    alertLevel: AlertLevel;
    description: string;
    startTime: number;
    endTime?: number;
    durationSeconds?: number;
    status: AlertStatus;
    handlerId?: string;
    handlerName?: string;
    handleTime?: number;
    handleMethod?: string;
    handleRemark?: string;
    handlePhotos?: string[];
    result?: string;
  }>;
  exceptionSummary: {
    totalAlerts: number;
    highLevelCount: number;
    resolvedCount: number;
    pendingCount: number;
  };
  signStatus?: 'unsigned' | 'signed_normal' | 'signed_exception';
  generatedAt: number;
}

export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data?: T;
  timestamp: number;
}
