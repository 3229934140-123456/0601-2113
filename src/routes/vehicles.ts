import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Storage } from '../storage';
import { Vehicle } from '../types';
import { success, notFound, badRequest, error } from '../utils/response';

const router = Router();
const storage = Storage.getInstance();

router.get('/', (req: Request, res: Response) => {
  const vehicles = storage.getVehicles();
  success(res, { vehicles, total: vehicles.length });
});

router.get('/:id', (req: Request, res: Response) => {
  const vehicle = storage.getVehicleById(req.params.id);
  if (!vehicle) {
    return notFound(res, '车辆不存在');
  }
  success(res, vehicle);
});

router.get('/device/:deviceId', (req: Request, res: Response) => {
  const vehicle = storage.getVehicleByDeviceId(req.params.deviceId);
  if (!vehicle) {
    return notFound(res, '未找到绑定该设备的车辆');
  }
  success(res, vehicle);
});

router.post('/', (req: Request, res: Response) => {
  const { plateNumber, deviceId, driverName, driverPhone } = req.body;
  if (!plateNumber || !deviceId) {
    return badRequest(res, '车牌号和设备ID不能为空');
  }
  const existing = storage.getVehicleByPlate(plateNumber);
  if (existing) {
    return error(res, 409, '该车牌号已存在');
  }
  const existingDevice = storage.getVehicleByDeviceId(deviceId);
  if (existingDevice) {
    return error(res, 409, '该设备ID已绑定其他车辆');
  }
  const now = Date.now();
  const vehicle: Vehicle = {
    id: uuidv4(),
    plateNumber,
    deviceId,
    driverName,
    driverPhone,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  const result = storage.addVehicle(vehicle);
  success(res, result, '车辆创建成功');
});

router.put('/:id', (req: Request, res: Response) => {
  const { driverName, driverPhone, status } = req.body;
  const vehicle = storage.updateVehicle(req.params.id, {
    driverName,
    driverPhone,
    status,
  });
  if (!vehicle) {
    return notFound(res, '车辆不存在');
  }
  success(res, vehicle, '车辆信息更新成功');
});

router.post('/:id/bind-driver', (req: Request, res: Response) => {
  const { driverId, driverName, driverPhone } = req.body;
  if (!driverName) {
    return badRequest(res, '司机姓名不能为空');
  }
  const vehicle = storage.updateVehicle(req.params.id, {
    driverId,
    driverName,
    driverPhone,
  });
  if (!vehicle) {
    return notFound(res, '车辆不存在');
  }
  success(res, vehicle, '司机绑定成功');
});

router.post('/:id/unbind-driver', (req: Request, res: Response) => {
  const vehicle = storage.updateVehicle(req.params.id, {
    driverId: undefined,
    driverName: undefined,
    driverPhone: undefined,
  });
  if (!vehicle) {
    return notFound(res, '车辆不存在');
  }
  success(res, vehicle, '司机解绑成功');
});

router.delete('/:id', (req: Request, res: Response) => {
  const ok = storage.deleteVehicle(req.params.id);
  if (!ok) {
    return notFound(res, '车辆不存在');
  }
  success(res, null, '车辆删除成功');
});

export default router;
