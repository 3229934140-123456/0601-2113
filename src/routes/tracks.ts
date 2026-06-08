import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Storage } from '../storage';
import { TrackPoint, TrackSummary } from '../types';
import { success, notFound, badRequest } from '../utils/response';

const router = Router();
const storage = Storage.getInstance();

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

router.post('/report', (req: Request, res: Response) => {
  const {
    vehicleId, waybillId, latitude, longitude, address, speed, heading, timestamp,
  } = req.body;
  if (!vehicleId || typeof latitude !== 'number' || typeof longitude !== 'number') {
    return badRequest(res, '车辆ID、经纬度不能为空');
  }
  let targetWaybillId = waybillId;
  if (!targetWaybillId) {
    const w = storage.getActiveWaybillByVehicle(vehicleId);
    if (w) targetWaybillId = w.id;
  }
  if (!targetWaybillId) {
    return badRequest(res, '未找到关联运单');
  }
  const point: TrackPoint = {
    id: uuidv4(),
    waybillId: targetWaybillId,
    vehicleId,
    latitude,
    longitude,
    address,
    speed,
    heading,
    timestamp: timestamp || Date.now(),
  };
  storage.addTrackPoint(point);
  success(res, point, '轨迹上报成功');
});

router.get('/waybill/:waybillId', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 0;
  const points = storage.getTrackPoints(req.params.waybillId, limit || undefined);
  success(res, { points, total: points.length });
});

router.get('/vehicle/:vehicleId/latest', (req: Request, res: Response) => {
  const waybillId = req.query.waybillId as string | undefined;
  const point = storage.getLatestTrackPoint(req.params.vehicleId, waybillId);
  if (!point) {
    return success(res, null, '暂无轨迹数据');
  }
  success(res, point);
});

router.get('/waybill/:waybillId/summary', (req: Request, res: Response) => {
  const points = storage.getTrackPoints(req.params.waybillId);
  const waybill = storage.getWaybillById(req.params.waybillId);
  if (!waybill) {
    return notFound(res, '运单不存在');
  }

  const summary: TrackSummary = {
    waybillId: req.params.waybillId,
    totalDuration: 0,
    pointCount: points.length,
    stopCount: 0,
  };

  if (points.length > 0) {
    const first = points[0];
    const last = points[points.length - 1];
    summary.startPoint = {
      latitude: first.latitude,
      longitude: first.longitude,
      address: first.address,
      timestamp: first.timestamp,
    };
    summary.endPoint = {
      latitude: last.latitude,
      longitude: last.longitude,
      address: last.address,
      timestamp: last.timestamp,
    };
    summary.totalDuration = Math.floor((last.timestamp - first.timestamp) / 1000);

    let totalDistance = 0;
    let stopCount = 0;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      totalDistance += calculateDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
      if (typeof curr.speed === 'number' && curr.speed === 0) {
        if (i === 1 || (typeof points[i - 1].speed === 'number' && points[i - 1].speed! > 0)) {
          stopCount++;
        }
      }
    }
    summary.totalDistance = parseFloat(totalDistance.toFixed(2));
    summary.stopCount = stopCount;
  }

  success(res, summary);
});

router.get('/vehicle/:vehicleId/recent', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const waybill = storage.getActiveWaybillByVehicle(req.params.vehicleId);
  if (!waybill) {
    return success(res, { points: [], total: 0, message: '车辆无进行中运单' });
  }
  const points = storage.getTrackPoints(waybill.id, limit);
  success(res, {
    waybillId: waybill.id,
    waybillNo: waybill.waybillNo,
    points,
    total: points.length,
  });
});

export default router;
