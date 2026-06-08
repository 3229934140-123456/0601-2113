import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Storage } from '../storage';
import { Waybill, TemperatureZone } from '../types';
import { success, notFound, badRequest, error } from '../utils/response';

const router = Router();
const storage = Storage.getInstance();

router.get('/', (req: Request, res: Response) => {
  const { vehicleId, status, customerId } = req.query;
  let waybills = storage.getWaybills();
  if (vehicleId) waybills = waybills.filter(w => w.vehicleId === vehicleId);
  if (status) waybills = waybills.filter(w => w.status === status);
  if (customerId) waybills = waybills.filter(w => w.customerId === customerId);
  success(res, { waybills, total: waybills.length });
});

router.get('/:id', (req: Request, res: Response) => {
  const waybill = storage.getWaybillById(req.params.id);
  if (!waybill) {
    return notFound(res, '运单不存在');
  }
  success(res, waybill);
});

router.get('/no/:waybillNo', (req: Request, res: Response) => {
  const waybill = storage.getWaybillByNo(req.params.waybillNo);
  if (!waybill) {
    return notFound(res, '运单不存在');
  }
  success(res, waybill);
});

router.post('/', (req: Request, res: Response) => {
  const {
    waybillNo, vehicleId, customerId, customerName, goodsName,
    origin, destination, planDepartureTime, planArrivalTime,
    temperatureZones,
  } = req.body;
  if (!waybillNo || !vehicleId || !customerId || !goodsName) {
    return badRequest(res, '运单号、车辆ID、客户ID、货物名称不能为空');
  }
  const vehicle = storage.getVehicleById(vehicleId);
  if (!vehicle) {
    return notFound(res, '车辆不存在');
  }
  const existing = storage.getWaybillByNo(waybillNo);
  if (existing) {
    return error(res, 409, '该运单号已存在');
  }
  const zones: TemperatureZone[] = (temperatureZones || []).map((z: any) => ({
    zoneId: z.zoneId || uuidv4(),
    zoneName: z.zoneName || '冷藏区',
    minTemp: typeof z.minTemp === 'number' ? z.minTemp : -18,
    maxTemp: typeof z.maxTemp === 'number' ? z.maxTemp : -10,
    durationThreshold: typeof z.durationThreshold === 'number' ? z.durationThreshold : 300,
  }));
  if (zones.length === 0) {
    zones.push({
      zoneId: uuidv4(),
      zoneName: '冷藏区',
      minTemp: -18,
      maxTemp: -10,
      durationThreshold: 300,
    });
  }
  const now = Date.now();
  const waybill: Waybill = {
    id: uuidv4(),
    waybillNo,
    vehicleId,
    customerId,
    customerName: customerName || '',
    goodsName,
    origin: origin || '',
    destination: destination || '',
    planDepartureTime,
    planArrivalTime,
    temperatureZones: zones,
    status: 'pending',
    signStatus: 'unsigned',
    createdAt: now,
    updatedAt: now,
  };
  const result = storage.addWaybill(waybill);
  success(res, result, '运单创建成功');
});

router.put('/:id', (req: Request, res: Response) => {
  const {
    origin, destination, planDepartureTime, planArrivalTime,
    actualDepartureTime, actualArrivalTime, status,
  } = req.body;
  const waybill = storage.updateWaybill(req.params.id, {
    origin,
    destination,
    planDepartureTime,
    planArrivalTime,
    actualDepartureTime,
    actualArrivalTime,
    status,
  });
  if (!waybill) {
    return notFound(res, '运单不存在');
  }
  success(res, waybill, '运单信息更新成功');
});

router.put('/:id/zones', (req: Request, res: Response) => {
  const { temperatureZones } = req.body;
  if (!Array.isArray(temperatureZones)) {
    return badRequest(res, '温区配置格式错误');
  }
  const waybill = storage.getWaybillById(req.params.id);
  if (!waybill) {
    return notFound(res, '运单不存在');
  }
  const zones: TemperatureZone[] = temperatureZones.map((z: any) => ({
    zoneId: z.zoneId || uuidv4(),
    zoneName: z.zoneName || '冷藏区',
    minTemp: typeof z.minTemp === 'number' ? z.minTemp : -18,
    maxTemp: typeof z.maxTemp === 'number' ? z.maxTemp : -10,
    durationThreshold: typeof z.durationThreshold === 'number' ? z.durationThreshold : 300,
  }));
  const updated = storage.updateWaybill(req.params.id, { temperatureZones: zones });
  success(res, updated, '温区阈值配置更新成功');
});

router.post('/:id/start', (req: Request, res: Response) => {
  const waybill = storage.updateWaybill(req.params.id, {
    status: 'in_transit',
    actualDepartureTime: Date.now(),
  });
  if (!waybill) {
    return notFound(res, '运单不存在');
  }
  success(res, waybill, '运单已开始运输');
});

router.post('/:id/arrive', (req: Request, res: Response) => {
  const waybill = storage.updateWaybill(req.params.id, {
    status: 'delivered',
    actualArrivalTime: Date.now(),
  });
  if (!waybill) {
    return notFound(res, '运单不存在');
  }
  success(res, waybill, '运单已送达');
});

export default router;
