import { v4 as uuidv4 } from 'uuid';
import { Storage } from './storage';
import { Vehicle, Waybill, TemperatureRecord, TrackPoint } from './types';

export function seedDemoData(): void {
  const storage = Storage.getInstance();
  const vehicles = storage.getVehicles();
  if (vehicles.length > 0) return;

  const now = Date.now();

  const vehicle1: Vehicle = {
    id: uuidv4(),
    plateNumber: '沪A·88888',
    deviceId: 'DEV-001',
    driverName: '张师傅',
    driverPhone: '13800138001',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  const vehicle2: Vehicle = {
    id: uuidv4(),
    plateNumber: '沪B·66666',
    deviceId: 'DEV-002',
    driverName: '李师傅',
    driverPhone: '13800138002',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  storage.addVehicle(vehicle1);
  storage.addVehicle(vehicle2);

  const waybill1: Waybill = {
    id: uuidv4(),
    waybillNo: 'YB2024010001',
    vehicleId: vehicle1.id,
    customerId: 'CUST-001',
    customerName: '某生鲜连锁超市',
    goodsName: '冷冻猪肉',
    origin: '上海市浦东新区冷链物流中心',
    destination: '上海市徐汇区某超市门店',
    planDepartureTime: now - 3600 * 1000 * 2,
    planArrivalTime: now + 3600 * 1000,
    actualDepartureTime: now - 3600 * 1000 * 2,
    temperatureZones: [
      {
        zoneId: uuidv4(),
        zoneName: '冷冻区',
        minTemp: -20,
        maxTemp: -12,
        durationThreshold: 300,
      },
    ],
    status: 'in_transit',
    signStatus: 'unsigned',
    createdAt: now,
    updatedAt: now,
  };

  const waybill2: Waybill = {
    id: uuidv4(),
    waybillNo: 'YB2024010002',
    vehicleId: vehicle2.id,
    customerId: 'CUST-002',
    customerName: '某医药公司',
    goodsName: '生物制剂',
    origin: '上海市青浦区医药仓储中心',
    destination: '上海市静安区某医院',
    planDepartureTime: now - 3600 * 1000 * 5,
    planArrivalTime: now - 3600 * 1000,
    actualDepartureTime: now - 3600 * 1000 * 5,
    actualArrivalTime: now - 3600 * 1000,
    temperatureZones: [
      {
        zoneId: uuidv4(),
        zoneName: '冷藏区',
        minTemp: 2,
        maxTemp: 8,
        durationThreshold: 300,
      },
    ],
    status: 'delivered',
    signStatus: 'unsigned',
    createdAt: now,
    updatedAt: now,
  };

  storage.addWaybill(waybill1);
  storage.addWaybill(waybill2);

  const zone1 = waybill1.temperatureZones[0].zoneId;
  for (let i = 0; i < 60; i++) {
    const t = now - 3600 * 1000 * 2 + i * 60 * 1000;
    let temp = -16 + (Math.random() - 0.5) * 2;
    if (i >= 40 && i <= 50) temp = -8 + (Math.random() - 0.5);
    storage.addTemperatureRecord({
      id: uuidv4(),
      waybillId: waybill1.id,
      vehicleId: vehicle1.id,
      zoneId: zone1,
      temperature: parseFloat(temp.toFixed(1)),
      humidity: 85 + Math.random() * 5,
      timestamp: t,
      location: {
        latitude: 31.2304 + (i * 0.001),
        longitude: 121.4737 + (i * 0.0008),
      },
      isDoorOpen: i === 45,
      deviceStatus: 'normal',
    });
    storage.addTrackPoint({
      id: uuidv4(),
      waybillId: waybill1.id,
      vehicleId: vehicle1.id,
      latitude: 31.2304 + (i * 0.001),
      longitude: 121.4737 + (i * 0.0008),
      speed: i % 10 === 0 ? 0 : 40 + Math.random() * 20,
      timestamp: t,
    });
  }

  const zone2 = waybill2.temperatureZones[0].zoneId;
  for (let i = 0; i < 120; i++) {
    const t = now - 3600 * 1000 * 5 + i * 60 * 1000;
    const temp = 5 + (Math.random() - 0.5) * 2;
    storage.addTemperatureRecord({
      id: uuidv4(),
      waybillId: waybill2.id,
      vehicleId: vehicle2.id,
      zoneId: zone2,
      temperature: parseFloat(temp.toFixed(1)),
      humidity: 60 + Math.random() * 10,
      timestamp: t,
      location: {
        latitude: 31.1804 + (i * 0.0005),
        longitude: 121.3037 + (i * 0.0006),
      },
      deviceStatus: 'normal',
    });
    storage.addTrackPoint({
      id: uuidv4(),
      waybillId: waybill2.id,
      vehicleId: vehicle2.id,
      latitude: 31.1804 + (i * 0.0005),
      longitude: 121.3037 + (i * 0.0006),
      speed: 35 + Math.random() * 25,
      timestamp: t,
    });
  }
}
